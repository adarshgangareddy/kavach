"""Dual-Engine AI Reasoning: Google Cloud Gemini (Primary) with Groq & Local Fallback.

If GEMINI_API_KEY is configured, requests route to Google Cloud AI Platform / Gemini first.
If quota limits (429) or transient errors occur, the system automatically falls back to Groq,
and finally to deterministic local rule engines. No downtime or hard failure for the user.
"""

import json
import logging
from typing import Any

import httpx

from app import config

log = logging.getLogger("kavach.llm")


class LLMError(Exception):
    pass


class RateLimited(LLMError):
    pass


# ---------- Google Cloud Gemini Engine ----------

async def gemini_json(system: str, payload: dict, model: str | None = None, max_tokens: int = 2048) -> dict:
    """Invoke Google Gemini in structured JSON mode."""
    if not config.GEMINI_API_KEY:
        raise LLMError("GEMINI_API_KEY not configured")

    model_name = model or config.GEMINI_MODEL or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={config.GEMINI_API_KEY}"

    req_body: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": json.dumps(payload, ensure_ascii=False)}],
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }
    if system:
        req_body["system_instruction"] = {
            "parts": [{"text": system}]
        }

    try:
        async with httpx.AsyncClient(timeout=config.GEMINI_TIMEOUT) as client:
            resp = await client.post(url, json=req_body)
    except httpx.HTTPError as exc:
        raise LLMError(f"Gemini network error: {exc}") from exc

    if resp.status_code == 429:
        raise RateLimited(f"Gemini rate limit: {resp.text[:200]}")
    if resp.status_code != 200:
        raise LLMError(f"Gemini HTTP {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
        raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(raw_text)
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        raise LLMError(f"Invalid JSON returned from Gemini: {exc}") from exc


# ---------- Groq Engine (Secondary / Fallback) ----------

async def groq_json(system: str, payload: dict, model: str | None = None, max_tokens: int = 1500) -> dict:
    """Send `payload` as JSON data under a fixed system prompt to Groq; return parsed JSON reply."""
    if not config.GROQ_API_KEY:
        raise LLMError("GROQ_API_KEY not set")
    model_name = model or config.GROQ_MODEL
    body = {
        "model": model_name,
        "temperature": 0,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    }
    if config.GROQ_REASONING_EFFORT and "gpt-oss" in model_name:
        body["reasoning_effort"] = config.GROQ_REASONING_EFFORT
    try:
        async with httpx.AsyncClient(timeout=config.GROQ_TIMEOUT) as client:
            resp = await client.post(
                config.GROQ_URL, json=body, headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"}
            )
    except httpx.HTTPError as exc:
        raise LLMError(f"Groq network error: {exc}") from exc
    if resp.status_code == 429:
        raise RateLimited(resp.text[:200])
    if resp.status_code != 200:
        raise LLMError(f"Groq HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMError(f"invalid JSON from Groq: {exc}") from exc


async def groq_chat(messages: list[dict], tools: list[dict], model: str | None = None, max_tokens: int = 1500) -> dict:
    """One tool-calling turn via Groq; returns assistant message (content and/or tool_calls)."""
    if not config.GROQ_API_KEY:
        raise LLMError("GROQ_API_KEY not set")
    model_name = model or config.GROQ_MODEL
    body = {
        "model": model_name,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
    }
    if config.GROQ_REASONING_EFFORT and "gpt-oss" in model_name:
        body["reasoning_effort"] = config.GROQ_REASONING_EFFORT
    try:
        async with httpx.AsyncClient(timeout=config.GROQ_TIMEOUT) as client:
            resp = await client.post(
                config.GROQ_URL, json=body, headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"}
            )
    except httpx.HTTPError as exc:
        raise LLMError(f"network error: {exc}") from exc
    if resp.status_code == 429:
        raise RateLimited(resp.text[:200])
    if resp.status_code != 200:
        raise LLMError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        msg = resp.json()["choices"][0]["message"]
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMError(f"invalid reply from model: {exc}") from exc
    return {"role": "assistant", "content": msg.get("content") or "", "tool_calls": msg.get("tool_calls") or []}


# ---------- Unified Dual-Engine Callers (Primary: Google Cloud -> Fallback: Groq) ----------

async def llm_json(system: str, payload: dict, model: str | None = None, max_tokens: int = 2048) -> dict:
    """Primary: Google Gemini. Fallback: Groq."""
    if config.GEMINI_API_KEY:
        try:
            return await gemini_json(system, payload, model, max_tokens)
        except (RateLimited, LLMError) as exc:
            log.warning("Gemini primary call failed, triggering fallback to Groq: %s", exc)

    if config.GROQ_API_KEY:
        return await groq_json(system, payload, model or config.GROQ_MODEL, max_tokens)

    raise LLMError("Neither GEMINI_API_KEY nor GROQ_API_KEY is configured")


async def groq_json_with_fallback(system: str, payload: dict, model: str, max_tokens: int = 1500) -> tuple[dict, str]:
    """Dual-engine fallback: Gemini Primary -> Gemini Fallback -> Groq -> Groq Fallback."""
    # 1. Try Google Gemini if configured
    if config.GEMINI_API_KEY:
        for g_model in (config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL):
            if not g_model:
                continue
            try:
                res = await gemini_json(system, payload, g_model, max_tokens)
                return res, f"google/{g_model}"
            except (RateLimited, LLMError) as exc:
                log.warning("Gemini model %s failed, trying fallback: %s", g_model, exc)

    # 2. Try Groq
    if config.GROQ_API_KEY:
        groq_target = model or config.GROQ_MODEL
        for _ in (1, 2):
            try:
                res = await groq_json(system, payload, groq_target, max_tokens)
                return res, groq_target
            except RateLimited:
                if config.GROQ_FALLBACK_MODEL and groq_target != config.GROQ_FALLBACK_MODEL:
                    groq_target = config.GROQ_FALLBACK_MODEL
                else:
                    break
            except LLMError as exc:
                log.warning("Groq call failed: %s", exc)
                break

    raise LLMError("All LLM providers (Gemini & Groq) exhausted or unconfigured")
