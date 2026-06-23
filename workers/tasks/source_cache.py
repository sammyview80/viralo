"""Source-video cache keyed by canonical YouTube id.

Avoids re-downloading the same YouTube source for repeat and cross-tenant jobs.
The same public video downloaded by two tenants is byte-identical, so the cache
is global (not tenant-scoped) — that's the win.

Layout:
  - source bytes  -> object storage under  source-cache/<yt_id>.mp4
  - metadata      -> Redis string key  yt:srccache:meta:<yt_id>  (TTL = CACHE_TTL_SEC)
  - prune index   -> Redis zset  yt:srccache:index  (yt_id -> created_at)
  - download lock -> Redis key  yt:srccache:lock:<yt_id>  (per-id, prevents double download)

Disable with SOURCE_CACHE_DISABLE=1 or SOURCE_CACHE_TTL_SEC<=0 — every function
then behaves as a permanent miss, so callers fall back to a normal download.
"""
import asyncio
import json
import logging
import os
import re
import shutil
import time
from pathlib import Path

import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_redis = redis.from_url(REDIS_URL, max_connections=5)

CACHE_TTL_SEC = int(os.getenv("SOURCE_CACHE_TTL_SEC", str(7 * 86400)))
_DISABLED = os.getenv("SOURCE_CACHE_DISABLE") == "1" or CACHE_TTL_SEC <= 0

_PREFIX = "yt:srccache"
_INDEX = f"{_PREFIX}:index"

# youtube.com/watch?v=, youtu.be/, /shorts/, /embed/ — all carry the 11-char id.
_YT_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def youtube_id(url: str) -> str | None:
    m = _YT_ID_RE.search(url or "")
    return m.group(1) if m else None


def _meta_key(yt_id: str) -> str:
    return f"{_PREFIX}:meta:{yt_id}"


def _lock_key(yt_id: str) -> str:
    return f"{_PREFIX}:lock:{yt_id}"


def _storage_key(yt_id: str) -> str:
    return f"source-cache/{yt_id}.mp4"


def _storage():
    from shared.storage.base import get_storage
    return get_storage(os.getenv("STORAGE_PROVIDER", "local"))


def _local_path(key: str) -> Path:
    local_dir = os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage")
    return Path(local_dir) / key.lstrip("/storage/").lstrip("storage/")


def lookup(yt_id: str | None) -> dict | None:
    """Return cache metadata for yt_id, or None on miss / disabled / error."""
    if _DISABLED or not yt_id:
        return None
    try:
        raw = _redis.get(_meta_key(yt_id))
        return json.loads(raw) if raw else None
    except Exception as e:
        logging.warning("source_cache.lookup(%s): %s", yt_id, e)
        return None


def fetch_to(yt_id: str | None, dest_path: str) -> dict | None:
    """If cached, copy the source to dest_path and return its metadata; else None.

    A storage miss (object pruned/evicted while the Redis key lingered) is treated
    as a cache miss so the caller re-downloads.
    """
    meta = lookup(yt_id)
    if not meta:
        return None
    key = meta.get("storage_key")
    if not key:
        return None
    try:
        if os.getenv("STORAGE_PROVIDER", "local") == "local":
            src = _local_path(key)
            if not src.exists():
                return None
            shutil.copy2(str(src), dest_path)
        else:
            asyncio.run(_storage().download(key, dest_path))
        if not Path(dest_path).exists() or Path(dest_path).stat().st_size < 1024:
            return None
        logging.info("source_cache: HIT %s -> %s", yt_id, dest_path)
        return meta
    except Exception as e:
        logging.warning("source_cache.fetch_to(%s): %s — treating as miss", yt_id, e)
        return None


def store(yt_id: str | None, src_path: str, won_client: str | None = None,
          max_height: int | None = None) -> None:
    """Upload a freshly downloaded source to the cache. Best-effort; never raises."""
    if _DISABLED or not yt_id:
        return
    try:
        p = Path(src_path)
        if not p.exists() or p.stat().st_size < 1024:
            return
        key = _storage_key(yt_id)
        if os.getenv("STORAGE_PROVIDER", "local") == "local":
            dst = _local_path(key)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_path, str(dst))
        else:
            with open(src_path, "rb") as f:
                asyncio.run(_storage().upload(f, key, "video/mp4"))
        meta = {
            "storage_key": key,
            "won_client": won_client,
            "max_height": max_height,
            "bytes": p.stat().st_size,
            "created_at": int(time.time()),
        }
        _redis.setex(_meta_key(yt_id), CACHE_TTL_SEC, json.dumps(meta))
        _redis.zadd(_INDEX, {yt_id: meta["created_at"]})
        logging.info("source_cache: stored %s (%d bytes, client=%s)", yt_id, meta["bytes"], won_client)
    except Exception as e:
        logging.warning("source_cache.store(%s): %s", yt_id, e)


def acquire_lock(yt_id: str | None, ttl: int = 600) -> bool:
    if _DISABLED or not yt_id:
        return False
    try:
        return bool(_redis.set(_lock_key(yt_id), "1", nx=True, ex=ttl))
    except Exception:
        return False


def release_lock(yt_id: str | None) -> None:
    if not yt_id:
        return
    try:
        _redis.delete(_lock_key(yt_id))
    except Exception:
        pass


def wait_for(yt_id: str | None, dest_path: str, timeout: int = 180,
             interval: float = 3.0) -> dict | None:
    """Poll for another worker to finish caching yt_id, then fetch. None on timeout."""
    if _DISABLED or not yt_id:
        return None
    waited = 0.0
    while waited < timeout:
        meta = fetch_to(yt_id, dest_path)
        if meta:
            return meta
        time.sleep(interval)
        waited += interval
    return None


def prune() -> int:
    """Delete cache entries older than TTL from storage + index. Returns count removed."""
    if _DISABLED:
        return 0
    cutoff = int(time.time()) - CACHE_TTL_SEC
    removed = 0
    try:
        stale = _redis.zrangebyscore(_INDEX, 0, cutoff)
    except Exception as e:
        logging.warning("source_cache.prune index scan: %s", e)
        return 0
    for raw in stale:
        yt_id = raw.decode() if isinstance(raw, bytes) else raw
        key = _storage_key(yt_id)
        try:
            if os.getenv("STORAGE_PROVIDER", "local") == "local":
                _local_path(key).unlink(missing_ok=True)
            else:
                asyncio.run(_storage().delete(key))
        except Exception as e:
            logging.warning("source_cache.prune delete %s: %s", yt_id, e)
        try:
            _redis.delete(_meta_key(yt_id))
            _redis.zrem(_INDEX, yt_id)
            removed += 1
        except Exception as e:
            logging.warning("source_cache.prune index cleanup %s: %s", yt_id, e)
    if removed:
        logging.info("source_cache.prune: removed %d stale entries", removed)
    return removed
