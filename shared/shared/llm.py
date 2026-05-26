"""
Global free-tier LLM fallback utility.

Hierarchy (all free, no paid APIs):
  1. Groq           — fastest, 100k TPD free
  2. Cloudflare AI  — no hard daily limit, free Workers AI
  3. Cerebras       — fast inference, free tier
  4. OpenRouter     — free :free models
  5. SambaNova      — free tier
  6. Groq-small     — Groq llama-3.1-8b has separate quota bucket

Usage:
    from shared.llm import call_llm_json, probe_all_providers
    result = call_llm_json(messages, max_tokens=500)
"""

import json
import logging
import os
import re
import threading

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Provider registry — order = priority
# ---------------------------------------------------------------------------
# Groq slots are generated dynamically from GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3, …
# Each key gets its own large-model slot; exhausted keys are probed and skipped automatically.
# Add more keys via GROQ_API_KEY_N in .env without changing code.

_GROQ_BASE_URL = "https://api.groq.com/openai/v1"

_BASE_PROVIDERS = [
    {
        "name": "cloudflare",
        "env_key": "CLOUDFLARE_API_TOKEN",
        "base_url": None,  # built from CLOUDFLARE_ACCOUNT_ID at runtime
        "model_large": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "model_small": "@cf/meta/llama-3.1-8b-instruct",
        "json_mode": False,
    },
    {
        "name": "cerebras",
        "env_key": "CEREBRAS_API_KEY",
        "base_url": "https://api.cerebras.ai/v1",
        "model_large": "qwen-3-235b-a22b-instruct-2507",
        "model_small": "llama3.1-8b",
        "json_mode": True,
    },
    {
        "name": "openrouter",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "model_large": "meta-llama/llama-3.3-70b-instruct:free",
        "model_small": "meta-llama/llama-3.1-8b-instruct:free",
        "json_mode": True,
    },
    {
        "name": "sambanova",
        "env_key": "SAMBANOVA_API_KEY",
        "base_url": "https://api.sambanova.ai/v1",
        "model_large": "Meta-Llama-3.3-70B-Instruct",
        "model_small": "Meta-Llama-3.1-8B-Instruct",
        "json_mode": False,
    },
    # OpenRouter free-model fallbacks — each is a different model so independent rate limits.
    # Used only when all primary providers are exhausted.
    {
        "name": "openrouter-minimax",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "model_large": "minimax/minimax-m2.5:free",
        "model_small": "minimax/minimax-m2.5:free",
        "json_mode": False,
    },
    {
        "name": "openrouter-deepseek",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "model_large": "deepseek/deepseek-v4-flash:free",
        "model_small": "deepseek/deepseek-v4-flash:free",
        "json_mode": False,
    },
    {
        "name": "openrouter-gemma",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "model_large": "google/gemma-4-31b-it:free",
        "model_small": "google/gemma-4-26b-a4b-it:free",
        "json_mode": False,
    },
    {
        "name": "openrouter-llama32",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "model_large": "nousresearch/hermes-3-llama-3.1-405b:free",
        "model_small": "meta-llama/llama-3.2-3b-instruct:free",
        "json_mode": False,
    },
    {
        "name": "openrouter-qwen3coder",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "model_large": "qwen/qwen3-coder:free",
        "model_small": "qwen/qwen3-coder:free",
        "json_mode": False,
    },
]


def _build_groq_slots() -> list[dict]:
    """
    Collect all GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3, … from env.
    Returns one large-model slot per key, plus one shared small-model slot (first key).
    Keys are tried in numeric order; a rate-limited key is probed and skipped.
    """
    slots: list[dict] = []
    env_keys = ["GROQ_API_KEY"] + [f"GROQ_API_KEY_{i}" for i in range(2, 20)]
    seen: list[str] = []
    for env_key in env_keys:
        val = os.getenv(env_key, "")
        if val and val not in seen:
            seen.append(val)
            idx = len(seen)
            label = "groq" if idx == 1 else f"groq-key{idx}"
            slots.append({
                "name": label,
                "env_key": env_key,
                "base_url": _GROQ_BASE_URL,
                "model_large": "llama-3.3-70b-versatile",
                "model_small": "llama-3.1-8b-instant",
                "json_mode": True,
                "_api_key_override": val,  # store literal value for _resolve_provider
            })
    # Append groq-small slot using the first key (separate quota bucket)
    if seen:
        slots.append({
            "name": "groq-small",
            "env_key": "GROQ_API_KEY",
            "base_url": _GROQ_BASE_URL,
            "model_large": "llama-3.1-8b-instant",
            "model_small": "llama-3.1-8b-instant",
            "json_mode": True,
            "_api_key_override": seen[0],
        })
    return slots


def _get_providers() -> list[dict]:
    """Build full provider list at call time so new env vars are picked up without restart."""
    return _build_groq_slots() + _BASE_PROVIDERS

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_lock = threading.Lock()

# Probe result cache: {provider_name -> (is_alive: bool, expires_at: float)}
# Dead providers cached for 60s, live providers cached for 30s.
_probe_cache: dict[str, tuple[bool, float]] = {}
_probe_cache_lock = threading.Lock()
_PROBE_CACHE_LIVE_TTL = 30.0   # re-probe live providers after 30s
_PROBE_CACHE_DEAD_TTL = 60.0   # skip dead providers for 60s


def _probe_cached(name: str, api_key: str, base_url: str, model: str, json_mode: bool) -> bool:
    """_probe with TTL cache. Dead providers skip real HTTP for 60s, live for 30s."""
    import time
    now = time.monotonic()
    with _probe_cache_lock:
        cached = _probe_cache.get(name)
        if cached is not None:
            alive, expires = cached
            if now < expires:
                if not alive:
                    log.debug(f"[LLM] {name}: cached DEAD (skip)")
                return alive

    result = _probe(api_key, base_url, model, json_mode)
    ttl = _PROBE_CACHE_LIVE_TTL if result else _PROBE_CACHE_DEAD_TTL
    with _probe_cache_lock:
        _probe_cache[name] = (result, now + ttl)
    return result


def _invalidate_provider_cache(name: str) -> None:
    """Mark provider dead immediately (call when real request returns 429)."""
    import time
    with _probe_cache_lock:
        _probe_cache[name] = (False, time.monotonic() + _PROBE_CACHE_DEAD_TTL)


def _resolve_provider(p: dict) -> tuple[str | None, str | None]:
    """Return (api_key, base_url) or (None, None) if provider is unconfigured."""
    api_key = p.get("_api_key_override") or os.getenv(p["env_key"], "")
    if not api_key:
        return None, None
    base_url = p["base_url"]
    if p["name"] == "cloudflare":
        account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
        if not account_id:
            return None, None
        base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    return api_key, base_url


# Backward-compat alias — resolved at import time (static snapshot).
# Use _get_providers() inside functions for live env var pickup.
LLM_PROVIDERS = _get_providers()


def _parse_json(content: str) -> dict:
    """Parse JSON from LLM response, stripping markdown fences if present."""
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```[a-z]*\n?", "", content)
        content = re.sub(r"\n?```$", "", content.strip())
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise


def _make_client(api_key: str, base_url: str, max_retries: int = 2, timeout: float = 15.0):
    from openai import OpenAI
    return OpenAI(api_key=api_key, base_url=base_url, max_retries=max_retries, timeout=timeout)


def _probe(api_key: str, base_url: str, model: str, json_mode: bool, timeout: float = 8.0) -> bool:
    """
    Cheap liveness check — 5 tokens, hard timeout via httpx, no retries, no json_mode.
    json_mode param kept for signature compat but intentionally ignored — probes plain text
    to avoid provider-specific JSON prompt requirements (e.g. Groq 400 without 'JSON' keyword).
    Returns True on HTTP 200 with non-empty content.
    """
    import httpx

    url = base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Say hi"}],
        "max_tokens": 5,
        "temperature": 0,
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout)) as client:
            resp = client.post(url, headers=headers, json=payload)
        if resp.status_code != 200:
            log.debug(f"Probe {model}@{base_url} → HTTP {resp.status_code}")
            return False
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return bool((content or "").strip())
    except Exception as e:
        log.debug(f"Probe failed {model}@{base_url}: {str(e)[:80]}")
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def probe_all_providers(prefer_large: bool = True) -> list[dict]:
    """
    Test every configured provider and return a status list.
    Useful for health-check endpoints or startup diagnostics.

    Returns: [{"name": str, "model": str, "status": "ok"|"fail"|"skip"}, ...]
    """
    results = []
    for p in _get_providers():
        api_key, base_url = _resolve_provider(p)
        if not api_key:
            results.append({"name": p["name"], "model": "—", "status": "skip"})
            continue
        model = p["model_large"] if prefer_large else p["model_small"]
        ok = _probe_cached(p["name"], api_key, base_url, model, p["json_mode"])
        status = "ok" if ok else "fail"
        log.info(f"[LLM probe] {p['name']} ({model}): {status.upper()}")
        results.append({"name": p["name"], "model": model, "status": status})
    return results


def call_llm_json(
    messages: list[dict],
    temperature: float = 0.3,
    max_tokens: int = 1000,
    prefer_large: bool = True,
    notify: callable = None,
) -> dict:
    """
    Call the first healthy LLM provider in the free-tier hierarchy and return parsed JSON.

    Hierarchy: Groq → Cloudflare AI → Cerebras → OpenRouter → SambaNova → Groq-small

    Args:
        messages:     OpenAI-format message list.
        temperature:  Sampling temperature.
        max_tokens:   Max output tokens.
        prefer_large: Use large model variant; set False to prefer small/fast.
        notify:       Optional callable(str) — called with the active provider name
                      so callers can surface this to users / SSE streams.

    Raises:
        RuntimeError: When every provider has been tried and failed.
    """
    attempts: list[str] = []
    last_err: Exception | None = None

    for p in _get_providers():
        api_key, base_url = _resolve_provider(p)
        if not api_key:
            log.debug(f"[LLM] {p['name']}: skipped (not configured)")
            continue

        model = p["model_large"] if prefer_large else p["model_small"]
        name = p["name"]

        # Probe with cache — dead providers skipped in <1ms after first failure
        if not _probe_cached(name, api_key, base_url, model, p["json_mode"]):
            log.warning(f"[LLM] {name} ({model}): probe FAILED — trying next provider")
            attempts.append(f"{name}:probe-fail")
            continue

        client = _make_client(api_key, base_url)
        log.info(f"[LLM] Active provider: {name} / {model}")
        if notify:
            try:
                notify(f"LLM: {name} ({model})")
            except Exception:
                pass

        try:
            kwargs: dict = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if p["json_mode"]:
                kwargs["response_format"] = {"type": "json_object"}
            resp = client.chat.completions.create(**kwargs)
            content = (resp.choices[0].message.content or "").strip()
            result = _parse_json(content)
            log.info(f"[LLM] {name} succeeded")
            return result
        except Exception as e:
            err_str = str(e)
            is_rate_limit = "429" in err_str or "rate_limit" in err_str.lower() or "quota" in err_str.lower()
            if is_rate_limit:
                _invalidate_provider_cache(name)  # immediately mark dead for next callers
                log.warning(f"[LLM] {name} rate-limited → cached dead 60s, trying next")
            else:
                log.warning(f"[LLM] {name} call failed: {err_str[:200]}")
            attempts.append(f"{name}:{'rate-limit' if is_rate_limit else 'call-fail'}")
            last_err = e
            continue

    # All providers rate-limited — wait for shortest dead-cache TTL then retry once
    import time
    with _probe_cache_lock:
        dead_expires = [exp for (alive, exp) in _probe_cache.values() if not alive]
    if dead_expires:
        wait = max(0.0, min(dead_expires) - time.monotonic())
        if wait > 0:
            log.warning("[LLM] All providers dead — waiting %.1fs for cache expiry then retrying", wait)
            time.sleep(wait + 0.5)
            # Retry once after wait
            for p in _get_providers():
                api_key, base_url = _resolve_provider(p)
                if not api_key:
                    continue
                model = p["model_large"] if prefer_large else p["model_small"]
                name = p["name"]
                if not _probe_cached(name, api_key, base_url, model, p["json_mode"]):
                    continue
                client = _make_client(api_key, base_url)
                log.info(f"[LLM] Retry provider: {name} / {model}")
                try:
                    kwargs: dict = {
                        "model": model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    }
                    if p["json_mode"]:
                        kwargs["response_format"] = {"type": "json_object"}
                    resp = client.chat.completions.create(**kwargs)
                    content = (resp.choices[0].message.content or "").strip()
                    result = _parse_json(content)
                    log.info(f"[LLM] {name} retry succeeded")
                    return result
                except Exception as e:
                    err_str = str(e)
                    if "429" in err_str or "rate_limit" in err_str.lower():
                        _invalidate_provider_cache(name)
                    last_err = e
                    continue

    raise RuntimeError(
        f"All free LLM providers exhausted. Tried: {', '.join(attempts) or 'none configured'}. "
        f"Last error: {last_err}"
    )
