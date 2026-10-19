"""Builds lesson-level textbook content for one grade from the original PDFs.

    cd backend && uv run python -m app.tools.build_content books/grade-5.json             # build into build/grade-5/out
    cd backend && uv run python -m app.tools.build_content books/grade-5.json --install   # back up content/grade-5, then replace it

Stages — each is cached under build/grade-N/, so an interrupted run resumes where it stopped:
  1. pages    every textbook page is re-read by a vision model from the page IMAGE plus its raw text
              (PDF text layer, or Tesseract OCR for scans); the model may only correct, never rewrite
  2. toc      lessons and their printed start pages, read from the book's own table of contents
  3. guide    the teacher's guide is split per lesson ("Դաս 6.9." / "Դաս 26:")
  4. summary  a short summary per lesson and per chapter (or AI-grouped theme), used by the router
  5. output   lessons.json, lessons/<id>.md, chapter files and chapter_summaries.json
"""
import argparse
import asyncio
import base64
import json
import os
import re
import shutil
import sys
import threading
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pymupdf
from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, InternalServerError, RateLimitError

from ..config import BACKEND_DIR, CONTENT_DIR

PAGE_MODEL = os.environ.get("BUILD_PAGE_MODEL", "gpt-5.5")
TEXT_MODEL = os.environ.get("BUILD_TEXT_MODEL", "gpt-4.1")
CONCURRENCY = int(os.environ.get("BUILD_CONCURRENCY", "6"))
PAGE_DPI = 200
GUIDE_SECTION_LIMIT = 8000
os.environ.setdefault("TESSDATA_PREFIX", "/opt/homebrew/share/tessdata")

client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""), timeout=600)
_sem: asyncio.Semaphore | None = None


async def ask(model: str, content, json_mode: bool = False, max_tokens: int = 12000) -> str:
    global _sem
    _sem = _sem or asyncio.Semaphore(CONCURRENCY * 2)
    kw = {"model": model, "messages": [{"role": "user", "content": content}]}
    if model.startswith(("gpt-5", "o3", "o4")):
        kw |= {"reasoning_effort": "low", "max_completion_tokens": max_tokens}
    else:
        kw |= {"temperature": 0, "max_tokens": min(max_tokens, 16000)}
    if json_mode:
        kw["response_format"] = {"type": "json_object"}
    for attempt in range(8):
        try:
            async with _sem:
                response = await client.chat.completions.create(**kw)
            return response.choices[0].message.content or ""
        except (RateLimitError, APIConnectionError, APITimeoutError, InternalServerError) as e:
            delay = 5 * (attempt + 1)
            print(f"  [retry in {delay}s: {type(e).__name__}]", file=sys.stderr)
            await asyncio.sleep(delay)
    raise RuntimeError("OpenAI kept failing; run the command again to resume")


def parse_json(text: str) -> dict:
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


# ---------- stage 1: pages ----------

# Glyphs some Armenian PDF fonts emit instead of real letters (seen in the grade 4 guide).
_GLYPH_FIXES = {"ٳ": "ու", "ؤ": "ՈՒ", "\ufb18": "ԹՅ"}


def clean_raw(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    for bad, good in _GLYPH_FIXES.items():
        text = text.replace(bad, good)
    return re.sub(r"[ \t\u00a0]+", " ", text).strip()


PAGE_PROMPT = """You are correcting the machine-read text of one page of an Armenian grade {grade} math textbook.
You get the page IMAGE and its RAW TEXT (from the PDF text layer or OCR; it may contain errors).
Return JSON: {{"printed_page": <the page number printed on this page, as an integer, or null>, "markdown": "<page text>"}}

Rules for "markdown":
- Follow the raw text word for word, in reading order; change ONLY what the image shows was misread.
- Restore math the raw text lost or garbled: fractions as a/b (e.g. 3/4), mixed numbers as "2 1/3", powers as 2^3,
  operations with · : + − =, comparison signs, and tables as Markdown tables.
- Fix misread Armenian letters (e.g. the conjunction "և" read as "ն"; "ու" displaced or replaced by other symbols)
  and misread digits.
- Keep exercise numbers and lettered parts (ա), բ) …) exactly as printed. Use "## " only for lesson/section titles.
- Drop OCR garbage (stray symbols, digits that belong to pictures), running headers/footers and the page number.
- If a picture carries math information (a number line, shapes with lengths, a diagram of a word problem), describe
  it in one short line in square brackets, in Armenian. Ignore decorative pictures.
- NEVER paraphrase, summarize, translate, reorder, or add anything that is not printed on the page.
  If the page has no text, return an empty string.

RAW TEXT:
{raw}"""


_ocr_lock = threading.Lock()  # Tesseract (Leptonica) refuses to run in two threads at once


def _render(pdf: str, index: int) -> tuple[str, str, bytes]:
    doc = pymupdf.open(pdf)
    page = doc[index]
    raw, source = page.get_text(), "text-layer"
    if len(raw.strip()) < 40:
        with _ocr_lock:
            raw = page.get_text(textpage=page.get_textpage_ocr(language="hye+eng", dpi=PAGE_DPI, full=True))
        source = "tesseract"
    return clean_raw(raw), source, page.get_pixmap(dpi=PAGE_DPI).tobytes("png")


async def read_page(pdf: str, book: int, index: int, grade: str, cache: Path) -> dict:
    path = cache / f"b{book}-p{index + 1:03}.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    raw, source, png = await asyncio.to_thread(_render, pdf, index)
    reply = await ask(PAGE_MODEL, [
        {"type": "text", "text": PAGE_PROMPT.format(grade=grade, raw=raw)},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
    ], json_mode=True)
    data = parse_json(reply)
    record = {
        "book": book,
        "pdf_page": index + 1,
        "printed_page": data.get("printed_page") if isinstance(data.get("printed_page"), int) else None,
        "markdown": str(data.get("markdown", "")).strip() if data else raw,
        "source": source,
        "corrected": bool(data),
        "raw": raw,
    }
    path.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    return record


async def stage_pages(cfg: dict, build: Path) -> dict[int, list[dict]]:
    cache = build / "pages"
    cache.mkdir(parents=True, exist_ok=True)
    jobs = [(book, pdf, i) for book, pdf in enumerate(cfg["textbooks"]) for i in range(pymupdf.open(pdf).page_count)]
    done = 0
    page_slots = asyncio.Semaphore(CONCURRENCY)

    async def one(book, pdf, i):
        nonlocal done
        async with page_slots:
            record = await read_page(pdf, book, i, cfg["grade"], cache)
        done += 1
        if done % 10 == 0 or done == len(jobs):
            print(f"  pages: {done}/{len(jobs)}", flush=True)
        return record

    records = await asyncio.gather(*(one(*j) for j in jobs))
    books: dict[int, list[dict]] = {}
    for r in records:
        books.setdefault(r["book"], []).append(r)
    for book, pages in books.items():
        pages.sort(key=lambda r: r["pdf_page"])
        offsets = Counter(r["printed_page"] - r["pdf_page"] for r in pages if r["printed_page"] is not None)
        offset = offsets.most_common(1)[0][0] if offsets else 0
        for r in pages:
            r["page"] = r["pdf_page"] + offset
    return books


# ---------- stage 2: table of contents ----------

TOC_PROMPT = """Below are the table-of-contents pages (Բովանդակություն) of an Armenian grade {grade} math textbook.
Extract every entry, in order. Return JSON:
{{"entries": [{{"kind": "chapter" | "lesson" | "other", "number": "<as printed: '6' for a chapter, '6.9' or '26' for a lesson, '' if none>", "title": "<title in Armenian, misreadings corrected>", "page": <printed start page, integer>}}]}}
"lesson" = a numbered lesson or topic; "chapter" = a heading that groups lessons; "other" = anything else with a page
number (review, test, answers, glossary, index, appendix). Only include entries that are really in this table.

PAGES:
{pages}"""

_PAGE_REF = re.compile(r"\d+\s*$", re.MULTILINE)


@dataclass
class Lesson:
    id: str
    title: str
    book: int
    start: int
    end: int = 0
    chapter: str = ""
    text: str = ""
    guide: str = ""
    summary: str = ""


def _toc_pages(pages: list[dict]) -> list[dict]:
    candidates = [i for i, p in enumerate(pages) if re.search(r"բովանդակություն", p["markdown"], re.IGNORECASE)]
    if not candidates:
        return []
    best = max(candidates, key=lambda i: len(_PAGE_REF.findall(pages[i]["markdown"])))
    chosen = [pages[best]]
    for p in pages[best + 1:best + 4]:
        if len(_PAGE_REF.findall(p["markdown"])) >= 5:
            chosen.append(p)
        else:
            break
    return chosen


async def stage_toc(cfg: dict, books: dict[int, list[dict]], build: Path) -> tuple[list[Lesson], dict[str, str]]:
    path = build / "toc.json"
    if not path.is_file():
        tocs = {}
        for book, pages in books.items():
            toc_pages = _toc_pages(pages)
            if not toc_pages:
                raise SystemExit(f"Could not find a table of contents in textbook #{book + 1}")
            text = "\n\n".join(f"--- page {p['page']} ---\n{p['markdown']}" for p in toc_pages)
            tocs[book] = parse_json(await ask(TEXT_MODEL, TOC_PROMPT.format(grade=cfg["grade"], pages=text), json_mode=True)).get("entries", [])
        path.write_text(json.dumps(tocs, ensure_ascii=False, indent=1), encoding="utf-8")
    tocs = {int(k): v for k, v in json.loads(path.read_text(encoding="utf-8")).items()}

    lessons: list[Lesson] = []
    chapters: dict[str, str] = {}
    for book, entries in tocs.items():
        entries = [e for e in entries if isinstance(e.get("page"), int)]
        pages = books[book]
        last_page = max(p["page"] for p in pages)
        for i, e in enumerate(entries):
            number = str(e.get("number", "")).strip().rstrip(".")
            if e.get("kind") == "chapter" and number:
                chapters[number] = str(e["title"]).strip()
            if not _is_lesson(e, number):
                continue
            start = e["page"]
            nxt = next((n for n in entries[i + 1:] if n["page"] > start), None)
            if nxt is None:
                end = last_page
            elif _is_back_matter(nxt) or _starts_on_top(pages, nxt):
                end = nxt["page"] - 1
            else:
                end = nxt["page"]  # the next lesson starts mid-page, so that page is shared
            lessons.append(Lesson(id=number, title=str(e["title"]).strip(), book=book, start=start, end=end))
    _stop_at_answers(lessons, books)
    return lessons, chapters


_BACK_MATTER = re.compile(r"պատասխան|բառարան|ցանկ|բովանդակ|հավելված", re.IGNORECASE)


def _is_back_matter(entry: dict) -> bool:
    return entry.get("kind") == "other" and bool(_BACK_MATTER.search(str(entry.get("title", ""))))


def _is_lesson(entry: dict, number: str) -> bool:
    """Numbered reviews ("Թեմայի ամփոփում") count as lessons — their exercises are common homework."""
    return bool(number) and (entry.get("kind") == "lesson" or (entry.get("kind") == "other" and not _is_back_matter(entry)))


def _starts_on_top(pages: list[dict], entry: dict) -> bool:
    page = next((p for p in pages if p["page"] == entry["page"]), None)
    if not page:
        return True
    head = page["markdown"][:300]
    number = str(entry.get("number", "")).rstrip(".")
    first_word = (str(entry.get("title", "")).split() or [""])[0]
    return bool(number and re.search(rf"(?<![\d.]){re.escape(number)}(?![\d])", head)) or (
        len(first_word) > 3 and first_word.lower() in head.lower()
    )


def _stop_at_answers(lessons: list[Lesson], books: dict[int, list[dict]]) -> None:
    """The tutor must never be grounded on answer pages, even if the table of contents doesn't list them."""
    for lesson in lessons:
        for p in books[lesson.book]:
            if lesson.start < p["page"] <= lesson.end and re.search(r"(?im)^\W*պատասխաններ\W*$", p["markdown"]):
                lesson.end = p["page"] - 1
                break


def attach_text(lessons: list[Lesson], books: dict[int, list[dict]]) -> None:
    for lesson in lessons:
        parts = [
            p["markdown"] for p in books[lesson.book]
            if lesson.start <= p["page"] <= lesson.end and p["markdown"]
            and not re.search(r"(?im)^\W*բովանդակություն\W*$", p["markdown"])
        ]
        lesson.text = "\n\n".join(parts).strip()


# ---------- stage 3: teacher's guide ----------

GUIDE_PROMPT = """This is the machine-extracted text of one page of an Armenian teacher's guide for grade {grade} math.
The PDF font produced artefacts: letters such as "ու" displaced or replaced by symbols, words split across lines.
Return the same text with only those artefacts fixed. Do not paraphrase, summarize or add anything.
Keep lesson headings like "Դաս 12:" at the start of their own line. Return only the corrected text.

TEXT:
{text}"""

_GUIDE_HEADING = re.compile(r"(?m)^\s*Դաս\s+(\d+(?:\.\d+)?)(?!\d)\s*[.:։․]?")


async def guide_text(cfg: dict, build: Path) -> str:
    guide = cfg.get("guide") or {}
    if "markdown" in guide:
        return (BACKEND_DIR / guide["markdown"]).read_text(encoding="utf-8")
    if "pdf" not in guide:
        return ""
    cache = build / "guide"
    cache.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(guide["pdf"])
    first, last = guide.get("pages", [1, doc.page_count])

    async def page(n: int) -> str:
        path = cache / f"p{n:03}.txt"
        if not path.is_file():
            raw = clean_raw(doc[n - 1].get_text())
            path.write_text(await ask(TEXT_MODEL, GUIDE_PROMPT.format(grade=cfg["grade"], text=raw)) if raw else "", encoding="utf-8")
        return path.read_text(encoding="utf-8")

    pages = await asyncio.gather(*(page(n) for n in range(first, last + 1)))
    print(f"  guide: {len(pages)} pages", flush=True)
    return "\n\n".join(pages)


_GUIDE_NOISE = [
    re.compile(r"(?m)^#+\s*Page\s+\d+\s*$"),                      # page markers of the extracted guide
    re.compile(r"\*?\[no extractable text[^\]]*\]\*?"),
    re.compile(r"(?m)^\s*\d{1,3}\s*$"),                           # lone printed page numbers
    re.compile(r"(?m)^\s*\d{0,3}\s*Գլուխ\s*\d+\s*[.․]\s*[^\n]{0,80}$"),  # running chapter headers
]


def _tidy(text: str) -> str:
    for noise in _GUIDE_NOISE:
        text = noise.sub("", text)
    text = re.sub(r"\n\s*\n", "\u2029", text)
    text = re.sub(r"\s*\n\s*", " ", text)
    return re.sub(r"[ \t]+", " ", text.replace("\u2029", "\n\n")).strip()


# Per-exercise notes ("Առ. 39. 1) 6 ∙ 9 = 54 …") are worked solutions: the tutor must not be grounded on them.
_EXERCISE_NOTES = re.compile(r"(?ms)^\s*Առ\.\s*\d+.*?(?=^\s*Առ\.\s*\d+|^\s*Դաս\s+\d|\Z)")


def attach_guide(lessons: list[Lesson], text: str) -> None:
    text = _EXERCISE_NOTES.sub("", text)
    by_id = {l.id: l for l in lessons}
    marks = list(_GUIDE_HEADING.finditer(text))
    sections: dict[str, list[str]] = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        sections.setdefault(m.group(1), []).append(text[m.start():end])
    for lesson_id, parts in sections.items():
        if lesson_id in by_id:
            by_id[lesson_id].guide = _tidy("\n\n".join(parts))[:GUIDE_SECTION_LIMIT]


AI_GUIDE_PROMPT = """You are an experienced Armenian primary/middle-school math teacher. The teacher's guide for this
grade {grade} textbook has no section for lesson {id} «{title}», so write one, in Armenian, in the same spirit:
- Նպատակը (goal) in one sentence;
- the key ideas/definitions/methods the lesson teaches, as the textbook presents them;
- how to lead a student to them Socratically: a short sequence of guiding questions, from easy to harder;
- 2–3 typical mistakes students make here and a question that helps them notice each one.
Do NOT solve or give answers to the lesson's exercises. At most 1500 characters. Return only the text.

LESSON TEXT:
{text}"""

_LATEX_DELIMITERS = re.compile(r"\\[()\[\]]")

AI_GUIDE_NOTE = "(Այս դասը ուսուցչի ուղեցույցում չկա. ստորև բերված ցուցումները կազմել է AI-ը՝ դասագրքի նյութի հիման վրա։)"


async def fill_missing_guides(cfg: dict, lessons: list[Lesson], build: Path) -> None:
    path = build / "ai_guides.json"
    cached = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}

    async def one(l: Lesson):
        if l.id not in cached:
            cached[l.id] = (await ask(PAGE_MODEL, AI_GUIDE_PROMPT.format(
                grade=cfg["grade"], id=l.id, title=l.title, text=l.text[:8000]))).strip()
        l.guide = f"{AI_GUIDE_NOTE}\n\n{_LATEX_DELIMITERS.sub('', cached[l.id])}"

    await asyncio.gather(*(one(l) for l in lessons if not l.guide))
    path.write_text(json.dumps(cached, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------- stage 4: summaries & chapters ----------

LESSON_SUMMARY_PROMPT = """Below is lesson {id} «{title}» of an Armenian grade {grade} math textbook.
In Armenian, write 1–2 sentences saying which concepts and methods it teaches and which kinds of problems it is
for, so that a student's homework problem can be matched to this lesson. Return only the sentences.

LESSON TEXT:
{text}"""

THEMES_PROMPT = """These are the lessons of an Armenian grade {grade} math textbook, in order. Group them into 5–9
themes of CONSECUTIVE lessons that belong together (like textbook chapters). Every lesson must be in exactly one theme.
Return JSON: {{"themes": [{{"title": "<short Armenian theme title>", "lessons": ["<lesson number>", ...]}}]}}

LESSONS:
{lessons}"""

CHAPTER_SUMMARY_PROMPT = """These are the lessons of the chapter «{title}» of an Armenian grade {grade} math textbook.
In Armenian, write 2–3 sentences in this style: "Այս գլուխը ներկայացնում է … Հարմար է … վերաբերող խնդիրների համար։"
Return only the sentences.

LESSONS:
{lessons}"""


async def stage_summaries(cfg: dict, lessons: list[Lesson], chapters: dict[str, str], build: Path) -> dict[str, str]:
    path = build / "summaries.json"
    cached = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"lessons": {}, "chapters": {}, "themes": None}

    async def lesson_summary(l: Lesson):
        if l.id not in cached["lessons"]:
            cached["lessons"][l.id] = (await ask(TEXT_MODEL, LESSON_SUMMARY_PROMPT.format(
                id=l.id, title=l.title, grade=cfg["grade"], text=l.text[:6000] or l.title))).strip()
        l.summary = cached["lessons"][l.id]

    await asyncio.gather(*(lesson_summary(l) for l in lessons))

    if all("." in l.id for l in lessons):
        for l in lessons:
            l.chapter = l.id.split(".")[0]
        chapter_titles = {n: f"Գլուխ {n}. {re.sub(r'^Գլուխ\s*\d+\.?\s*', '', t)}" for n, t in chapters.items()}
    else:
        if not cached["themes"]:
            listing = "\n".join(f"{l.id}. {l.title}" for l in lessons)
            cached["themes"] = parse_json(await ask(TEXT_MODEL, THEMES_PROMPT.format(grade=cfg["grade"], lessons=listing), json_mode=True)).get("themes", [])
        chapter_titles = {}
        owner = {}
        for n, theme in enumerate(cached["themes"], start=1):
            chapter_titles[str(n)] = f"Թեմա {n}. {theme['title']}"
            for lesson_id in theme.get("lessons", []):
                owner.setdefault(str(lesson_id), str(n))
        current = "1"
        for l in lessons:
            current = owner.get(l.id, current)
            l.chapter = current

    async def chapter_summary(n: str, title: str):
        if n not in cached["chapters"]:
            listing = "\n".join(f"- {l.id} {l.title}: {l.summary}" for l in lessons if l.chapter == n)
            cached["chapters"][n] = (await ask(TEXT_MODEL, CHAPTER_SUMMARY_PROMPT.format(title=title, grade=cfg["grade"], lessons=listing))).strip()

    used = {l.chapter for l in lessons}
    chapter_titles = {n: t for n, t in chapter_titles.items() if n in used}
    for n in used - set(chapter_titles):
        chapter_titles[n] = f"Գլուխ {n}"
    await asyncio.gather(*(chapter_summary(n, t) for n, t in chapter_titles.items()))
    path.write_text(json.dumps(cached, ensure_ascii=False, indent=1), encoding="utf-8")
    return chapter_titles


# ---------- stage 5: output ----------

def lesson_markdown(l: Lesson, chapter_title: str) -> str:
    parts = [f"# Դաս {l.id}. {l.title}", f"({chapter_title} · դասագրքի էջեր {l.start}–{l.end})", "", "## Դասագիրք", "", l.text]
    if l.guide:
        parts += ["", "## Ուսուցչի ուղեցույց — ինչպես է դասավանդվում այս դասը", "", l.guide]
    return "\n".join(parts).strip() + "\n"


def stage_output(cfg: dict, lessons: list[Lesson], chapter_titles: dict[str, str], build: Path) -> Path:
    grade = cfg["grade"]
    out = build / "out"
    if out.exists():
        shutil.rmtree(out)
    (out / "lessons").mkdir(parents=True)
    summaries = json.loads((build / "summaries.json").read_text(encoding="utf-8"))
    names = cfg.get("chapter_files", {})
    chapter_files = {n: names.get(n, f"{int(n):02d}-chapter-{n}.md") for n in chapter_titles}

    index = []
    for l in lessons:
        file = f"lessons/{l.id}.md"
        (out / file).write_text(lesson_markdown(l, chapter_titles[l.chapter]), encoding="utf-8")
        index.append({"id": l.id, "title": l.title, "chapter": l.chapter, "chapter_file": chapter_files[l.chapter],
                      "pages": [l.start, l.end], "summary": l.summary, "file": file, "has_guide": bool(l.guide)})
    (out / "lessons.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    chapter_index = []
    for n in sorted(chapter_titles, key=int):
        body = "\n\n".join(f"## Դաս {l.id}. {l.title}\n\n{l.text}" for l in lessons if l.chapter == n)
        (out / chapter_files[n]).write_text(f"# Մաթեմատիկա {grade}-րդ դասարան — Դասագիրք\n\n## {chapter_titles[n]}\n\n{body}\n", encoding="utf-8")
        chapter_index.append({"file": chapter_files[n], "title": chapter_titles[n], "summary": summaries["chapters"].get(n, "")})
    (out / "chapter_summaries.json").write_text(json.dumps(chapter_index, ensure_ascii=False, indent=1), encoding="utf-8")

    exercises = CONTENT_DIR / f"grade-{grade}" / "exercises.json"
    if exercises.is_file():
        shutil.copy(exercises, out / "exercises.json")

    report = [f"# Build report — grade {grade} — {datetime.now():%Y-%m-%d %H:%M}", "",
              f"{len(lessons)} lessons, {len(chapter_titles)} chapters/themes", "",
              "| Lesson | Title | Pages | Textbook chars | Guide chars |", "|---|---|---|---|---|"]
    report += [f"| {l.id} | {l.title} | {l.start}–{l.end} | {len(l.text)} | {len(l.guide) or '**none**'} |" for l in lessons]
    (build / "report.md").write_text("\n".join(report), encoding="utf-8")
    return out


def install(cfg: dict, build: Path) -> None:
    out = build / "out"
    if not (out / "lessons.json").is_file():
        raise SystemExit("Nothing to install — run the build first")
    target = CONTENT_DIR / f"grade-{cfg['grade']}"
    if target.exists():
        backup = build / f"backup-{datetime.now():%Y%m%d-%H%M%S}"
        shutil.copytree(target, backup)
        print(f"Backed up the current content to {backup}")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(out, target, dirs_exist_ok=True)
    print(f"Installed into {target}. Restart the backend so it loads the new grade.")


async def build(cfg: dict) -> None:
    out_dir = BACKEND_DIR / "build" / f"grade-{cfg['grade']}"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[1/5] reading pages with {PAGE_MODEL} …", flush=True)
    books = await stage_pages(cfg, out_dir)
    print("[2/5] table of contents …", flush=True)
    lessons, chapters = await stage_toc(cfg, books, out_dir)
    attach_text(lessons, books)
    print(f"      {len(lessons)} lessons found", flush=True)
    print("[3/5] teacher's guide …", flush=True)
    attach_guide(lessons, await guide_text(cfg, out_dir))
    print(f"      guide sections matched for {sum(bool(l.guide) for l in lessons)}/{len(lessons)} lessons", flush=True)
    missing = [l.id for l in lessons if not l.guide]
    if missing:
        print(f"      writing AI teacher's notes for lessons without a guide section: {', '.join(missing)}", flush=True)
        await fill_missing_guides(cfg, lessons, out_dir)
    print("[4/5] summaries …", flush=True)
    chapter_titles = await stage_summaries(cfg, lessons, chapters, out_dir)
    print("[5/5] writing output …", flush=True)
    out = stage_output(cfg, lessons, chapter_titles, out_dir)
    print(f"Done: {out}\nReport: {out_dir / 'report.md'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    parser.add_argument("--install", action="store_true", help="copy the finished build into content/")
    args = parser.parse_args()
    cfg = json.loads((BACKEND_DIR / args.config).read_text(encoding="utf-8"))
    if args.install:
        install(cfg, BACKEND_DIR / "build" / f"grade-{cfg['grade']}")
    else:
        asyncio.run(build(cfg))


if __name__ == "__main__":
    main()
