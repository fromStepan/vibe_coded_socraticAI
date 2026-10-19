"""Dumps tester feedback with full conversation context into one markdown file.

    cd backend && uv run python -m app.tools.feedback_report          # 👎 only
    cd backend && uv run python -m app.tools.feedback_report --all    # 👍 and 👎
"""
import argparse
from datetime import datetime

from .. import db
from ..config import ROOT_DIR


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    where = "" if args.all else "WHERE f.rating = -1"
    rows = db.all_rows(
        f"""SELECT f.*, u.display_name FROM feedback f JOIN users u ON u.id = f.user_id {where}
            ORDER BY f.conversation_id, f.created_at"""
    )
    lines = [f"# Feedback report — {datetime.now():%Y-%m-%d %H:%M}", f"{len(rows)} feedback item(s)", ""]
    by_conv: dict[str, list[dict]] = {}
    for r in rows:
        by_conv.setdefault(r["conversation_id"], []).append(r)

    for conv_id, items in by_conv.items():
        conv = db.one("SELECT c.*, u.display_name FROM conversations c JOIN users u ON u.id = c.user_id WHERE c.id = ?", conv_id)
        flagged = {i["message_id"]: i for i in items}
        lines += [
            f"## {conv['display_name']} — {conv['topic']} ({conv_id})",
            f"- Problem: {conv['problem']}",
            f"- Secret answer ({conv['answer_source']}): `{conv['correct_answer']}`",
            "",
        ]
        for m in db.all_rows("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid", conv_id):
            who = "Tutor" if m["sender"] == "tutor" else "Student"
            lines.append(f"**{who}** _{m['type']}_: {m['text']}")
            if m["id"] in flagged:
                f = flagged[m["id"]]
                lines.append(f"> {'👎' if f['rating'] == -1 else '👍'} **{f['display_name']}:** {f['comment'] or '(no comment)'}")
                for g in db.all_rows("SELECT * FROM guard_events WHERE message_id = ? ORDER BY attempt", m["id"]):
                    lines.append(f">   guard attempt {g['attempt']} [{g['method']}] leaked={bool(g['leaked'])}: {g['reason']}")
            lines.append("")
        lines.append("---")

    out_dir = ROOT_DIR / "reports"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"feedback-{datetime.now():%Y%m%d-%H%M%S}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(path)


if __name__ == "__main__":
    main()
