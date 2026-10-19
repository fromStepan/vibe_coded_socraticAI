import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request

from . import db
from .config import ADMIN_PASSWORD, ADMIN_USERNAME, AUTH_COOKIE, AUTH_TTL_DAYS

_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_user(username: str, password: str, display_name: str, role: str, grade: str = "5") -> dict:
    user_id = db.new_id()
    db.run(
        "INSERT INTO users (id, username, display_name, password_hash, role, grade, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        user_id, username.strip(), display_name.strip(), hash_password(password), role, grade, db.now(),
    )
    return db.one("SELECT * FROM users WHERE id = ?", user_id)


def ensure_admin() -> None:
    if not db.one("SELECT id FROM users WHERE role = 'admin'"):
        create_user(ADMIN_USERNAME, ADMIN_PASSWORD, "Ադմին", "admin")


def issue_token(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=AUTH_TTL_DAYS)
    db.run("INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)", token, user_id, expires.isoformat())
    return token


def revoke_token(token: str) -> None:
    db.run("DELETE FROM auth_tokens WHERE token = ?", token)


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "displayName": user["display_name"],
        "role": user["role"],
        "grade": user["grade"],
    }


def current_user(request: Request) -> dict:
    token = request.cookies.get(AUTH_COOKIE)
    if not token:
        raise HTTPException(401, "Not logged in")
    user = db.one(
        "SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ? AND t.expires_at > ?",
        token, db.now(),
    )
    if not user:
        raise HTTPException(401, "Session expired")
    return user


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Admins only")
    return user
