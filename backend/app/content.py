"""Textbook content per grade. backend/content/grade-<N>/ holds:
  chapter_summaries.json + chapter markdown files   (always; chapter-level grounding and fallback)
  lessons.json + lessons/<id>.md                     (optional; lesson-level grounding, built by tools/build_content)
  exercises.json                                     (optional; textbook problems with verified answers)

A conversation is grounded on "units": lesson ids ("6.9", "26") or chapter file names."""
import json
import re
from functools import lru_cache

from .config import CONTENT_DIR

OUT_OF_SCOPE_TOPIC = "Դասարանային թեմայից դուրս"
_CHAPTER_PREFIX = re.compile(r"^(?:Գլուխ|Թեմա)\s*(\d+)\.\s*")


def _grade_dir(grade: str):
    path = CONTENT_DIR / f"grade-{grade}"
    if not path.is_dir():
        raise ValueError(f"No textbook content for grade {grade}")
    return path


@lru_cache(maxsize=None)
def summaries(grade: str) -> list[dict]:
    return json.loads((_grade_dir(grade) / "chapter_summaries.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def lessons(grade: str) -> list[dict]:
    path = _grade_dir(grade) / "lessons.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else []


def lesson(grade: str, lesson_id: str) -> dict | None:
    return next((l for l in lessons(grade) if l["id"] == lesson_id), None)


@lru_cache(maxsize=None)
def grounding_text(grade: str, units: tuple[str, ...]) -> str:
    chapter_files = {s["file"] for s in summaries(grade)}
    parts, outline_chapters = [], []
    for unit in units:
        if found := lesson(grade, unit):
            parts.append((_grade_dir(grade) / found["file"]).read_text(encoding="utf-8"))
            outline_chapters.append(found["chapter_file"])
        elif unit in chapter_files:
            parts.append((_grade_dir(grade) / unit).read_text(encoding="utf-8"))
    # A short map of the surrounding lessons, so a slightly-off lesson pick still shows which methods exist.
    for file in dict.fromkeys(outline_chapters):
        title = next((s["title"] for s in summaries(grade) if s["file"] == file), "")
        lines = [f"- Դաս {l['id']}. {l['title']} — {l['summary']}" for l in lessons(grade) if l["chapter_file"] == file]
        parts.append(f"## {title} — բոլոր դասերը (համառոտ, կողմնորոշման համար)\n\n" + "\n".join(lines))
    return "\n\n".join(parts)


def _words(text: str) -> list[str]:
    return re.sub(r"[^\w/]+", " ", text.lower()).split()


@lru_cache(maxsize=None)
def _lesson_textbook_words(grade: str) -> dict[str, str]:
    """Each lesson's textbook part (not the guide), normalized, for finding where a problem is printed."""
    out = {}
    for l in lessons(grade):
        text = (_grade_dir(grade) / l["file"]).read_text(encoding="utf-8").split("## Ուսուցչի ուղեցույց")[0]
        out[l["id"]] = " ".join(_words(text))
    return out


@lru_cache(maxsize=None)
def lesson_excerpt(grade: str, lesson_id: str, chars: int) -> str:
    """The opening of a lesson's explanation (after its title), on one line."""
    found = lesson(grade, lesson_id)
    if not found or chars <= 0:
        return ""
    text = (_grade_dir(grade) / found["file"]).read_text(encoding="utf-8").split("## Ուսուցչի ուղեցույց")[0]
    body = text.split("## Դասագիրք", 1)[-1]
    body = re.sub(r"(?m)^#+.*$", " ", body)
    return re.sub(r"\s+", " ", body).strip()[:chars]


def lesson_containing(grade: str, problem: str, threshold: float = 0.6) -> str | None:
    """The lesson whose exercises contain this problem (most of its 4-word phrases), if any."""
    words = _words(re.sub(r"^\s*\d+\s*[.)]\s*", "", problem))
    if len(words) < 6:
        return None
    phrases = {" ".join(words[i:i + 4]) for i in range(len(words) - 3)}
    best, score = None, 0.0
    for lesson_id, text in _lesson_textbook_words(grade).items():
        s = sum(p in text for p in phrases) / len(phrases)
        if s > score:
            best, score = lesson_id, s
    return best if score >= threshold else None


def _chapter_file_of(grade: str, unit: str) -> str:
    found = lesson(grade, unit)
    return found["chapter_file"] if found else unit


def topic_for(grade: str, units: list[str]) -> str:
    """'Գլուխ 6. Կոտորակներ' -> 'Կոտորակներ' — the short student-facing topic name."""
    if not units:
        return OUT_OF_SCOPE_TOPIC
    by_file = {s["file"]: _CHAPTER_PREFIX.sub("", s["title"]) for s in summaries(grade)}
    files = [_chapter_file_of(grade, u) for u in units]
    return ", ".join(dict.fromkeys(by_file.get(f, f) for f in files))


def unit_label(grade: str, unit: str) -> str:
    """For the admin view: 'Դաս 6.9. Կոտորակների գումարումն ու հանումը' or the chapter title."""
    if found := lesson(grade, unit):
        return f"Դաս {found['id']}. {found['title']}"
    return next((s["title"] for s in summaries(grade) if s["file"] == unit), unit)


@lru_cache(maxsize=None)
def exercises(grade: str) -> list[dict]:
    path = _grade_dir(grade) / "exercises.json"
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def exercise(grade: str, exercise_id: int) -> dict | None:
    return next((e for e in exercises(grade) if e["id"] == exercise_id), None)


def chapter_file_for_number(grade: str, number: int) -> str | None:
    for s in summaries(grade):
        if (m := _CHAPTER_PREFIX.match(s["title"])) and int(m.group(1)) == number:
            return s["file"]
    return None


def units_for_exercise(grade: str, ex: dict) -> list[str]:
    """The exercise's own lesson when lesson content exists, otherwise its chapter."""
    m = re.search(r"\d+(?:\.\d+)?", ex.get("lesson_num", ""))
    if m and lesson(grade, m.group()):
        return [m.group()]
    chapter = chapter_file_for_number(grade, ex.get("chapter_num", 0))
    return [chapter] if chapter else []


def public_exercises(grade: str) -> list[dict]:
    """Bank entries without their answers — this is what the student UI receives."""
    return [
        {
            "id": e["id"],
            "chapter": e.get("chapter_num"),
            "topic": topic_for(grade, units) if (units := units_for_exercise(grade, e)) else "",
            "lesson": e.get("lesson_title_hy", ""),
            "text": e["question_hy"],
            "extra": e.get("origin") == "ai-made",
        }
        for e in exercises(grade)
    ]
