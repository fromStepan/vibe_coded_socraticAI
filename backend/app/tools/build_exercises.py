"""Builds the "Դասագրքից" exercise list for a grade whose book has no answer pages.

    cd backend && uv run python -m app.tools.build_exercises --grade 4

1. pick    from each lesson, the self-contained exercises that have a checkable final answer
           (oral, group, drawing, measuring and "make up a problem" tasks are skipped)
2. solve   each exercise is solved twice, independently: gpt-5.5 reasoning step by step, gpt-4.1 with the calculator
3. keep    only exercises where both answers agree; the answer is stored as "ai-verified"
4. fill    lessons left with fewer than 4 get new teacher-made problems in the lesson's style ("ai-made"),
           which go through the same double check

Results are cached under build/grade-N/exercises/, so an interrupted run resumes.
Writes content/grade-N/exercises.json, but never replaces an existing hand-made list unless --replace is given.
"""
import argparse
import asyncio
import hashlib
import json
import re

from openai import RateLimitError

from .. import content, prompts
from ..config import BACKEND_DIR, CONTENT_DIR
from ..llm import complete, complete_json, complete_with_calculator
from ..tutor import _numbers_in

PICK_MODEL = "gpt-5.5"
SOLVERS = ("gpt-5.5", "gpt-4.1")  # step-by-step reasoning, and the exact calculator — two independent methods
_slots = asyncio.Semaphore(4)


async def _patient(make_call, attempts: int = 10):
    """Waits out OpenAI per-minute limits instead of failing the whole run."""
    for attempt in range(attempts):
        try:
            return await make_call()
        except RateLimitError:
            await asyncio.sleep(20 * (attempt + 1))
    raise RuntimeError("still rate-limited after several minutes")

PICK_PROMPT = """Below is lesson {lesson_id} «{title}» of an Armenian grade {grade} math textbook.
List the exercises a student could get as homework AND whose result can be checked as one final answer
(a number, a few numbers, a comparison sign, yes/no, or a short word).

Include an exercise only if ALL of this is true:
- it can be solved from its text alone (if it needs a picture or table, that content is fully written in the text);
- it is not oral ("ասա՛", "կարդա՛"), not group work or discussion, not drawing/measuring/constructing,
  not "make up a problem", and not open-ended (many correct answers, explanations, opinions);
- every lettered part (ա), բ) …) has its own checkable answer. If only some parts qualify, keep just those parts.

Copy each statement exactly as printed (fix nothing except obvious typos), with any table or picture description
it needs, so it stands on its own. Do not solve anything.
Respond with JSON: {{"exercises": [{{"number": "<exercise number as printed>", "text": "<full statement>"}}]}}

LESSON TEXT:
{text}"""


def _lesson_text(grade: str, lesson: dict) -> str:
    text = (CONTENT_DIR / f"grade-{grade}" / lesson["file"]).read_text(encoding="utf-8")
    return text.split("## Ուսուցչի ուղեցույց")[0]


async def pick(grade: str, lesson: dict, cache) -> list[dict]:
    path = cache / f"pick-{lesson['id']}.json"
    if not path.is_file():
        async with _slots:
            data = await complete_json(
                PICK_PROMPT.format(lesson_id=lesson["id"], title=lesson["title"], grade=grade, text=_lesson_text(grade, lesson)),
                model=PICK_MODEL, max_tokens=12000,
            ) or {}
        path.write_text(json.dumps(data.get("exercises", []), ensure_ascii=False, indent=1), encoding="utf-8")
    return json.loads(path.read_text(encoding="utf-8"))


async def solve_twice(grade: str, lesson: dict, text: str, cache) -> tuple[str, str]:
    key = hashlib.sha256(f"{lesson['id']}|{text}".encode()).hexdigest()[:16]
    path = cache / "solved" / f"{key}.json"
    if not path.is_file():
        grounding = content.grounding_text(grade, (lesson["id"],))
        user = prompts.render("answer_solver.md", grade=grade, chapter_text=grounding, problem=text)

        async def reasoning_solver():
            async with _slots:
                response = await complete(model=SOLVERS[0], messages=[{"role": "user", "content": user}],
                                          max_tokens=8000, reasoning_effort="medium")
            return _final_answer(response.choices[0].message.content or "")

        async def calculator_solver():
            async with _slots:
                return _final_answer(await complete_with_calculator(
                    [{"role": "user", "content": user}], model=SOLVERS[1], max_tokens=4000, effort="low"))

        answers = await asyncio.gather(reasoning_solver(), calculator_solver())
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(answers, ensure_ascii=False), encoding="utf-8")
    a, b = json.loads(path.read_text(encoding="utf-8"))
    return a, b


def _final_answer(text: str) -> str:
    for line in text.splitlines():
        if (i := line.find("FINAL ANSWER")) != -1:
            return line[i + len("FINAL ANSWER"):].strip(" \t:՝-—–.")
    return text.strip()


MAKE_PROMPT = """You are an experienced Armenian math teacher. Lesson {lesson_id} «{title}» of a grade {grade}
textbook has too few homework problems with a checkable answer. Write {count} NEW problems for it, in Armenian,
in the style and difficulty of the lesson below, using only what the lesson teaches.
Each problem must be solvable from its text alone (describe any figure in words with all needed lengths/angles —
no drawing or measuring), must have ONE checkable final answer (number(s), a comparison sign, yes/no, or a short
word), and must differ from the problems already in the lesson. Do not include answers or solutions.
Respond with JSON: {{"exercises": [{{"text": "<problem>"}}]}}

LESSON TEXT:
{text}"""

MIN_PER_LESSON = 4


async def make(grade: str, lesson: dict, count: int, cache) -> list[dict]:
    path = cache / f"make-{lesson['id']}.json"
    if not path.is_file():
        async with _slots:
            data = await complete_json(
                MAKE_PROMPT.format(lesson_id=lesson["id"], title=lesson["title"], grade=grade, count=count,
                                   text=_lesson_text(grade, lesson)),
                model=PICK_MODEL, max_tokens=8000,
            ) or {}
        path.write_text(json.dumps(data.get("exercises", []), ensure_ascii=False, indent=1), encoding="utf-8")
    return json.loads(path.read_text(encoding="utf-8"))


AGREE_PROMPT = """Problem: {problem}
Answer A: {a}
Answer B: {b}

Two solvers answered independently. First list the final value(s) of every part in A, then in B.
They agree ONLY if every value is numerically identical. Equivalent notations of the same number count as the
same (19/12 = 1 7/12 = 1,58…; "5 տետր" = "5"). Any different number means they disagree — even if both could
be valid readings of the problem.
Respond JSON: {{"a_values": "...", "b_values": "...", "same": true | false}}"""


async def agree(problem: str, a: str, b: str) -> bool:
    if not a or not b:
        return False
    if _numbers_in(a) == _numbers_in(b) and _numbers_in(a):
        return True
    async with _slots:
        data = await complete_json(AGREE_PROMPT.format(problem=problem, a=a, b=b), model="gpt-5.5", max_tokens=3000)
    return bool(data and data.get("same") is True)


async def build(grade: str) -> list[dict]:
    cache = BACKEND_DIR / "build" / f"grade-{grade}" / "exercises"
    cache.mkdir(parents=True, exist_ok=True)
    lessons = content.lessons(grade)
    if not lessons:
        raise SystemExit(f"Grade {grade} has no lessons — build the book first")
    titles = {s["file"]: s["title"] for s in content.summaries(grade)}

    picked = await asyncio.gather(*(pick(grade, l, cache) for l in lessons))
    jobs = [(l, e) for l, exs in zip(lessons, picked) for e in exs if str(e.get("text", "")).strip()]
    print(f"picked {len(jobs)} exercises from {len(lessons)} lessons; solving each twice …", flush=True)

    done = 0

    async def check(lesson, ex):
        nonlocal done
        text = f"{ex.get('number', '').strip()}. {ex['text'].strip()}".lstrip(". ")
        try:
            a, b = await _patient(lambda: solve_twice(grade, lesson, text, cache))
            ok = await _patient(lambda: agree(text, a, b))
        except Exception as e:
            print(f"  skipped exercise {ex.get('number')} of lesson {lesson['id']}: {type(e).__name__}", flush=True)
            a, ok = "", False
        done += 1
        if done % 25 == 0 or done == len(jobs):
            print(f"  checked {done}/{len(jobs)}", flush=True)
        return lesson, text, a, ok

    results = [(*r, "textbook") for r in await asyncio.gather(*(check(l, e) for l, e in jobs))]
    kept = {l["id"]: 0 for l in lessons}
    for lesson, _, _, ok, _ in results:
        kept[lesson["id"]] += ok

    short = [(l, MIN_PER_LESSON - kept[l["id"]]) for l in lessons if kept[l["id"]] < MIN_PER_LESSON]
    if short:
        print(f"{len(short)} lessons have fewer than {MIN_PER_LESSON} exercises; writing teacher-made ones …", flush=True)
        made = await asyncio.gather(*(make(grade, l, n + 2, cache) for l, n in short))  # +2: some won't pass the check
        extra_jobs = [(l, {"number": "", "text": e["text"]}, n) for (l, n), exs in zip(short, made)
                      for e in exs if str(e.get("text", "")).strip()]
        done, jobs = 0, extra_jobs
        checked = await asyncio.gather(*(check(l, e) for l, e, _ in extra_jobs))
        need = {l["id"]: n for l, n in short}
        for r in checked:
            if r[3] and need[r[0]["id"]] > 0:
                need[r[0]["id"]] -= 1
                results.append((*r, "ai-made"))

    bank = []
    for lesson, text, answer, ok, origin in results:
        if not ok:
            continue
        chapter_title = titles.get(lesson["chapter_file"], "")
        bank.append({
            "origin": origin,
            "id": len(bank) + 1,
            "chapter_num": int(lesson["chapter"]),
            "chapter_title_hy": chapter_title,
            "lesson_num": f"Դաս {lesson['id']}",
            "lesson_title_hy": lesson["title"],
            "topic": f"{chapter_title} — {lesson['title']}",
            "question_hy": text,
            "answer_raw": answer,
            "answer_keywords": [],
            "answer_source": "ai-verified",
        })
    made_count = sum(e["origin"] == "ai-made" for e in bank)
    print(f"kept {len(bank) - made_count} textbook exercises and {made_count} teacher-made ones (both solutions agree)")
    return bank


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--grade", required=True)
    parser.add_argument("--replace", action="store_true", help="overwrite an existing exercises.json")
    args = parser.parse_args()

    bank = asyncio.run(build(args.grade))
    target = CONTENT_DIR / f"grade-{args.grade}" / "exercises.json"
    if target.is_file() and not args.replace:
        target = BACKEND_DIR / "build" / f"grade-{args.grade}" / "exercises.json"
        print("An exercise list already exists, so the new one was NOT installed.")
    target.write_text(json.dumps(bank, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {target}. Restart the backend to load it.")


if __name__ == "__main__":
    main()
