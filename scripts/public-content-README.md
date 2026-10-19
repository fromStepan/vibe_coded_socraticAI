# Textbook content is not included in this public repository

The tutor reads its textbooks from this folder (`backend/content/grade-N/`), but the textbook and teacher's-guide
text belongs to its publishers, so it is not published here.

To run the tutor, build the content from your own copies of the PDFs with the book builder:

1. Write `backend/books/grade-N.json` with the paths to the textbook PDF(s) and the teacher's guide
   (see `backend/books/grade-4.json`).
2. `cd backend && uv run python -m app.tools.build_content books/grade-N.json`
3. Check `backend/build/grade-N/report.md`, then
   `uv run python -m app.tools.build_content books/grade-N.json --install`
4. Optional: an exercise list for the «Դասագրքից» tab:
   `uv run python -m app.tools.build_exercises --grade N`

See the main README ("How the textbooks are read") for details.
