import asyncio
import json
import logging
from collections import defaultdict
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, content, db, prompts, speech, tutor
from .config import ALLOW_SIGNUP, AUTH_COOKIE, AUTH_TTL_DAYS, LLM_PROVIDER, ROOT_DIR, SUPPORTED_GRADES, TUTOR_MODEL

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tutor.api")

app = FastAPI(title="Socratic Tutor")
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

HINT_REQUEST_TEXT = "Կարո՞ղ ես հուշում տալ, չեմ հասկանում՝ ինչպես շարունակել:"


@app.on_event("startup")
def _startup() -> None:
    auth.ensure_admin()
    log.info("LLM provider=%s model=%s grades=%s", LLM_PROVIDER, TUTOR_MODEL, SUPPORTED_GRADES)


# ---------- auth ----------

class LoginBody(BaseModel):
    username: str
    password: str


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=6, max_length=200)
    displayName: str = Field(min_length=1, max_length=60)
    grade: str = "5"


class ProfileBody(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=60)
    grade: str | None = None
    currentPassword: str | None = None
    newPassword: str | None = Field(default=None, min_length=6, max_length=200)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(AUTH_COOKIE, token, httponly=True, samesite="lax", max_age=AUTH_TTL_DAYS * 86400, path="/")


def _check_grade(grade: str) -> str:
    if grade not in SUPPORTED_GRADES:
        raise HTTPException(400, f"Grade {grade} is not available yet")
    return grade


@app.get("/api/auth/config")
def auth_config():
    return {"allowSignup": ALLOW_SIGNUP, "grades": SUPPORTED_GRADES, "tts": speech.TTS_ENABLED}


@app.post("/api/auth/login")
def login(body: LoginBody, response: Response):
    user = db.one("SELECT * FROM users WHERE username = ?", body.username.strip())
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Սխալ օգտանուն կամ գաղտնաբառ")
    _set_cookie(response, auth.issue_token(user["id"]))
    return auth.public_user(user)


@app.post("/api/auth/register")
def register(body: RegisterBody, response: Response):
    if not ALLOW_SIGNUP:
        raise HTTPException(403, "Sign-up is disabled")
    _check_grade(body.grade)
    if db.one("SELECT id FROM users WHERE username = ?", body.username.strip()):
        raise HTTPException(409, "Այս օգտանունն արդեն զբաղված է")
    user = auth.create_user(body.username, body.password, body.displayName, "student", body.grade)
    _set_cookie(response, auth.issue_token(user["id"]))
    return auth.public_user(user)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    if token := request.cookies.get(AUTH_COOKIE):
        auth.revoke_token(token)
    response.delete_cookie(AUTH_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(auth.current_user)):
    return auth.public_user(user)


@app.patch("/api/auth/me")
def update_me(body: ProfileBody, user: dict = Depends(auth.current_user)):
    if body.displayName is not None:
        db.run("UPDATE users SET display_name = ? WHERE id = ?", body.displayName.strip(), user["id"])
    if body.grade is not None:
        db.run("UPDATE users SET grade = ? WHERE id = ?", _check_grade(body.grade), user["id"])
    if body.newPassword:
        if not body.currentPassword or not auth.verify_password(body.currentPassword, user["password_hash"]):
            raise HTTPException(400, "Ընթացիկ գաղտնաբառը սխալ է")
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", auth.hash_password(body.newPassword), user["id"])
    return auth.public_user(db.one("SELECT * FROM users WHERE id = ?", user["id"]))


# ---------- helpers ----------

def _advance_stage(conv: dict, event: Literal["student_message", "hint", "wrong_answer", "correct_answer"]) -> None:
    if event == "correct_answer":
        conv["stage"], conv["completed"], conv["completed_at"] = "reflect", True, db.now()
    elif event in ("hint", "wrong_answer"):
        conv["stage"] = "solve"
    elif conv["stage"] == "understand":
        conv["stage"] = "plan"
    elif conv["stage"] == "plan":
        conv["stage"] = "solve"


def _history(conv: dict, user: dict) -> list[dict]:
    """The system prompt and the problem are rebuilt from files each turn, so prompt edits apply to running chats."""
    owner = user if user["id"] == conv["user_id"] else db.one("SELECT * FROM users WHERE id = ?", conv["user_id"])
    return [
        {"role": "system", "content": tutor.system_prompt(conv["grade"], conv["chapter_files"], owner["display_name"])},
        {"role": "user", "content": conv["problem"]},
        *conv["llm_messages"],
    ]


def _owned_conversation(conversation_id: str, user: dict) -> dict:
    conv = db.load_conversation(conversation_id)
    if not conv or (conv["user_id"] != user["id"] and user["role"] != "admin"):
        raise HTTPException(404, "Conversation not found")
    return conv


def _writable_conversation(conversation_id: str, user: dict) -> dict:
    conv = _owned_conversation(conversation_id, user)
    if conv["user_id"] != user["id"]:
        raise HTTPException(403, "Only the student who owns this chat can write in it")
    if conv["completed"]:
        raise HTTPException(409, "This problem is already solved")
    return conv


def _public_message(m: dict) -> dict:
    return {
        "id": m["id"], "sender": m["sender"], "text": m["text"],
        "type": m["type"], "stage": m["stage"], "createdAt": m["created_at"],
    }


def _turn_result(conv: dict, *msgs: dict, correct: bool | None = None) -> dict:
    return {
        "messages": [_public_message(m) for m in msgs],
        "stage": conv["stage"],
        "completed": conv["completed"],
        "hintsUsed": conv["hints_used"],
        "correct": correct,
    }


async def _guarded(conv: dict, history: list[dict], first_draft: str | None = None) -> tutor.GuardedReply:
    if not conv["chapter_files"]:
        return tutor.GuardedReply(text=await tutor.plain_reply(history))
    return await tutor.safe_reply(history, conv["problem"], conv["correct_answer"], first_draft=first_draft)


def _llm_error(e: Exception) -> HTTPException:
    log.exception("LLM pipeline failed")
    return HTTPException(502, f"Tutor is temporarily unavailable ({type(e).__name__}). Please try again.")


# ---------- textbook ----------

@app.get("/api/exercises")
def list_exercises(grade: str | None = None, user: dict = Depends(auth.current_user)):
    return content.public_exercises(_check_grade(grade or user["grade"]))


# ---------- conversations ----------

class StartBody(BaseModel):
    problem: str | None = Field(default=None, max_length=4000)
    exerciseId: int | None = None
    grade: str | None = None  # admins only, for testing other grades


class ChatBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class AnswerBody(BaseModel):
    answer: str = Field(min_length=1, max_length=1000)


SUMMARY_SQL = """
SELECT c.id, c.user_id, c.problem, c.topic, c.grade, c.stage, c.completed, c.hints_used, c.wrong_attempts,
       c.chapter_files, c.exercise_id, c.created_at, c.updated_at, c.completed_at,
       u.display_name, u.username,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
       (SELECT COUNT(*) FROM guard_events g WHERE g.conversation_id = c.id AND g.leaked = 1) AS leaks_caught,
       (SELECT COUNT(*) FROM feedback f WHERE f.conversation_id = c.id AND f.rating = -1) AS thumbs_down,
       (SELECT COUNT(*) FROM feedback f WHERE f.conversation_id = c.id AND f.rating = 1) AS thumbs_up,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.type = 'fallback') AS fallbacks
FROM conversations c JOIN users u ON u.id = c.user_id
"""


def _summary(row: dict, admin: bool) -> dict:
    data = {
        "id": row["id"],
        "problem": row["problem"],
        "topic": row["topic"],
        "grade": row["grade"],
        "stage": row["stage"],
        "completed": bool(row["completed"]),
        "hintsUsed": row["hints_used"],
        "wrongAttempts": row["wrong_attempts"],
        "outOfScope": json.loads(row["chapter_files"]) == [],
        "fromTextbook": row["exercise_id"] is not None,
        "messageCount": row["message_count"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "completedAt": row["completed_at"],
    }
    if admin:
        data |= {
            "userId": row["user_id"],
            "studentName": row["display_name"],
            "username": row["username"],
            "leaksCaught": row["leaks_caught"],
            "fallbacks": row["fallbacks"],
            "thumbsDown": row["thumbs_down"],
            "thumbsUp": row["thumbs_up"],
        }
    return data


@app.get("/api/conversations")
def my_conversations(user: dict = Depends(auth.current_user)):
    rows = db.all_rows(SUMMARY_SQL + " WHERE c.user_id = ? ORDER BY c.updated_at DESC", user["id"])
    return [_summary(r, admin=False) for r in rows]


@app.post("/api/conversations")
async def start_conversation(body: StartBody, user: dict = Depends(auth.current_user)):
    grade = _check_grade(body.grade if (body.grade and user["role"] == "admin") else user["grade"])
    exercise = None
    if body.exerciseId is not None:
        exercise = content.exercise(grade, body.exerciseId)
        if not exercise:
            raise HTTPException(404, "Exercise not found")
        problem = exercise["question_hy"]
    else:
        problem = (body.problem or "").strip()
        if not problem:
            raise HTTPException(400, "Problem text is empty")

    try:
        if exercise:
            chapter_files, route_reason = content.units_for_exercise(grade, exercise), "Textbook exercise"
        else:
            chapter_files, route_reason = await tutor.route(problem, grade)

        conv = {
            "id": db.new_id(), "user_id": user["id"], "problem": problem, "grade": grade,
            "topic": content.topic_for(grade, chapter_files), "chapter_files": chapter_files,
            "correct_answer": "", "answer_source": "", "llm_messages": [],
            "stage": "understand", "completed": False, "hints_used": 0, "wrong_attempts": 0,
        }
        history = _history(conv, user)

        if not chapter_files:
            guarded = await _guarded(conv, history)
        else:
            if exercise:
                conv["correct_answer"] = exercise["answer_raw"]
                conv["answer_source"] = exercise.get("answer_source", "textbook")
                first_draft = await tutor.draft_reply(history)
            else:
                text = content.grounding_text(grade, tuple(chapter_files))
                conv["correct_answer"], first_draft = await asyncio.gather(
                    tutor.solve(problem, grade, text), tutor.draft_reply(history),
                )
                conv["answer_source"] = "computed"
            guarded = await _guarded(conv, history, first_draft=first_draft)
    except HTTPException:
        raise
    except Exception as e:
        raise _llm_error(e)

    created = db.now()
    db.run(
        """INSERT INTO conversations (id, user_id, problem, grade, topic, chapter_files, route_reason, correct_answer,
           answer_source, exercise_id, llm_messages, stage, completed, hints_used, wrong_attempts, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'understand', 0, 0, 0, ?, ?)""",
        conv["id"], user["id"], problem, grade, conv["topic"], json.dumps(chapter_files), route_reason,
        conv["correct_answer"], conv["answer_source"], body.exerciseId, created, created,
    )
    conv["llm_messages"].append({"role": "assistant", "content": guarded.text})
    msg = db.add_message(conv["id"], "tutor", guarded.text, "fallback" if guarded.used_fallback else "question", conv["stage"])
    db.add_guard_events(conv["id"], msg["id"], guarded.attempts)
    speech.prepare_in_background(msg["id"], msg["text"])
    db.save_conversation(conv)
    return {"id": conv["id"]}


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: str, user: dict = Depends(auth.current_user)):
    conv = _owned_conversation(conversation_id, user)
    is_admin = user["role"] == "admin"
    messages = db.all_rows("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid", conversation_id)
    my_feedback = {
        f["message_id"]: {"rating": f["rating"], "comment": f["comment"]}
        for f in db.all_rows("SELECT * FROM feedback WHERE conversation_id = ? AND user_id = ?", conversation_id, user["id"])
    }
    row = db.one(SUMMARY_SQL + " WHERE c.id = ?", conversation_id)
    result = {
        **_summary(row, admin=is_admin),
        "isOwner": conv["user_id"] == user["id"],
        "messages": [{**_public_message(m), "feedback": my_feedback.get(m["id"])} for m in messages],
    }
    if is_admin:
        guard = defaultdict(list)
        for g in db.all_rows("SELECT * FROM guard_events WHERE conversation_id = ? ORDER BY id", conversation_id):
            guard[g["message_id"]].append({
                "attempt": g["attempt"], "draft": g["draft"], "leaked": bool(g["leaked"]),
                "method": g["method"], "reason": g["reason"],
            })
        all_feedback = defaultdict(list)
        for f in db.all_rows(
            "SELECT f.*, u.display_name FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.conversation_id = ?",
            conversation_id,
        ):
            all_feedback[f["message_id"]].append({"rating": f["rating"], "comment": f["comment"], "by": f["display_name"]})
        for m in result["messages"]:
            m["guard"] = guard.get(m["id"], [])
            m["allFeedback"] = all_feedback.get(m["id"], [])
        result["debug"] = {
            "correctAnswer": conv["correct_answer"],
            "answerSource": conv["answer_source"],
            "chapterFiles": conv["chapter_files"],
            "groundingLabels": [content.unit_label(conv["grade"], u) for u in conv["chapter_files"]],
            "routeReason": conv["route_reason"],
            "exerciseId": conv["exercise_id"],
        }
    return result


@app.post("/api/conversations/{conversation_id}/chat")
async def chat(conversation_id: str, body: ChatBody, user: dict = Depends(auth.current_user)):
    async with _locks[conversation_id]:
        conv = _writable_conversation(conversation_id, user)
        text = body.text.strip()
        conv["llm_messages"].append({"role": "user", "content": text})
        history = _history(conv, user)
        try:
            if conv["chapter_files"]:
                # A student often states the final answer in plain chat; check it while the draft is being written.
                is_correct, first_draft = await asyncio.gather(
                    tutor.is_correct_final_answer(conv["problem"], conv["correct_answer"], text),
                    tutor.draft_reply(history),
                )
            else:
                is_correct, first_draft = False, None

            if is_correct:
                conv["llm_messages"].append({
                    "role": "system",
                    "content": "The student's message above was checked by a separate system and found to state the CORRECT final answer.",
                })
                guarded = tutor.GuardedReply(text=prompts.correct_reply())
                student_type, tutor_type = "know_answer", "correct"
            else:
                guarded = await _guarded(conv, history, first_draft=first_draft)
                student_type, tutor_type = "student_response", "guiding_question"
        except Exception as e:
            raise _llm_error(e)

        student_msg = db.add_message(conv["id"], "student", text, student_type, conv["stage"])
        _advance_stage(conv, "correct_answer" if is_correct else "student_message")
        conv["llm_messages"].append({"role": "assistant", "content": guarded.text})
        tutor_msg = db.add_message(conv["id"], "tutor", guarded.text, "fallback" if guarded.used_fallback else tutor_type, conv["stage"])
        db.add_guard_events(conv["id"], tutor_msg["id"], guarded.attempts)
        speech.prepare_in_background(tutor_msg["id"], tutor_msg["text"])
        db.save_conversation(conv)
        return _turn_result(conv, student_msg, tutor_msg, correct=is_correct or None)


@app.post("/api/conversations/{conversation_id}/hint")
async def hint(conversation_id: str, user: dict = Depends(auth.current_user)):
    async with _locks[conversation_id]:
        conv = _writable_conversation(conversation_id, user)
        conv["hints_used"] += 1
        conv["llm_messages"].append({
            "role": "user",
            "content": f"[STUDENT ACTION] The student explicitly asked for a hint because they are stuck. "
                       f"This is hint request #{conv['hints_used']} in this conversation.",
        })
        try:
            guarded = await _guarded(conv, _history(conv, user))
        except Exception as e:
            raise _llm_error(e)

        student_msg = db.add_message(conv["id"], "student", HINT_REQUEST_TEXT, "hint_request", conv["stage"])
        _advance_stage(conv, "hint")
        conv["llm_messages"].append({"role": "assistant", "content": guarded.text})
        tutor_msg = db.add_message(conv["id"], "tutor", guarded.text, "fallback" if guarded.used_fallback else "hint", conv["stage"])
        db.add_guard_events(conv["id"], tutor_msg["id"], guarded.attempts)
        speech.prepare_in_background(tutor_msg["id"], tutor_msg["text"])
        db.save_conversation(conv)
        return _turn_result(conv, student_msg, tutor_msg)


@app.post("/api/conversations/{conversation_id}/answer")
async def answer(conversation_id: str, body: AnswerBody, user: dict = Depends(auth.current_user)):
    async with _locks[conversation_id]:
        conv = _writable_conversation(conversation_id, user)
        if not conv["chapter_files"]:
            raise HTTPException(400, "This question has no graded answer — just keep chatting")
        text = body.answer.strip()
        try:
            is_correct = await tutor.is_correct_final_answer(conv["problem"], conv["correct_answer"], text)
            verdict = "CORRECT" if is_correct else "INCORRECT"
            conv["llm_messages"] += [
                {"role": "user", "content": f"My submitted answer is: {text}"},
                {"role": "system", "content": f"The student's submitted answer was verified by a separate system as: {verdict}."},
            ]
            if is_correct:
                guarded = tutor.GuardedReply(text=prompts.correct_reply())
            else:
                conv["wrong_attempts"] += 1
                guarded = await _guarded(conv, _history(conv, user))
        except Exception as e:
            raise _llm_error(e)

        student_msg = db.add_message(conv["id"], "student", text, "know_answer", conv["stage"])
        _advance_stage(conv, "correct_answer" if is_correct else "wrong_answer")
        conv["llm_messages"].append({"role": "assistant", "content": guarded.text})
        tutor_type = "correct" if is_correct else ("fallback" if guarded.used_fallback else "wrong_answer")
        tutor_msg = db.add_message(conv["id"], "tutor", guarded.text, tutor_type, conv["stage"])
        db.add_guard_events(conv["id"], tutor_msg["id"], guarded.attempts)
        speech.prepare_in_background(tutor_msg["id"], tutor_msg["text"])
        db.save_conversation(conv)
        return _turn_result(conv, student_msg, tutor_msg, correct=is_correct)


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, user: dict = Depends(auth.current_user)):
    _owned_conversation(conversation_id, user)
    db.run("DELETE FROM conversations WHERE id = ?", conversation_id)
    return {"ok": True}


# ---------- feedback ----------

class FeedbackBody(BaseModel):
    rating: Literal[-1, 1]
    comment: str = Field(default="", max_length=2000)


@app.post("/api/messages/{message_id}/feedback")
def give_feedback(message_id: str, body: FeedbackBody, user: dict = Depends(auth.current_user)):
    msg = db.one("SELECT * FROM messages WHERE id = ?", message_id)
    if not msg or msg["sender"] != "tutor":
        raise HTTPException(404, "Message not found")
    _owned_conversation(msg["conversation_id"], user)
    db.run(
        """INSERT INTO feedback (message_id, conversation_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (message_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment,
           created_at = excluded.created_at""",
        message_id, msg["conversation_id"], user["id"], body.rating, body.comment.strip(), db.now(),
    )
    return {"rating": body.rating, "comment": body.comment.strip()}


@app.get("/api/messages/{message_id}/audio")
async def message_audio(message_id: str, user: dict = Depends(auth.current_user)):
    msg = db.one("SELECT * FROM messages WHERE id = ?", message_id)
    if not msg or msg["sender"] != "tutor":
        raise HTTPException(404, "Message not found")
    _owned_conversation(msg["conversation_id"], user)
    if not speech.TTS_ENABLED:
        raise HTTPException(503, "Voice is not configured (needs OPENAI_API_KEY)")
    try:
        path = await speech.audio_for(message_id, msg["text"])
    except Exception as e:
        log.exception("TTS failed")
        raise HTTPException(502, f"Could not generate audio ({type(e).__name__})")
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.delete("/api/messages/{message_id}/feedback")
def remove_feedback(message_id: str, user: dict = Depends(auth.current_user)):
    db.run("DELETE FROM feedback WHERE message_id = ? AND user_id = ?", message_id, user["id"])
    return {"ok": True}


# ---------- admin ----------

class NewStudentBody(RegisterBody):
    role: Literal["student", "admin"] = "student"


class ResetPasswordBody(BaseModel):
    password: str = Field(min_length=6, max_length=200)


@app.get("/api/admin/conversations")
def admin_conversations(_: dict = Depends(auth.require_admin)):
    rows = db.all_rows(SUMMARY_SQL + " ORDER BY c.updated_at DESC")
    return [_summary(r, admin=True) for r in rows]


@app.get("/api/admin/users")
def admin_users(_: dict = Depends(auth.require_admin)):
    rows = db.all_rows(
        """SELECT u.*, COUNT(c.id) AS chats, COALESCE(SUM(c.completed), 0) AS solved, MAX(c.updated_at) AS last_active
           FROM users u LEFT JOIN conversations c ON c.user_id = u.id GROUP BY u.id ORDER BY u.role, u.display_name"""
    )
    return [
        auth.public_user(r) | {"createdAt": r["created_at"], "chats": r["chats"], "solved": r["solved"], "lastActive": r["last_active"]}
        for r in rows
    ]


@app.post("/api/admin/users")
def admin_create_user(body: NewStudentBody, _: dict = Depends(auth.require_admin)):
    _check_grade(body.grade)
    if db.one("SELECT id FROM users WHERE username = ?", body.username.strip()):
        raise HTTPException(409, "Այս օգտանունն արդեն զբաղված է")
    return auth.public_user(auth.create_user(body.username, body.password, body.displayName, body.role, body.grade))


@app.post("/api/admin/users/{user_id}/password")
def admin_reset_password(user_id: str, body: ResetPasswordBody, _: dict = Depends(auth.require_admin)):
    if not db.one("SELECT id FROM users WHERE id = ?", user_id):
        raise HTTPException(404, "User not found")
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", auth.hash_password(body.password), user_id)
    db.run("DELETE FROM auth_tokens WHERE user_id = ?", user_id)
    return {"ok": True}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: str, admin: dict = Depends(auth.require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "You cannot delete your own account")
    db.run("DELETE FROM users WHERE id = ?", user_id)
    return {"ok": True}


@app.get("/api/admin/feedback")
def admin_feedback(_: dict = Depends(auth.require_admin)):
    rows = db.all_rows(
        """SELECT f.*, m.text AS tutor_text, m.type AS tutor_type, u.display_name, c.problem, c.topic,
                  (SELECT p.text FROM messages p WHERE p.conversation_id = m.conversation_id AND p.sender = 'student'
                     AND (p.created_at < m.created_at OR (p.created_at = m.created_at AND p.rowid < m.rowid))
                   ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1) AS student_text
           FROM feedback f JOIN messages m ON m.id = f.message_id JOIN users u ON u.id = f.user_id
           JOIN conversations c ON c.id = f.conversation_id ORDER BY f.created_at DESC"""
    )
    return [
        {
            "id": r["id"], "rating": r["rating"], "comment": r["comment"], "createdAt": r["created_at"],
            "by": r["display_name"], "conversationId": r["conversation_id"], "messageId": r["message_id"],
            "problem": r["problem"], "topic": r["topic"], "tutorText": r["tutor_text"],
            "tutorType": r["tutor_type"], "studentText": r["student_text"],
        }
        for r in rows
    ]


@app.get("/api/health")
def health():
    return {"status": "ok", "provider": LLM_PROVIDER, "model": TUTOR_MODEL}


# ---------- built frontend (single-port mode) ----------

_DIST = ROOT_DIR / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        file = _DIST / path
        return FileResponse(file if path and file.is_file() else _DIST / "index.html")
