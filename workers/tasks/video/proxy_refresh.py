"""Self-refreshing FREE proxy pool.

Fetches a public free-proxy list, validates each candidate with the SAME real
yt-dlp video-info extraction test used to score the paid pool
(workers/tasks/proxy_quality_tester.py:test_proxy/score_result — reused, not
reimplemented), and persists only the survivors to redis with a short TTL.
workers/tasks/proxies.py:_free_proxies() reads that same key when
PROXY_PROVIDER=free (the new default) — this task is what keeps that pool
alive and self-healing as free proxies rot (see celery_app.py beat_schedule).
"""
import concurrent.futures
import logging
import time
import urllib.request as _urllib_req

from celery.exceptions import SoftTimeLimitExceeded

from workers.celery_app import celery_app
from workers.tasks.proxies import FREE_PROXY_POOL_REDIS_KEY
from workers.tasks.proxy_quality_tester import CLIENT_TIERS, DEFAULT_TEST_URL, score_result, test_proxy
from workers.tasks.video._core import redis_client
from workers.tasks.video.cookies import _redact_secrets

__all__ = ["refresh_free_proxy_pool"]

FREE_PROXY_LIST_URL = "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt"

# Free proxies are public/shared/no-SLA and die within hours — a short TTL means
# a stale pool EXPIRES (get_proxies() then falls back to static) instead of
# silently serving dead IPs indefinitely. Re-tested well inside this window (see
# the beat schedule) so the pool is rarely actually at risk of expiring empty.
FREE_PROXY_POOL_TTL_SEC = 4 * 3600  # 4h

FREE_PROXY_FETCH_TIMEOUT_SEC = 15
FREE_PROXY_TEST_TIMEOUT_SEC = 15

# The source list can carry hundreds of already-dead entries; testing all of
# them would blow the task's time budget for little gain. Test candidates in
# the order the source returns them, capped here.
FREE_PROXY_MAX_CANDIDATES = 60

# test_proxy() tries every entry in CLIENT_TIERS until one succeeds, each with
# its own FREE_PROXY_TEST_TIMEOUT_SEC timeout — so a fully-dead proxy (the
# common case for a public free list) costs len(CLIENT_TIERS) * timeout before
# test_proxy() gives up on it. Tested serially, FREE_PROXY_MAX_CANDIDATES of
# those would need up to 60 * 6 * 15s ≈ 90 minutes — far past any sane task
# time limit. Testing FREE_PROXY_TEST_CONCURRENCY candidates in parallel cuts
# worst-case wall-clock by that same factor instead of by candidate count.
FREE_PROXY_TEST_CONCURRENCY = 12
_WORST_CASE_PER_CANDIDATE_SEC = len(CLIENT_TIERS) * FREE_PROXY_TEST_TIMEOUT_SEC
# ceil(candidates / concurrency) batches, each up to the worst-case per-candidate
# time, plus the fetch timeout — the actual bound the task's time limits must
# clear. +50% headroom for redis round-trips / scheduling jitter between batches.
_WORST_CASE_RUN_SEC = int(
    ((FREE_PROXY_MAX_CANDIDATES + FREE_PROXY_TEST_CONCURRENCY - 1) // FREE_PROXY_TEST_CONCURRENCY)
    * _WORST_CASE_PER_CANDIDATE_SEC * 1.5
) + FREE_PROXY_FETCH_TIMEOUT_SEC


def _fetch_candidate_proxies() -> list[str]:
    """Download the plain-text free-proxy list. Never raises — returns [] on
    any failure so callers treat it as "no new candidates this run" and leave
    the existing (possibly still-valid) redis pool alone rather than crashing
    the task or blocking real downloads.
    """
    try:
        req = _urllib_req.Request(FREE_PROXY_LIST_URL, headers={"User-Agent": "Mozilla/5.0"})
        with _urllib_req.urlopen(req, timeout=FREE_PROXY_FETCH_TIMEOUT_SEC) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
    except Exception as exc:
        logging.warning("free proxy list fetch failed: %s", _redact_secrets(exc))
        return []

    candidates: list[str] = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not line.startswith(("http://", "https://", "socks4://", "socks5://")):
            line = f"http://{line}"
        candidates.append(line)
    return candidates[:FREE_PROXY_MAX_CANDIDATES]


def _persist_survivor(proxy: str, is_first: bool) -> None:
    """Append one survivor to redis immediately, as soon as it passes.

    Incremental-by-design: if the task is killed mid-run (soft/hard time limit,
    worker restart, OOM), every survivor found before the kill is already live
    in redis, not batched up in memory and lost. `is_first` clears out the
    previous run's (possibly now-stale) entries exactly once at the start of
    this run, rather than accumulating across runs forever.
    """
    try:
        if is_first:
            redis_client.delete(FREE_PROXY_POOL_REDIS_KEY)
        redis_client.rpush(FREE_PROXY_POOL_REDIS_KEY, proxy)
        redis_client.expire(FREE_PROXY_POOL_REDIS_KEY, FREE_PROXY_POOL_TTL_SEC)
    except Exception as exc:
        logging.warning("Could not persist free proxy %s to redis: %s",
                         _redact_secrets(proxy), _redact_secrets(exc))


@celery_app.task(name="workers.tasks.video.refresh_free_proxy_pool",
                  soft_time_limit=_WORST_CASE_RUN_SEC,
                  time_limit=_WORST_CASE_RUN_SEC + 60)
def refresh_free_proxy_pool() -> dict:
    """Fetch candidates, keep only the ones that pass REAL yt-dlp extraction,
    persist survivors to redis AS THEY PASS (not batched at the end). Never
    raises — any failure (fetch, test, redis, or the task's own soft time
    limit firing) is logged and the task returns/exits with a best-effort
    result instead of crashing the beat/worker process or blocking real video
    downloads, which don't depend on this task succeeding (get_proxies() falls
    back to static).

    Candidates are tested FREE_PROXY_TEST_CONCURRENCY at a time so wall-clock
    time scales with candidates/concurrency, not candidates × worst-case —
    see _WORST_CASE_RUN_SEC, which the time limits above are sized to cover.
    """
    candidates = _fetch_candidate_proxies()
    if not candidates:
        logging.warning(
            "refresh_free_proxy_pool: no candidates fetched — leaving existing pool untouched")
        return {"tested": 0, "kept": 0}

    survivors: list[str] = []
    tested = 0
    first_persist_done = False

    def _test(proxy: str) -> tuple[str, dict | None]:
        try:
            # proxy_trusted=False, explicit: these are raw, unvalidated strings
            # straight off a public internet list — never cookie-eligible, even
            # though test_proxy()'s own default is already False (fail closed).
            return proxy, test_proxy(proxy, DEFAULT_TEST_URL, FREE_PROXY_TEST_TIMEOUT_SEC,
                                      proxy_trusted=False)
        except Exception as exc:
            logging.warning("free proxy test errored for %s: %s",
                             _redact_secrets(proxy), _redact_secrets(exc))
            return proxy, None

    # Managed manually (not `with`) so that on a soft-time-limit interrupt we can
    # shut down WITHOUT waiting for already-running threads to finish — a plain
    # `with` block's implicit shutdown(wait=True) would block on in-flight
    # candidates (each up to ~90s worst-case) before the exception could
    # propagate, eating into the hard time_limit margin for no benefit (their
    # results, if any, are simply not counted — nothing already persisted is lost).
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=FREE_PROXY_TEST_CONCURRENCY)
    try:
        futures = {ex.submit(_test, proxy): proxy for proxy in candidates}
        for fut in concurrent.futures.as_completed(futures):
            proxy, result = fut.result()
            tested += 1
            if result and result["ok"] and score_result(result) > 0:
                survivors.append(proxy)
                _persist_survivor(proxy, is_first=not first_persist_done)
                first_persist_done = True
        ex.shutdown(wait=True)
    except SoftTimeLimitExceeded:
        # Whatever passed before this fired is already persisted (see
        # _persist_survivor) — log what we managed and return instead of
        # letting the exception propagate and mark the task as failed for no
        # actionable reason (the pool is already in as good a state as we can
        # give it this run). Don't wait for in-flight threads to wind down.
        ex.shutdown(wait=False, cancel_futures=True)
        logging.warning(
            "refresh_free_proxy_pool: soft time limit hit after testing %d/%d candidates "
            "(%d kept so far) — already-found survivors are persisted",
            tested, len(candidates), len(survivors))
        return {"tested": tested, "kept": len(survivors), "interrupted": True,
                "tested_at": time.time()}

    if not survivors:
        # Nothing passed real extraction this run — let the existing key ride
        # out its own TTL instead of wiping a still-possibly-valid pool empty.
        logging.warning(
            "refresh_free_proxy_pool: 0/%d candidates passed real yt-dlp extraction",
            len(candidates))

    logging.info(
        "refresh_free_proxy_pool: %d/%d candidates passed real extraction, "
        "persisted with %ds TTL", len(survivors), len(candidates), FREE_PROXY_POOL_TTL_SEC)
    return {"tested": tested, "kept": len(survivors), "tested_at": time.time()}
