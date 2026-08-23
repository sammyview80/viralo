"""
Video processing pipeline — ClipForge-based.
PyAV for video I/O (no ffmpeg needed for clip export/audio).
Groq Whisper (word timestamps) + Groq LLaMA for AI scoring.
Pillow for caption burn-in.
ffmpeg still used for YouTube download + metadata probe fallback.
"""
import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field, replace as dataclass_replace
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Optional

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app


from workers.tasks.video._core import *

__all__ = [
    '_ytdlp_proxies',
    '_ytdlp_proxies_with_refresh',
    '_COOKIES_BUNDLED',
    '_COOKIES_LIVE',
    '_MIN_COOKIE_BYTES',
    '_record_good_proxy',
    '_is_valid_cookie_file',
    '_seed_live_cookies',
    '_active_cookies_path',
    '_cookies_flags',
    '_ytdlp_base_flags',
    '_POT_CLIENTS',
    '_pot_args',
    '_resolve_downloaded',
    '_is_429',
    '_is_bot_blocked',
    '_is_bad_cookies',
]

def _ytdlp_proxies() -> list[str]:
    """Return the proxy pool from the configured provider (static or residential).

    See workers/tasks/proxies.py. Returns list[str] of proxy URLs — residential
    entries differ only by session token, so each resolves to a fresh egress IP.
    """
    from workers.tasks import proxies as _proxies
    return _proxies.get_proxies()


_GOOD_PROXY_REDIS_KEY = "ytdlp:last_good_proxy"
_GOOD_PROXY_TTL_SEC = 1800  # proxies rotate/die — don't trust a stale hint forever

# In-process fallback only for when redis itself is unreachable; the real
# shared state lives in redis so every worker process/restart benefits from
# whichever one last found a working proxy, instead of each fresh worker
# (constant after every deploy/restart) re-burning through the whole dead
# proxy list from scratch — that's what was making downloads take 5-10+
# minutes cycling through mostly-dead/bot-blocked proxies one at a time.
_LAST_GOOD_PROXY_LOCAL: str | None = None


def _record_good_proxy(proxy: str) -> None:
    global _LAST_GOOD_PROXY_LOCAL
    _LAST_GOOD_PROXY_LOCAL = proxy
    try:
        redis_client.setex(_GOOD_PROXY_REDIS_KEY, _GOOD_PROXY_TTL_SEC, proxy)
    except Exception as exc:
        logging.warning("Could not persist good proxy to redis: %s", exc)


_PROXY_SCORE_REDIS_KEY = "ytdlp:proxy_scores"
_PROXY_SCORE_TOP_N = 5
# Must match PROXY_SCORE_TTL_SEC in workers/tasks/proxy_quality_tester.py. Not
# imported directly — that module imports FROM this one (_is_429/_pot_args/etc),
# so importing back would be circular. Redis hash fields have no per-field TTL
# (only hset with a whole-key expire), so a proxy that's gone dead since its last
# test would otherwise rank forever until the whole key expires; enforce staleness
# here explicitly instead.
_PROXY_SCORE_TTL_SEC = 6 * 3600


def _top_scored_proxies(proxies: list[str]) -> list[str]:
    """Return up to _PROXY_SCORE_TOP_N proxies from `proxies`, ranked by the score
    workers/tasks/proxy_quality_tester.py wrote to redis hash _PROXY_SCORE_REDIS_KEY
    (score > 0 only, not stale, ties broken by most recent tested_at). Empty list if
    redis is down, the hash is empty, or nothing scored positively/fresh — callers
    must treat that as "no ranking available" and fall back to existing order
    unchanged.
    """
    try:
        raw = redis_client.hgetall(_PROXY_SCORE_REDIS_KEY)
    except Exception as exc:
        logging.warning("Could not read proxy scores from redis: %s", exc)
        return []
    if not raw:
        return []

    proxy_set = set(proxies)
    now = time.time()
    scored: list[tuple[float, float, str]] = []
    for k, v in raw.items():
        proxy = k.decode() if isinstance(k, bytes) else k
        if proxy not in proxy_set:
            continue
        try:
            data = json.loads(v.decode() if isinstance(v, bytes) else v)
            score = float(data.get("score") or 0)
            tested_at = float(data.get("tested_at") or 0)
        except (ValueError, TypeError, AttributeError):
            continue
        if score > 0 and (now - tested_at) <= _PROXY_SCORE_TTL_SEC:
            scored.append((score, tested_at, proxy))

    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [proxy for _, _, proxy in scored[:_PROXY_SCORE_TOP_N]]


def _ytdlp_proxies_with_refresh() -> list[str]:
    proxies = _ytdlp_proxies()

    top_scored = _top_scored_proxies(proxies)
    if top_scored:
        rest = [p for p in proxies if p not in top_scored]
        proxies = top_scored + rest
        logging.info("Reordered proxy list: top %d scored proxies first", len(top_scored))

    good = _LAST_GOOD_PROXY_LOCAL
    try:
        redis_good = redis_client.get(_GOOD_PROXY_REDIS_KEY)
        if redis_good:
            good = redis_good.decode() if isinstance(redis_good, bytes) else redis_good
    except Exception as exc:
        logging.warning("Could not read good proxy from redis, using in-process fallback: %s", exc)
    if good and good in proxies:
        proxies.remove(good)
        proxies.insert(0, good)
        logging.info("Trying last known-good proxy first: %s", good)
    return proxies


# Bundled cookies: read-only, baked into the image / mounted from the repo.
_COOKIES_BUNDLED = "/app/yt-cookies.txt"
# Live cookies: writable named-volume copy that the keep-warm task refreshes in
# place (yt-dlp writes rotated cookies back here, keeping the session alive).
# Downloads read from here; falls back to the bundled file if the volume is empty.
_COOKIES_LIVE = os.getenv("YT_COOKIES_LIVE", "/var/lib/yt/cookies.txt")
_MIN_COOKIE_BYTES = 100


def _is_valid_cookie_file(p: str) -> bool:
    """True if file is a non-trivial Netscape-format cookie file (valid header)."""
    try:
        f = Path(p)
        if not f.exists() or f.stat().st_size < _MIN_COOKIE_BYTES:
            return False
        head = f.read_bytes()[:64].lstrip()
        return head.startswith(b"# Netscape HTTP Cookie File") or head.startswith(b"# HTTP Cookie File")
    except Exception:
        return False


def _seed_live_cookies() -> None:
    """Seed the live cookie store from the bundled file if missing/empty/corrupt. Idempotent."""
    try:
        if _is_valid_cookie_file(_COOKIES_LIVE):
            return
        if _is_valid_cookie_file(_COOKIES_BUNDLED):
            live = Path(_COOKIES_LIVE)
            live.parent.mkdir(parents=True, exist_ok=True)
            live.write_bytes(Path(_COOKIES_BUNDLED).read_bytes())
            logging.info("Seeded live cookie store %s from bundled file", _COOKIES_LIVE)
    except Exception as e:
        logging.warning("_seed_live_cookies: %s", e)


def _active_cookies_path() -> str | None:
    """Path to the freshest usable cookie file: live store if present, else bundled."""
    _seed_live_cookies()
    for p in (_COOKIES_LIVE, _COOKIES_BUNDLED):
        if _is_valid_cookie_file(p):
            return p
    return None


def _cookies_flags(unique: bool = False) -> list[str]:
    """Return --cookies flag pointing to a per-call writable copy of the active file.

    Per-call copy so parallel download workers don't corrupt each other's file
    via yt-dlp's cookie writeback. Cookie REFRESH is owned by the keep-warm task
    (refresh_youtube_cookies), which writes directly to the live store.
    """
    try:
        src_path = _active_cookies_path()
        if not src_path:
            return []
        import tempfile as _tf
        tmp = _tf.NamedTemporaryFile(suffix=".txt", delete=False, dir="/tmp", prefix="yt-cookies-")
        tmp.write(Path(src_path).read_bytes())
        tmp.close()
        return ["--cookies", tmp.name]
    except Exception as e:
        logging.warning("_cookies_flags: %s", e)
        return []

def _ytdlp_base_flags(proxy: str | None = None, use_cookies: bool = False) -> list[str]:
    """Return common yt-dlp flags."""
    if proxy:
        flags = ["--no-check-certificate", "--retries", "1",
                 "--socket-timeout", "15",
                 "--proxy", proxy]
    else:
        flags = ["--no-check-certificate", "--retries", "2",
                 "--socket-timeout", "20"]
    if use_cookies:
        flags += _cookies_flags()
    return flags


# PO Token (Proof-of-Origin) — YouTube 2024+ requires these for web/mweb/tv clients.
# Generated automatically by the bgutil-ytdlp-pot-provider plugin if installed +
# the provider HTTP server is reachable (BGUTIL_POT_BASE_URL, default :4416).
# Set YTDLP_DISABLE_POT=1 to skip (e.g. if provider not deployed yet).
_POT_CLIENTS = {"web", "mweb", "tv", "tv_embedded", "web_safari", "web_embedded"}


def _pot_args(client: str) -> list[str]:
    """Force PO-token fetch for clients that need it. No-op when disabled."""
    if os.getenv("YTDLP_DISABLE_POT", "") == "1":
        return []
    if client not in _POT_CLIENTS:
        return []
    base_url = os.getenv("BGUTIL_POT_BASE_URL", "http://127.0.0.1:4416")
    return ["--extractor-args", f"youtubepot-bgutilhttp:base_url={base_url}"]


def _resolve_downloaded(template_path: str) -> str | None:
    """Return the file yt-dlp actually wrote for output template `template_path`.

    With `--merge-output-format mp4`, yt-dlp rewrites the output extension, so a
    template like "out.mp4.proxy0.tmp" yields "out.mp4.proxy0.tmp.mp4" on disk.
    Checking the bare template path misses it and a successful download (rc=0)
    looks like a failure. Resolve the real, non-empty file instead.
    """
    import glob as _glob
    cands = [template_path, template_path + ".mp4",
             template_path + ".mkv", template_path + ".webm"]
    cands += sorted(_glob.glob(_glob.escape(template_path) + ".*"))
    for c in cands:
        try:
            if os.path.exists(c) and os.path.getsize(c) > 0:
                return c
        except OSError:
            pass
    return None


def _is_429(stderr: str) -> bool:
    return "429" in stderr or "Too Many Requests" in stderr

def _is_bot_blocked(stderr: str) -> bool:
    s = stderr.lower()
    return "sign in to confirm" in s or "not a bot" in s or "confirm you're not a bot" in s

def _is_bad_cookies(stderr: str) -> bool:
    s = stderr.lower()
    return (
        "invalid" in s and "cookie" in s
        or "cookiefile" in s
        or "no such file" in s and "cookie" in s
        or "http error 400" in s
        or "please sign in" in s
        # yt-dlp message when the exported cookies were rotated/expired by the browser
        or ("no longer valid" in s and "cookie" in s)
        or "have likely been rotated" in s
        or "account cookies are no longer valid" in s
    )


