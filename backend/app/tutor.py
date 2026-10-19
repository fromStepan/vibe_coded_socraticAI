"""Socratic tutoring pipeline.

Every graded reply passes a layered no-answer guardrail before the student sees it:
  1. instruction constraints  — prompts/socratic_system.md
  2. deterministic number scan — the secret answer (or an equivalent form) must not appear
  3. LLM-as-judge leak check   — prompts/leak_check.md
  4. regenerate on a scratch copy with prompts/leak_retry_notice.md, then a canned fallback
"""
import json
import logging
import re
from dataclasses import dataclass, field
from fractions import Fraction

from . import content, prompts
from .config import JUDGE_MODEL, MAX_LEAK_RETRIES, PHOTO_MODEL, ROUTER_EXCERPT_CHARS, ROUTER_MODEL, TUTOR_MODEL
from .llm import complete, complete_json, complete_with_calculator, extra_body

log = logging.getLogger("tutor.pipeline")


# ---------- routing & ground truth ----------

async def route(problem: str, grade: str) -> tuple[list[str], str]:
    """Returns grounding units — lesson ids when the grade has lesson content, else chapter files.
    An empty list means the question is outside the curriculum.

    With lessons: the chapter router (most reliable) decides scope, a text lookup finds the lesson where a
    textbook problem is printed, and the lesson router picks the lesson that teaches the method it needs."""
    chapters, reason = await route_chapters(problem, grade)
    if not chapters or not content.lessons(grade):
        return chapters, reason
    printed_in = content.lesson_containing(grade, problem)
    scope = set(chapters) | ({content.lesson(grade, printed_in)["chapter_file"]} if printed_in else set())
    picked = await route_lessons(problem, grade, scope, printed_in)
    if picked is None:
        return chapters, reason
    units = list(dict.fromkeys(picked[0] + ([printed_in] if printed_in else [])))[:3]
    if not units:
        return chapters, reason
    where = f" Printed in lesson {printed_in}." if printed_in else ""
    return units, f"{picked[1]}{where}"


async def route_lessons(problem: str, grade: str, chapter_files: set[str], printed_in: str | None) -> tuple[list[str], str] | None:
    """None when the router's answer is unusable, so the caller can fall back to chapter grounding."""
    titles = {s["file"]: s["title"] for s in content.summaries(grade)}
    candidates = [l for l in content.lessons(grade) if l["chapter_file"] in chapter_files]
    block, current = [], None
    for l in candidates:
        if l["chapter_file"] != current:
            current = l["chapter_file"]
            block.append(f"\n{titles.get(current, '')}")
        excerpt = content.lesson_excerpt(grade, l["id"], ROUTER_EXCERPT_CHARS)
        block.append(f"{l['id']} — {l['title']} — {l['summary']}" + (f"\n    Դասագրքից՝ «{excerpt}»" if excerpt else ""))
    hint = (f"\nԱյս խնդիրը տպված է դասագրքի {printed_in} դասի վարժությունների մեջ (բայց կարող է լինել "
            f"ավելի վաղ դասի մեթոդի կրկնություն)։\n") if printed_in else ""
    data = await complete_json(
        prompts.render("router_lessons.md", grade=grade, lessons_block="\n".join(block).strip(), query=problem,
                       location_hint=hint),
        model=ROUTER_MODEL,
        max_tokens=4000,
    )
    if data is None or not isinstance(data.get("lessons"), list):
        return None
    known = {l["id"] for l in candidates}
    picked = [str(i).strip() for i in data["lessons"] if str(i).strip() in known][:3]
    if data["lessons"] and not picked:
        return None
    return list(dict.fromkeys(picked)), str(data.get("reason", ""))


async def route_chapters(problem: str, grade: str) -> tuple[list[str], str]:
    chapters = content.summaries(grade)
    block = "\n\n".join(f"{i}. {c['title']}\n   Ամփոփում՝ {c['summary']}" for i, c in enumerate(chapters, start=1))
    data = await complete_json(
        prompts.render("router.md", grade=grade, chapters_block=block, query=problem),
        model=JUDGE_MODEL,
        max_tokens=600,
    ) or {}
    numbers = [n for n in data.get("chapters", []) if isinstance(n, int) and 1 <= n <= len(chapters)]
    return [chapters[n - 1]["file"] for n in dict.fromkeys(numbers)], str(data.get("reason", ""))


async def solve(problem: str, grade: str, chapter_text: str) -> str:
    text = await complete_with_calculator(
        [{"role": "user", "content": prompts.render("answer_solver.md", grade=grade, chapter_text=chapter_text, problem=problem)}],
        model=TUTOR_MODEL,
        max_tokens=4000,
        effort="low",
    )
    for line in text.splitlines():
        if (idx := line.find("FINAL ANSWER")) != -1:
            if rest := line[idx + len("FINAL ANSWER"):].strip(" \t:՝-—–."):
                return rest
    return text


async def is_correct_final_answer(problem: str, correct_answer: str, student_answer: str) -> bool:
    data = await complete_json(
        prompts.render("answer_compare.md", problem=problem, correct_answer=correct_answer, student_answer=student_answer),
        model=JUDGE_MODEL,
    )
    # Unreadable verdict -> "incorrect": wrongly praising a wrong answer is worse than asking again.
    return bool(data and data.get("correct") is True)


async def read_photo(image_data_url: str, grade: str) -> dict:
    """Transcribes the problem(s) in a homework photo. The student confirms/edits the text before starting."""
    response = await complete(
        model=PHOTO_MODEL,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": prompts.render("photo_transcribe.md", grade=grade)},
            {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}},
        ]}],
        max_tokens=4000,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(response.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    problems = []
    for p in (str(p).strip() for p in data.get("problems", [])):
        if p:
            # Photo reading misreads small digits; a textbook exercise is replaced by the book's verified text.
            book = content.textbook_version(grade, p)
            problems.append({"text": book or p, "fromBook": bool(book)})
    return {"problems": problems[:10], "unreadable": bool(data.get("unreadable"))}


# ---------- system prompts ----------

def system_prompt(grade: str, chapter_files: list[str], student_name: str) -> str:
    name_line = f"The student you are tutoring is named {student_name}. " if student_name else ""
    if not chapter_files:
        return prompts.render("out_of_scope_system.md", grade=grade, name_line=name_line)
    return prompts.render(
        "socratic_system.md",
        grade=grade,
        name_line=name_line,
        chapter_text=content.grounding_text(grade, tuple(chapter_files)),
    )


# ---------- guardrail layer 2: deterministic number scan ----------

_MIXED = re.compile(r"(\d+)[ \u00a0]+(\d+)\s*/\s*(\d+)")
_FRACTION = re.compile(r"(\d+)\s*/\s*(\d+)")
_NUMBER = re.compile(r"\d{1,3}(?:[ \u00a0,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?")


def _numbers_in(text: str) -> set[Fraction]:
    values: set[Fraction] = set()
    for w, a, b in _MIXED.findall(text):
        if int(b):
            values.add(int(w) + Fraction(int(a), int(b)))
    for a, b in _FRACTION.findall(text):
        if int(b):
            values.add(Fraction(int(a), int(b)))
    for token in _NUMBER.findall(_FRACTION.sub(" ", text)):
        plain = re.sub(r"[ \u00a0]", "", token)
        if re.fullmatch(r"\d{1,3}(,\d{3})+", plain):
            plain = plain.replace(",", "")
        values.add(Fraction(plain.replace(",", ".")))
    return values


def deterministic_leak(draft: str, problem: str, correct_answer: str) -> str | None:
    """Flags the draft if it contains a distinctive value from the secret answer.
    Values already printed in the problem, and single-digit integers (too common in
    ordinary guidance), are left to the LLM judge to avoid false alarms."""
    secret = {
        v for v in _numbers_in(correct_answer)
        if v not in _numbers_in(problem) and (v.denominator != 1 or v >= 10)
    }
    hits = secret & _numbers_in(draft)
    if hits:
        shown = ", ".join(str(h) for h in sorted(hits))
        return f"The reply contains the secret answer value ({shown})."
    return None


# ---------- guardrail layer 3: LLM judge ----------

async def judge_leak(problem: str, correct_answer: str, draft: str) -> tuple[bool, str]:
    data = await complete_json(
        prompts.render("leak_check.md", problem=problem, correct_answer=correct_answer, draft_reply=draft),
        model=JUDGE_MODEL,
    )
    if data is None:
        # Unreadable verdict -> treat as leaked; a retry is cheap, a leak is not.
        return True, "Leak judge returned an unreadable verdict."
    return data.get("leaked") is not False, str(data.get("reason", ""))


# ---------- reply generation ----------

async def draft_reply(messages: list[dict]) -> str:
    return await complete_with_calculator(messages, model=TUTOR_MODEL, max_tokens=1500, effort="none")


async def plain_reply(messages: list[dict]) -> str:
    """Unguarded reply for out-of-scope questions, where there is no secret answer."""
    response = await complete(model=TUTOR_MODEL, messages=messages, max_tokens=1500, extra_body=extra_body("none"))
    return (response.choices[0].message.content or "").strip() or prompts.fallback_reply()


@dataclass
class GuardAttempt:
    attempt: int
    draft: str
    leaked: bool
    method: str
    reason: str


@dataclass
class GuardedReply:
    text: str
    attempts: list[GuardAttempt] = field(default_factory=list)
    used_fallback: bool = False


async def safe_reply(messages: list[dict], problem: str, correct_answer: str, first_draft: str | None = None) -> GuardedReply:
    """Retries run on a scratch copy, so a leaked draft never enters the real history."""
    result = GuardedReply(text="")
    working = list(messages)
    leak_tries, style_retried, safe_draft = 0, False, None
    while leak_tries <= MAX_LEAK_RETRIES:
        number = len(result.attempts) + 1
        reply = first_draft if (number == 1 and first_draft) else await draft_reply(working)
        if not reply:
            leak_tries += 1
            result.attempts.append(GuardAttempt(number, "", True, "empty", "Model returned an empty reply."))
            continue

        reason = deterministic_leak(reply, problem, correct_answer)
        if reason:
            leaked, method = True, "number-scan"
        else:
            leaked, reason = await judge_leak(problem, correct_answer, reply)
            method = "llm-judge"

        if leaked:
            leak_tries += 1
            result.attempts.append(GuardAttempt(number, reply, True, method, reason))
            log.info("leak guard: attempt %d rejected by %s: %s", number, method, reason)
            working = working + [
                {"role": "assistant", "content": reply},
                {"role": "user", "content": prompts.render("leak_retry_notice.md", reason=reason or "not specified")},
            ]
            continue

        safe_draft = reply
        style = style_problem(reply)
        if style and not style_retried:
            # One rewrite for child-friendliness; the rewrite must pass the leak guard again.
            style_retried = True
            result.attempts.append(GuardAttempt(number, reply, False, "style", style))
            working = working + [
                {"role": "assistant", "content": reply},
                {"role": "user", "content": prompts.render("style_retry_notice.md", reason=style)},
            ]
            continue

        result.attempts.append(GuardAttempt(number, reply, False, method, reason))
        result.text = reply
        return result

    if safe_draft:
        # The style rewrite leaked: the earlier leak-safe draft is better than the canned fallback.
        result.text = safe_draft
        return result
    result.text = prompts.fallback_reply()
    result.used_fallback = True
    return result


_FORMAL = re.compile(
    r"(?<![\u0531-\u0587])(?:Դուք|Ձեր|Ձեզ|Ներեցե՛?ք|Եկե՛?ք|Փորձե՛?ք|Մտածե՛?ք|Հաշվե՛?ք|Գրե՛?ք|Ասե՛?ք|Նայե՛?ք|Գտե՛?ք|"
    r"Ստուգե՛?ք|Պատասխանե՛?ք|Կարդացե՛?ք|Հիշե՛?ք)(?![\u0531-\u0587])",
    re.IGNORECASE,
)
MAX_REPLY_CHARS = 230


def style_problem(reply: str) -> str | None:
    """Child-friendliness rules the prompt asks for: one question, about two lines, informal «դու»."""
    problems = []
    sentences = re.split(r"(?<=[։.!?])\s+|\n+", reply.strip())
    if (questions := sum(("՞" in s or "?" in s) for s in sentences)) > 1:
        problems.append(f"it asks {questions} questions instead of one")
    if len(reply) > MAX_REPLY_CHARS:
        problems.append(f"it is {len(reply)} characters long (the limit is about {MAX_REPLY_CHARS}, two short lines)")
    if m := _FORMAL.search(reply):
        problems.append(f"it uses the formal form «{m.group()}» instead of informal «դու»")
    return "; ".join(problems) or None
