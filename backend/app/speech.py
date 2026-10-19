"""Text-to-speech for tutor replies (OpenAI). Math is rewritten into spoken Armenian first,
so "3/4" is read as "երեք չորրորդ" rather than "three slash four". Audio is cached per message."""
import asyncio
import hashlib
import logging
import os
import re
from collections import defaultdict
from pathlib import Path

from openai import AsyncOpenAI

from . import prompts
from .config import DATA_DIR

log = logging.getLogger("tutor.speech")

TTS_MODEL = os.environ.get("TTS_MODEL", "gpt-4o-mini-tts")
TTS_VOICE = os.environ.get("TTS_VOICE", "coral")
TTS_ENABLED = bool(os.environ.get("OPENAI_API_KEY")) and os.environ.get("TTS_ENABLED", "true").lower() == "true"

AUDIO_DIR = DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

_client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""), timeout=60) if TTS_ENABLED else None
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_background: set[asyncio.Task] = set()


# ---------- numbers in Armenian words ----------

_UNITS = ["զրո", "մեկ", "երկու", "երեք", "չորս", "հինգ", "վեց", "յոթ", "ութ", "ինը"]
_TEENS = ["տասը", "տասնմեկ", "տասներկու", "տասներեք", "տասնչորս", "տասնհինգ", "տասնվեց", "տասնյոթ", "տասնութ", "տասնինը"]
_TENS = ["", "", "քսան", "երեսուն", "քառասուն", "հիսուն", "վաթսուն", "յոթանասուն", "ութսուն", "իննսուն"]
_SCALES = [(10**9, "միլիարդ"), (10**6, "միլիոն"), (1000, "հազար")]
_SPECIAL_ORDINALS = {1: "առաջին", 2: "երկրորդ", 3: "երրորդ", 4: "չորրորդ"}
_DECIMAL_PLACES = {1: "տասնորդական", 2: "հարյուրերորդական", 3: "հազարերորդական"}


def _below_thousand(n: int) -> str:
    parts = []
    hundreds, rest = divmod(n, 100)
    if hundreds:
        parts.append("հարյուր" if hundreds == 1 else f"{_UNITS[hundreds]} հարյուր")
    if rest >= 20:
        tens, unit = divmod(rest, 10)
        parts.append(_TENS[tens] + (_UNITS[unit] if unit else ""))
    elif rest >= 10:
        parts.append(_TEENS[rest - 10])
    elif rest:
        parts.append(_UNITS[rest])
    return " ".join(parts)


def number_words(n: int) -> str:
    if n == 0:
        return _UNITS[0]
    if n < 0:
        return f"մինուս {number_words(-n)}"
    parts = []
    for value, name in _SCALES:
        count, n = divmod(n, value)
        if count:
            parts.append(name if (count == 1 and value == 1000) else f"{number_words(count)} {name}")
    if n:
        parts.append(_below_thousand(n))
    return " ".join(parts)


def ordinal_words(n: int) -> str:
    if n in _SPECIAL_ORDINALS:
        return _SPECIAL_ORDINALS[n]
    words = number_words(n)
    return (words[:-1] + "ներորդ") if words.endswith("ը") else words + "երորդ"


# ---------- spoken form ----------

_MD = re.compile(r"[*_`#]+|^\s*>\s?", re.MULTILINE)
_ORDINAL_SUFFIX = re.compile(r"(?<!\d)(\d+)\s*-\s*(?:րդ|երորդ)")
_FIRST = re.compile(r"(?<!\d)1\s*-\s*ին(?![\u0561-\u0587])")
_ARM = "\u0561-\u0587"
_UNIT_END = rf"(?:-(?=[{_ARM}])|(?![{_ARM}]))"
_UNITS_SPOKEN = [
    (re.compile(rf"(?<![{_ARM}])կմ/ժ{_UNIT_END}"), "կիլոմետր ժամում"),
    (re.compile(rf"(?<![{_ARM}])կգ{_UNIT_END}"), "կիլոգրամ"),
    (re.compile(rf"(?<![{_ARM}])կմ{_UNIT_END}"), "կիլոմետր"),
    (re.compile(rf"(?<![{_ARM}])սմ{_UNIT_END}"), "սանտիմետր"),
    (re.compile(rf"(?<![{_ARM}])մմ{_UNIT_END}"), "միլիմետր"),
    (re.compile(rf"(?<![{_ARM}])դմ{_UNIT_END}"), "դեցիմետր"),
    # Single-letter units are only safe right after a number ("12 լ"), never on their own.
    (re.compile(rf"(?<=\d)\s*լ{_UNIT_END}"), " լիտր"),
    (re.compile(rf"(?<=\d)\s*գ{_UNIT_END}"), " գրամ"),
    (re.compile(rf"(?<=\d)\s*մ{_UNIT_END}"), " մետր"),
]
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]")
_GROUPED = re.compile(r"(?<![\d.,])\d{1,3}(?:[ \u00a0,]\d{3})+(?![\d.,]\d)")
_MIXED = re.compile(r"(?<!\d)(\d+)[ \u00a0]+(\d+)\s*/\s*(\d+)(?!\d)")
_FRACTION = re.compile(r"(?<!\d)(\d+)\s*/\s*(\d+)(?!\d)")
_DECIMAL = re.compile(r"(?<!\d)(\d+)[.,](\d{1,3})(?!\d)")
_OPERATORS = [
    (re.compile(r"(?<=\d)\s*[·×*]\s*(?=\d)"), " բազմապատկած "),
    (re.compile(r"(?<=\d)\s*[:÷]\s*(?=\d)"), " բաժանած "),
    (re.compile(r"(?<=\d)\s*\+\s*(?=\d)"), " գումարած "),
    (re.compile(r"(?<=\d)\s+[-−–]\s+(?=\d)"), " հանած "),
    (re.compile(r"\s*=\s*"), " հավասար է "),
    (re.compile(r"\s*%"), " տոկոս"),
    (re.compile(r"\s*>\s*"), " մեծ է "),
    (re.compile(r"\s*<\s*"), " փոքր է "),
]


def spoken_text(text: str) -> str:
    text = _EMOJI.sub("", _MD.sub("", text))
    text = _GROUPED.sub(lambda m: re.sub(r"[ \u00a0,]", "", m.group()), text)
    text = _ORDINAL_SUFFIX.sub(lambda m: ordinal_words(int(m[1])), text)
    text = _FIRST.sub("առաջին", text)
    text = re.sub(rf"(\d)\s*-\s*(?=[{_ARM}])", r"\1", text)
    for pattern, words in _UNITS_SPOKEN:
        text = pattern.sub(words, text)
    for pattern, words in _OPERATORS:
        text = pattern.sub(words, text)
    text = _MIXED.sub(lambda m: f"{number_words(int(m[1]))} ամբողջ {number_words(int(m[2]))} {ordinal_words(int(m[3]))}", text)
    text = _FRACTION.sub(lambda m: f"{number_words(int(m[1]))} {ordinal_words(int(m[2]))}", text)
    text = _DECIMAL.sub(
        lambda m: f"{number_words(int(m[1]))} ամբողջ {number_words(int(m[2]))} {_DECIMAL_PLACES[len(m[2])]}", text,
    )
    text = re.sub(r"\d+", lambda m: number_words(int(m.group())), text)
    return re.sub(r"\s{2,}", " ", text).strip()


# ---------- audio ----------

def _audio_path(message_id: str, text: str) -> Path:
    key = hashlib.sha256("|".join([TTS_MODEL, TTS_VOICE, prompts.load("tts_instructions.md"), text]).encode()).hexdigest()[:16]
    return AUDIO_DIR / f"{message_id}-{key}.mp3"


async def audio_for(message_id: str, text: str) -> Path:
    """Returns a cached mp3, generating it on first use. Editing the voice instructions invalidates the cache."""
    if not TTS_ENABLED:
        raise RuntimeError("Text-to-speech needs OPENAI_API_KEY")
    spoken = spoken_text(text)
    path = _audio_path(message_id, spoken)
    async with _locks[str(path)]:
        if not path.is_file():
            response = await _client.audio.speech.create(
                model=TTS_MODEL,
                voice=TTS_VOICE,
                input=spoken,
                instructions=prompts.load("tts_instructions.md").strip(),
                response_format="mp3",
            )
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(response.content)
            tmp.replace(path)
    _locks.pop(str(path), None)
    return path


def prepare_in_background(message_id: str, text: str) -> None:
    """Starts generating audio right away so the play button (and auto-read) responds instantly."""
    if not TTS_ENABLED:
        return

    async def run():
        try:
            await audio_for(message_id, text)
        except Exception:
            log.exception("background TTS failed for %s", message_id)

    task = asyncio.get_running_loop().create_task(run())
    _background.add(task)
    task.add_done_callback(_background.discard)
