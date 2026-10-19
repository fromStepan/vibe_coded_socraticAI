"""Prompt files are re-read on every call, so edits in backend/prompts/ apply on the next message."""
import random
import re

from .config import PROMPTS_DIR


def load(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def render(name: str, **values: str) -> str:
    """Fills only the named {placeholders}; any other braces (e.g. JSON examples) are left as written."""
    template = load(name)
    pattern = re.compile(r"\{(" + "|".join(map(re.escape, values)) + r")\}") if values else None
    if pattern is None:
        return template
    return pattern.sub(lambda m: str(values[m.group(1)]), template)


def fallback_reply() -> str:
    return load("fallback_reply.txt").strip()


def correct_reply() -> str:
    lines = [line.strip() for line in load("correct_replies.txt").splitlines() if line.strip()]
    return random.choice(lines)
