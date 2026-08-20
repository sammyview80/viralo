"""Standalone proxy quality tester for the yt-dlp proxy pool.

Pulls the proxy pool the same way workers/tasks/video/download.py does (via
workers.tasks.proxies.get_proxies(), i.e. YTDLP_PROXY_LIST / PROXY_PROVIDER),
test-downloads a short public video's metadata through each proxy across the
same client-major tiers used in production, and scores each proxy on success
rate + latency + bot-block rate.

Scores are persisted to redis under PROXY_SCORE_REDIS_KEY (hash: proxy -> json)
so download.py's selection logic can later prefer high-score proxies instead of
brute-force sequential order. This script does NOT change that selection logic —
it only measures and persists scores.

Run:
    python -m workers.tasks.proxy_quality_tester
    python -m workers.tasks.proxy_quality_tester --url "https://youtu.be/..." --timeout 20
"""
import argparse
import json
import logging
import subprocess
import time

from workers.tasks.proxies import get_proxies
from workers.tasks.video._core import redis_client
from workers.tasks.video.cookies import _is_429, _is_bot_blocked, _pot_args, _ytdlp_base_flags

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Mirrors the client-major tier order in workers/tasks/video/download.py
CLIENT_TIERS = ["mweb", "web_safari", "tv", "android_vr", "web", "ios"]

# Short, stable, public video — "Me at the zoo" (first YouTube video, 19s).
DEFAULT_TEST_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"

PROXY_SCORE_REDIS_KEY = "ytdlp:proxy_scores"
PROXY_SCORE_TTL_SEC = 6 * 3600  # scores go stale as proxies rotate/die


def _test_proxy_client(proxy: str, client: str, url: str, timeout: int) -> dict:
    """Run one yt-dlp metadata probe through `proxy` using `client`.

    Returns {"ok": bool, "latency": float, "blocked": bool, "rate_limited": bool,
             "error": str}.
    """
    base = _ytdlp_base_flags(proxy, use_cookies=True)
    cmd = (["yt-dlp"] + base + _pot_args(client) +
           ["--extractor-args", f"youtube:player_client={client}",
            "-J", "--no-download", "--no-playlist", url])
    start = time.monotonic()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "latency": timeout, "blocked": False,
                "rate_limited": False, "error": "timeout"}
    latency = time.monotonic() - start
    stderr = r.stderr or ""
    if r.returncode == 0 and r.stdout.strip():
        try:
            info = json.loads(r.stdout.splitlines()[0])
            has_formats = any(
                f.get("height") and f.get("vcodec") not in (None, "none")
                for f in (info.get("formats") or [])
            )
        except (json.JSONDecodeError, IndexError):
            has_formats = False
        if has_formats:
            return {"ok": True, "latency": latency, "blocked": False,
                     "rate_limited": False, "error": ""}
        return {"ok": False, "latency": latency, "blocked": False,
                 "rate_limited": False, "error": "no usable formats (metadata-only)"}
    blocked = _is_bot_blocked(stderr)
    rate_limited = _is_429(stderr)
    err = (stderr.strip().splitlines() or [""])[-1][:200]
    return {"ok": False, "latency": latency, "blocked": blocked,
             "rate_limited": rate_limited, "error": err}


def test_proxy(proxy: str, url: str, timeout: int) -> dict:
    """Test one proxy across all client tiers. Returns a per-proxy result dict."""
    attempts = []
    for client in CLIENT_TIERS:
        result = _test_proxy_client(proxy, client, url, timeout)
        result["client"] = client
        attempts.append(result)
        logging.info("  proxy=%s client=%s ok=%s latency=%.1fs%s",
                      proxy, client, result["ok"], result["latency"],
                      f" error={result['error']!r}" if not result["ok"] else "")
        if result["ok"]:
            break  # first working client is enough signal for this proxy

    successes = [a for a in attempts if a["ok"]]
    ok = bool(successes)
    winning_client = successes[0]["client"] if successes else None
    latency = successes[0]["latency"] if successes else None
    blocked = any(a["blocked"] for a in attempts)
    rate_limited = any(a["rate_limited"] for a in attempts)

    return {
        "proxy": proxy,
        "ok": ok,
        "winning_client": winning_client,
        "latency": latency,
        "blocked": blocked,
        "rate_limited": rate_limited,
        "attempts": attempts,
        "tested_at": time.time(),
    }


def score_result(result: dict) -> float:
    """Higher is better. Success is required for any positive score; faster and
    unblocked wins are ranked above slow / blocked ones.

    - Failure (no working client): 0.0
    - Bot-blocked/rate-limited on the way to success: penalized but not zeroed —
      a proxy that eventually works is still usable, just less reliable.
    - Base 100 for success, minus latency penalty, minus block/rate-limit penalty.
    """
    if not result["ok"]:
        return 0.0
    latency = result["latency"] or 0.0
    score = 100.0 - min(latency, 60.0)  # 1 point per second, capped at 60s penalty
    if result["blocked"]:
        score -= 20.0
    if result["rate_limited"]:
        score -= 15.0
    return max(score, 1.0)  # any success keeps a floor > 0 so it outranks failures


def persist_scores(results: list) -> None:
    """Write per-proxy scores to a redis hash, each entry TTL'd via a wrapper key
    check on read (redis hashes have no per-field TTL) — we stamp `tested_at` and
    callers should treat entries older than PROXY_SCORE_TTL_SEC as stale.
    """
    if not results:
        return
    mapping = {}
    for r in results:
        mapping[r["proxy"]] = json.dumps({
            "score": score_result(r),
            "ok": r["ok"],
            "winning_client": r["winning_client"],
            "latency": r["latency"],
            "blocked": r["blocked"],
            "rate_limited": r["rate_limited"],
            "tested_at": r["tested_at"],
        })
    try:
        redis_client.hset(PROXY_SCORE_REDIS_KEY, mapping=mapping)
        redis_client.expire(PROXY_SCORE_REDIS_KEY, PROXY_SCORE_TTL_SEC)
        logging.info("Persisted %d proxy scores to redis key %r", len(mapping), PROXY_SCORE_REDIS_KEY)
    except Exception as exc:
        logging.warning("Could not persist proxy scores to redis: %s", exc)


def print_report(results: list) -> None:
    ranked = sorted(results, key=score_result, reverse=True)
    print("\n=== Proxy Quality Report (best → worst) ===")
    for rank, r in enumerate(ranked, 1):
        score = score_result(r)
        why = []
        if not r["ok"]:
            why.append("all clients failed")
        else:
            why.append(f"won via {r['winning_client']} in {r['latency']:.1f}s")
        if r["blocked"]:
            why.append("hit bot-block on some clients")
        if r["rate_limited"]:
            why.append("hit 429 on some clients")
        print(f"{rank:>3}. score={score:6.1f}  {r['proxy']:<50}  {'; '.join(why)}")
    print(f"\n{sum(1 for r in results if r['ok'])}/{len(results)} proxies usable.\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_TEST_URL,
                         help="Test video URL (default: short public video)")
    parser.add_argument("--timeout", type=int, default=20,
                         help="Per-attempt timeout in seconds (default: 20)")
    parser.add_argument("--no-persist", action="store_true",
                         help="Skip writing scores to redis (dry run)")
    args = parser.parse_args()

    proxies = get_proxies()
    if not proxies:
        logging.error("No proxies returned by get_proxies() — check YTDLP_PROXY_LIST / PROXY_PROVIDER")
        return

    logging.info("Testing %d proxies against %s", len(proxies), args.url)
    results = [test_proxy(p, args.url, args.timeout) for p in proxies]

    print_report(results)
    if not args.no_persist:
        persist_scores(results)


if __name__ == "__main__":
    main()
