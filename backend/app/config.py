import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent

load_dotenv(ROOT_DIR / ".env")

PROMPTS_DIR = BACKEND_DIR / "prompts"
CONTENT_DIR = BACKEND_DIR / "content"
DATA_DIR = Path(os.environ.get("DATA_DIR", BACKEND_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "tutor.db"

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "openai").lower()

PROVIDER_CONFIG = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "default_model": "deepseek/deepseek-v4-pro",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "api_key_env": "GEMINI_API_KEY",
        "default_model": "gemini-2.5-flash",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "default_model": "gpt-4.1",
    },
}

if LLM_PROVIDER not in PROVIDER_CONFIG:
    raise RuntimeError(f"Unknown LLM_PROVIDER={LLM_PROVIDER!r}; use one of {list(PROVIDER_CONFIG)}")

TUTOR_MODEL = os.environ.get("TUTOR_MODEL") or PROVIDER_CONFIG[LLM_PROVIDER]["default_model"]
JUDGE_MODEL = os.environ.get("JUDGE_MODEL") or TUTOR_MODEL
# Picks the lesson once per conversation, so a stronger model costs little.
ROUTER_MODEL = os.environ.get("ROUTER_MODEL") or JUDGE_MODEL
ROUTER_EXCERPT_CHARS = int(os.environ.get("ROUTER_EXCERPT_CHARS", "0"))
# Reads homework photos; needs a vision-capable model.
PHOTO_MODEL = os.environ.get("PHOTO_MODEL") or ("gpt-5.5" if LLM_PROVIDER == "openai" else TUTOR_MODEL)

MAX_LEAK_RETRIES = int(os.environ.get("MAX_LEAK_RETRIES", "2"))

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ALLOW_SIGNUP = os.environ.get("ALLOW_SIGNUP", "true").lower() == "true"
AUTH_COOKIE = "tutor_session"
AUTH_TTL_DAYS = 30

SUPPORTED_GRADES = sorted(p.name.removeprefix("grade-") for p in CONTENT_DIR.glob("grade-*") if p.is_dir())
