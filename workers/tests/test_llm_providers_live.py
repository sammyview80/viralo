"""
Live LLM provider test — hits real APIs, no mocks.
Run inside the container:
    docker compose exec celery-video python -m pytest workers/tests/test_llm_providers_live.py -v -s

Or as a standalone script:
    docker compose exec celery-video python workers/tests/test_llm_providers_live.py
"""
import json
import logging
import os
import sys
import time

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ── Helpers ───────────────────────────────────────────────────────────────────

TEST_PROMPT = [{"role": "user", "content": 'Reply with ONLY valid JSON: {"status":"ok","provider":"working"}'}]
TIMEOUT_SEC = 15


def _make_client(api_key: str, base_url: str):
    from openai import OpenAI
    return OpenAI(api_key=api_key, base_url=base_url, timeout=TIMEOUT_SEC)


def _call(client, model: str, json_mode: bool) -> dict:
    import re
    kwargs = {
        "model": model,
        "messages": TEST_PROMPT,
        "max_tokens": 40,
        "temperature": 0,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    content = (resp.choices[0].message.content or "").strip()
    # strip markdown fences
    if content.startswith("```"):
        content = re.sub(r"^```[a-z]*\n?", "", content)
        content = re.sub(r"\n?```$", "", content.strip())
    return json.loads(content)


# ── Per-provider tests ────────────────────────────────────────────────────────

def _resolve(p: dict) -> tuple[str | None, str | None]:
    api_key = os.getenv(p["env_key"], "")
    if not api_key:
        return None, None
    base_url = p["base_url"]
    if p["name"] == "cloudflare":
        account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
        if not account_id:
            return None, None
        base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    return api_key, base_url


def run_live_tests() -> list[dict]:
    """
    Test every provider in the hierarchy. Returns list of result dicts.
    Each result: {name, model, status, latency_ms, error, response}
    """
    from shared.llm import LLM_PROVIDERS

    results = []

    print("\n" + "=" * 65)
    print(f"  LLM Provider Live Test  ({len(LLM_PROVIDERS)} providers in hierarchy)")
    print("=" * 65)
    print(f"  {'PROVIDER':<16} {'MODEL':<42} {'STATUS':<8} {'MS':>6}")
    print("-" * 65)

    for p in LLM_PROVIDERS:
        api_key, base_url = _resolve(p)
        if not api_key:
            print(f"  {p['name']:<16} {'—':<42} {'SKIP':<8} {'—':>6}  (no key/account)")
            results.append({"name": p["name"], "model": "—", "status": "skip",
                            "latency_ms": None, "error": "not configured", "response": None})
            continue

        model = p["model_large"]
        client = _make_client(api_key, base_url)
        t0 = time.perf_counter()
        try:
            resp = _call(client, model, p["json_mode"])
            ms = int((time.perf_counter() - t0) * 1000)
            print(f"  {p['name']:<16} {model:<42} {'OK':<8} {ms:>6}ms  → {resp}")
            results.append({"name": p["name"], "model": model, "status": "ok",
                            "latency_ms": ms, "error": None, "response": resp})
        except Exception as e:
            ms = int((time.perf_counter() - t0) * 1000)
            err = str(e)[:80]
            print(f"  {p['name']:<16} {model:<42} {'FAIL':<8} {ms:>6}ms  ✗ {err}")
            results.append({"name": p["name"], "model": model, "status": "fail",
                            "latency_ms": ms, "error": str(e), "response": None})

    print("-" * 65)
    ok   = [r for r in results if r["status"] == "ok"]
    fail = [r for r in results if r["status"] == "fail"]
    skip = [r for r in results if r["status"] == "skip"]
    print(f"  TOTAL: {len(ok)} OK  /  {len(fail)} FAIL  /  {len(skip)} SKIP")
    print("=" * 65 + "\n")

    if ok:
        fastest = min(ok, key=lambda r: r["latency_ms"])
        print(f"  ✓ Fastest working provider: {fastest['name']} ({fastest['latency_ms']}ms)")

    return results


def test_fallback_chain_end_to_end():
    """
    pytest-compatible: call_llm_json must succeed using the real hierarchy.
    Passes as long as at least one provider works.
    """
    from shared.llm import call_llm_json

    notified = []
    result = call_llm_json(
        TEST_PROMPT,
        max_tokens=40,
        notify=lambda msg: notified.append(msg),
    )

    print(f"\n  call_llm_json result : {result}")
    print(f"  active provider      : {notified[0] if notified else '(notify not called)'}")

    assert "status" in result or "ok" in result or "provider" in result, \
        f"Unexpected response shape: {result}"


def test_each_provider_individually():
    """
    pytest-compatible: test each provider independently, mark as xfail if down.
    Does NOT use the probe — exercises the real call directly.
    """
    import pytest
    from shared.llm import LLM_PROVIDERS

    for p in LLM_PROVIDERS:
        api_key, base_url = _resolve(p)
        if not api_key:
            continue

        model = p["model_large"]
        client = _make_client(api_key, base_url)
        try:
            resp = _call(client, model, p["json_mode"])
            assert isinstance(resp, dict), f"{p['name']}: response not a dict"
            print(f"\n  [{p['name']}] {resp}")
        except Exception as e:
            pytest.xfail(f"{p['name']} ({model}) failed: {str(e)[:120]}")


# ── Standalone entry point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    results = run_live_tests()

    # Also verify the full fallback chain
    print("Testing call_llm_json fallback chain ...")
    from shared.llm import call_llm_json
    notified: list[str] = []
    try:
        result = call_llm_json(TEST_PROMPT, max_tokens=40, notify=lambda m: notified.append(m))
        print(f"  ✓ call_llm_json OK — used: {notified[0] if notified else '?'} → {result}\n")
    except RuntimeError as e:
        print(f"  ✗ call_llm_json FAILED — {e}\n")
        sys.exit(1)

    ok_count = sum(1 for r in results if r["status"] == "ok")
    sys.exit(0 if ok_count > 0 else 1)
