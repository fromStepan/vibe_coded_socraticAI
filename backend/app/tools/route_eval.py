"""Measures how well the router finds the right textbook material, using the labelled exercise bank.

    cd backend && uv run python -m app.tools.route_eval            # grade 5
    cd backend && uv run python -m app.tools.route_eval --grade 4
"""
import argparse
import asyncio
import re

import tiktoken

from .. import content, tutor

_enc = tiktoken.get_encoding("o200k_base")


def tokens(units: list[str], grade: str) -> int:
    return len(_enc.encode(content.grounding_text(grade, tuple(units)))) if units else 0


def chapter_of(grade: str, unit: str) -> int | None:
    file = (content.lesson(grade, unit) or {}).get("chapter_file", unit)
    title = next((s["title"] for s in content.summaries(grade) if s["file"] == file), "")
    m = re.match(r"^(?:Գլուխ|Թեմա)\s*(\d+)", title)
    return int(m.group(1)) if m else None


async def main(grade: str):
    bank = content.exercises(grade)
    if not bank:
        raise SystemExit(f"Grade {grade} has no labelled exercises to evaluate against")
    has_lessons = bool(content.lessons(grade))

    async def one(ex):
        chapters, _ = await tutor.route_chapters(ex["question_hy"], grade)
        lessons = (await tutor.route(ex["question_hy"], grade))[0] if has_lessons else []
        return ex, chapters, lessons

    results = await asyncio.gather(*(one(ex) for ex in bank))
    n = len(results)
    ch_hit = sum(ex["chapter_num"] in [chapter_of(grade, u) for u in ch] for ex, ch, _ in results)
    ch_exact = sum([chapter_of(grade, u) for u in ch] == [ex["chapter_num"]] for ex, ch, _ in results)
    ch_tokens = sum(tokens(ch, grade) for _, ch, _ in results) / n
    print(f"Chapter router: right chapter included {ch_hit}/{n}, exactly right alone {ch_exact}/{n}, "
          f"avg grounding {ch_tokens:,.0f} tokens")

    if has_lessons:
        want = lambda ex: (re.search(r"\d+(?:\.\d+)?", ex.get("lesson_num", "")) or [None])[0]
        incl = sum(want(ex) in ls for ex, _, ls in results)
        chap = sum(ex["chapter_num"] in [chapter_of(grade, u) for u in ls] for ex, _, ls in results)
        fallback = sum(any(not content.lesson(grade, u) for u in ls) for _, _, ls in results)
        ls_tokens = sum(tokens(ls, grade) for _, _, ls in results) / n
        print(f"Full routing:   labelled lesson included {incl}/{n}, right chapter included {chap}/{n}, "
              f"fell back to whole chapters {fallback}/{n}, avg grounding {ls_tokens:,.0f} tokens")
        for ex, ch, ls in results:
            if want(ex) not in ls:
                print(f"   #{ex['id']:>2} labelled {want(ex)} «{ex.get('lesson_title_hy', '')}» — got {ls or 'nothing'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--grade", default="5")
    asyncio.run(main(parser.parse_args().grade))
