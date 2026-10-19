import json
import sqlite3
import uuid
from datetime import datetime, timezone

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'student')),
    grade         TEXT NOT NULL DEFAULT '5',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem        TEXT NOT NULL,
    grade          TEXT NOT NULL,
    topic          TEXT NOT NULL,
    chapter_files  TEXT NOT NULL,          -- JSON list of grounding units (lesson ids or chapter files); empty = out of curriculum
    route_reason   TEXT NOT NULL DEFAULT '',
    correct_answer TEXT NOT NULL DEFAULT '',
    answer_source  TEXT NOT NULL DEFAULT '', -- 'textbook' | 'computed' | ''
    exercise_id    INTEGER,
    llm_messages   TEXT NOT NULL,          -- JSON; system prompt is rebuilt from files on demand
    stage          TEXT NOT NULL DEFAULT 'understand',
    completed      INTEGER NOT NULL DEFAULT 0,
    hints_used     INTEGER NOT NULL DEFAULT 0,
    wrong_attempts INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    completed_at   TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender          TEXT NOT NULL CHECK (sender IN ('tutor', 'student')),
    text            TEXT NOT NULL,
    type            TEXT NOT NULL,
    stage           TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guard_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id      TEXT REFERENCES messages(id) ON DELETE CASCADE,
    attempt         INTEGER NOT NULL,
    draft           TEXT NOT NULL,
    leaked          INTEGER NOT NULL,
    method          TEXT NOT NULL,
    reason          TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating          INTEGER NOT NULL CHECK (rating IN (-1, 1)),
    comment         TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_guard_conv ON guard_events(conversation_id);
"""

conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA foreign_keys=ON")
conn.executescript(SCHEMA)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def one(sql: str, *args) -> dict | None:
    row = conn.execute(sql, args).fetchone()
    return dict(row) if row else None


def all_rows(sql: str, *args) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def run(sql: str, *args) -> sqlite3.Cursor:
    return conn.execute(sql, args)


def load_conversation(conversation_id: str) -> dict | None:
    conv = one("SELECT * FROM conversations WHERE id = ?", conversation_id)
    if conv:
        conv["chapter_files"] = json.loads(conv["chapter_files"])
        conv["llm_messages"] = json.loads(conv["llm_messages"])
        conv["completed"] = bool(conv["completed"])
    return conv


def save_conversation(conv: dict) -> None:
    conv["updated_at"] = now()
    run(
        """UPDATE conversations SET llm_messages = ?, stage = ?, completed = ?, hints_used = ?,
           wrong_attempts = ?, updated_at = ?, completed_at = ? WHERE id = ?""",
        json.dumps(conv["llm_messages"], ensure_ascii=False),
        conv["stage"], int(conv["completed"]), conv["hints_used"], conv["wrong_attempts"],
        conv["updated_at"], conv.get("completed_at"), conv["id"],
    )


def add_message(conversation_id: str, sender: str, text: str, type_: str, stage: str) -> dict:
    msg = {"id": new_id(), "sender": sender, "text": text, "type": type_, "stage": stage, "created_at": now()}
    run(
        "INSERT INTO messages (id, conversation_id, sender, text, type, stage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        msg["id"], conversation_id, sender, text, type_, stage, msg["created_at"],
    )
    return msg


def add_guard_events(conversation_id: str, message_id: str, attempts) -> None:
    for a in attempts:
        run(
            """INSERT INTO guard_events (conversation_id, message_id, attempt, draft, leaked, method, reason, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            conversation_id, message_id, a.attempt, a.draft, int(a.leaked), a.method, a.reason, now(),
        )
