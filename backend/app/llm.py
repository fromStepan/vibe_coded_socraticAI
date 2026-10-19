import asyncio
import json
import logging
import os

from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, InternalServerError, RateLimitError

from .calculator import CALCULATOR_TOOL, calculate
from .config import LLM_PROVIDER, PROVIDER_CONFIG

log = logging.getLogger("tutor.llm")

MAX_RETRIES = 5
MAX_TOOL_ROUNDS = 6

_cfg = PROVIDER_CONFIG[LLM_PROVIDER]
client = AsyncOpenAI(
    api_key=os.environ.get(_cfg["api_key_env"], ""),
    base_url=_cfg["base_url"],
    timeout=90,
)


def is_reasoning_model(model: str) -> bool:
    return LLM_PROVIDER == "openai" and model.startswith(("gpt-5", "o1", "o3", "o4"))


def extra_body(effort: str | None = None) -> dict:
    """Each provider hides its "thinking" switch behind a different field."""
    if LLM_PROVIDER == "openrouter" and effort is not None:
        return {"reasoning": {"enabled": False} if effort == "none" else {"effort": effort}}
    if LLM_PROVIDER == "gemini" and effort is not None:
        return {"reasoning_effort": "low" if effort == "none" else effort}
    return {}


async def complete(**kwargs):
    """Temperature 0 by default; retries rate limits and transient errors with backoff."""
    if is_reasoning_model(kwargs["model"]):
        # These models only accept their default temperature and count hidden reasoning in the token limit.
        kwargs.pop("temperature", None)
        kwargs["max_completion_tokens"] = kwargs.pop("max_tokens", 4000) + 4000
        # Chat-completions only allows function tools with reasoning switched off.
        kwargs.setdefault("reasoning_effort", "none" if kwargs.get("tools") else "low")
    else:
        kwargs.setdefault("temperature", 0)
    for attempt in range(MAX_RETRIES + 1):
        try:
            return await client.chat.completions.create(**kwargs)
        except (RateLimitError, APIConnectionError, APITimeoutError, InternalServerError) as e:
            if attempt == MAX_RETRIES:
                raise
            delay = 3.0 * (attempt + 1)
            log.warning("LLM call failed (%s), retrying in %.0fs", type(e).__name__, delay)
            await asyncio.sleep(delay)


async def complete_with_calculator(messages: list, model: str, max_tokens: int, effort: str | None) -> str:
    """Runs tool-call round-trips on a scratch copy so the caller's history stays clean."""
    working = list(messages)
    content = ""
    for _ in range(MAX_TOOL_ROUNDS):
        response = await complete(
            model=model,
            messages=working,
            max_tokens=max_tokens,
            extra_body=extra_body(effort),
            tools=[CALCULATOR_TOOL],
        )
        msg = response.choices[0].message
        content = msg.content or ""
        if not msg.tool_calls:
            break
        working.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
        })
        for tc in msg.tool_calls:
            try:
                result = calculate(json.loads(tc.function.arguments).get("expression", ""))
            except (json.JSONDecodeError, AttributeError):
                result = "Error: could not parse tool call arguments"
            working.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    return content.strip()


async def complete_json(prompt: str, model: str, max_tokens: int = 800) -> dict | None:
    """Returns the parsed JSON object, or None when the model returns nothing parseable."""
    response = await complete(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        extra_body=extra_body("low"),
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None
