# Սոկրատ — Socratic math tutor (Armenian, grades 4–5)

A homework helper that **never tells the answer**. It guides the student with one short question at a time
until they solve the problem themselves. Rebuilt from the Hack Armenia "ARMLLM" project, using the same
design and the same Socratic prompts, plus logins, an admin console and tools for live testing.

## Start it

```bash
./start.sh
```

Then open **http://localhost:5173**.

- **Admin:** `admin` / `admin123` (change it in `.env` *before* the first start, or later on the Profile page).
- **Students:** register on the login page, or the admin creates accounts under *Օգտատերեր*.

Needs `uv` and `pnpm` (both already installed on this Mac) and an API key in `.env` (see `.env.example`).

## What each role sees

| | Student | Admin |
|---|---|---|
| Own chats & progress | ✅ only their own | ✅ (can also test as a student) |
| All chats of all students | — | ✅ grouped by student, topic or day; filter + search |
| Hidden answer, rejected drafts, why the guard blocked them | — | ✅ |
| 👍/👎 + comment on any tutor reply | ✅ | ✅ and a *Կարծիքներ* page listing them all |
| Manage accounts | — | ✅ create, reset password, delete |

## How a reply is made (the no-answer guardrail)

1. **Route** the problem to the right textbook lesson(s) (`prompts/router.md` + `prompts/router_lessons.md`; see
   "How the textbooks are read"). If nothing matches, the tutor switches to a friendly "outside the curriculum"
   mode that just explains (`prompts/out_of_scope_system.md`).
2. **Hidden answer**: textbook exercises use the book's verified answer; free-text problems are solved once by
   the AI with an exact calculator (`prompts/answer_solver.md`). The student never sees it.
3. **Draft** a reply with the team's Socratic instruction prompt (`prompts/socratic_system.md`).
4. **Guard**, every reply, before the student sees it:
   - *number scan*: blocks the draft if it contains the answer or an equivalent form (19/12 = 1 7/12, 1,5 = 3/2 …);
   - *LLM-as-judge* (`prompts/leak_check.md`): blocks direct leaks, "one step away" replies and confirm/deny of values;
   - blocked → rewrite with `prompts/leak_retry_notice.md` (up to 2 times) → else a safe fallback question.
   - *style check* (free, after the leak checks): at most one question, about two short lines, informal «դու».
     A reply that breaks these gets one rewrite (`prompts/style_retry_notice.md`), and the rewrite must pass the
     leak guard again. Style is soft: if the rewrite still breaks it, the leak-safe reply is used anyway.
5. **Answer check** (`prompts/answer_compare.md`) runs on the "I know the answer" button *and* on normal chat
   messages, so a correct answer is recognised however the student writes it.

## Photo of a homework problem

On the New task page, **📷** takes a photo (it opens the camera on a phone) or picks an image.
- `PHOTO_MODEL` (default `gpt-5.5`) writes out the problem(s) exactly (`prompts/photo_transcribe.md`), marking
  unreadable parts as [?] and never solving.
- If the photo shows a **textbook exercise**, its number and wording are matched against the corrected book, and
  the book's exact text is used instead («✓ Այս խնդիրը գտա դասագրքում»). Photo reading can misread small digits
  (2/7 → 2/5), so this matters.
- Anything else stays as read, with a reminder for the student to check the numbers before starting.
- If there are several problems, the student picks one. The photo itself is not stored.

## Voice (read aloud)

Every tutor reply has a **🔊 Լսել** button, and the chat has an **Ավտոմատ** switch (reads each new reply
aloud) plus speed 0.75× / 1× / 1.25×. It uses OpenAI `gpt-4o-mini-tts` (voice `coral`) and needs `OPENAI_API_KEY`.
Before speaking, math is rewritten into spoken Armenian (`3/4` → «երեք չորրորդ», `1 7/12` → «մեկ ամբողջ յոթ
տասներկուերորդ», `5-րդ` → «հինգերորդ», `կգ` → «կիլոգրամ»). How the voice should sound (pace, warmth, stress) lives
in `prompts/tts_instructions.md`. Edit it and new recordings follow it. Change the voice with `TTS_VOICE` in `.env`.

## Improving it during live testing

- **Prompts are plain text in `backend/prompts/`.** Edit and save, and the next message uses the new version
  (no restart needed, and it also applies to chats that are already open).
- **Feedback loop:** testers press 👎 and write what was wrong. Admin → *Կարծիքներ* shows them all,
  or export everything with full context:
  ```bash
  cd backend && uv run python -m app.tools.feedback_report      # → reports/feedback-*.md
  ```
- **Regression test for leaks** (the team's attack battery, run against the real pipeline):
  ```bash
  cd backend && uv run python -m app.tools.leak_test               # fractions battery (18 attacks)
  cd backend && uv run python -m app.tools.leak_test --exercise 9  # any textbook exercise
  ```
  Re-run it after every prompt change. It exits with an error if any shown reply leaked.

## How the textbooks are read (grades 4 and 5)

The books are turned into **one clean file per lesson** by a book builder, once per book:

1. **Every page is re-read** by `gpt-5.5` from the page *image* plus its raw text (the PDF text, or Tesseract OCR
   for scans). It may only *correct*, never rewrite. This restored the fractions that the old OCR destroyed
   ("1/2 is read «մեկ երկրորդ»" had become "7 բաժինը…"), fixed «և», and rebuilt tables.
2. **Lessons and page ranges** come from the book's own table of contents. Numbered reviews («Թեմայի ամփոփում»)
   count as lessons. Answer pages are always left out.
3. **The teacher's guide** section for each lesson (its goal and «Դասի ընթացքը», how it is taught) is attached.
   Exercise-specific worked solutions in the guide («Առ. 39. 1) 6 ∙ 9 = 54 …») are removed, so the tutor never
   reads an answer.
4. **Short summaries** per lesson and per chapter are generated for the router. Grade 4 has no chapters, so its
   lessons are grouped into 7 themes.

**Which lesson the tutor uses** for a new problem:
- The chapter router decides scope (and "outside the curriculum").
- A text lookup finds the lesson where a textbook problem is printed.
- The lesson router (`ROUTER_MODEL`, once per chat) picks the lesson that teaches the method.

The tutor then reads those 1–3 lessons plus a one-line outline of the chapter: about 4,800 tokens per reply
instead of about 20,000 for whole chapters. If the lesson step fails, it falls back to whole chapters.

```bash
cd backend && uv run python -m app.tools.route_eval   # grade 5: router vs the 20 labelled exercises
```

**Gaps are filled the way a teacher would fill them.** Lessons with no teacher's-guide section get an AI-written
Socratic teaching note, clearly marked as such. Grades whose book has no answer pages (grade 4) get their
"Դասագրքից" list from `app.tools.build_exercises`:
- suitable exercises are picked from each lesson;
- each is solved twice, by `gpt-5.5` reasoning step by step and by `gpt-4.1` with the calculator;
- only exercises where both answers agree are kept;
- lessons left with fewer than 4 exercises get new teacher-made problems, shown as «✨ լրացուցիչ» and checked the
  same way.

```bash
cd backend && uv run python -m app.tools.build_exercises --grade 4 --replace
```

**Admins can test any grade.** On the New task page, the yellow «Փորձարկել որպես … դասարանցի» bar chooses the
grade for that test chat.

## Adding a new book or grade

1. Write `backend/books/grade-N.json` (copy `grade-4.json`): textbook PDF paths, and the guide PDF plus its lesson pages.
2. Build it into a staging folder (the slow step is about 1 page per 6 seconds; it resumes if stopped):
   `cd backend && uv run python -m app.tools.build_content books/grade-N.json`
3. Read `backend/build/grade-N/report.md` (lessons, pages, guide matched), then install. The current content is
   backed up first: `uv run python -m app.tools.build_content books/grade-N.json --install`
4. Restart. The grade then appears in registration and on the Profile page.

The original PDFs stay where they are (e.g. on the Desktop). Only the cleaned text is copied into the project.

## Layout

```
backend/   FastAPI + SQLite (data in backend/data/tutor.db)
  app/       main.py (API) · tutor.py (pipeline + guard) · auth.py · db.py · llm.py · calculator.py
  prompts/   every instruction the AI gets — edit freely
  content/   textbooks per grade (lessons.json + lessons/*.md + chapter files) — what the tutor reads
  books/     book-builder configs (PDF paths) and the grade-5 guide text
  build/     book-builder working files, reports and content backups (not used at runtime)
frontend/  React + Vite + Tailwind, same design tokens as the hackathon app
reports/   output of the leak test and feedback report
```

Switch the AI provider in `.env` with `LLM_PROVIDER=openai | gemini | openrouter`. You can also set a cheaper
`JUDGE_MODEL` for the checks.
