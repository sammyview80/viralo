import asyncio
import functools
import io
import json
import os
import re
import subprocess
import tempfile
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import aiofiles
import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as _BaseModel, Field, model_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import decode_token
from shared.deps import get_current_user, get_db_no_rls, get_redis, get_tenant_db
from shared.plan_gate import check_storage_quota, increment_storage_used
from shared.schemas.auth import TokenPayload
from video.models import Clip, Video
from video.schemas import (
    CAPTION_STYLE_CATALOG,
    CaptionStyleInfo,
    ClipConcatRequest,
    ClipConfig,
    ClipListResponse,
    ClipMergeAiRequest,
    ClipPatchRequest,
    ClipResponse,
    ScheduledPostSummary,
    EditorDataRequest,
    EditorDataResponse,
    GenerateClipsRequest,
    SearchClipHit,
    SearchResponse,
    SearchVideoHit,
    VideoListResponse,
    VideoResponse,
    VideoUpdateRequest,
    YouTubeFormatsResponse,
    YouTubeImportRequest,
    YouTubeInspectRequest,
    YouTubeInspectResponse,
)

def _ytdlp_proxies() -> list[str]:
    import os as _os
    proxy_list = _os.getenv("YTDLP_PROXY_LIST", "")
    if proxy_list:
        return [p.strip() for p in proxy_list.split(",") if p.strip()]
    single = _os.getenv("YTDLP_PROXY", "")
    return [single] if single else []


def _ytdlp_fetch_json(url: str, timeout: int = 30) -> dict:
    """Run yt-dlp --dump-json for metadata. Raises RuntimeError on failure or 429."""
    import os as _os
    cookies_file = _os.getenv("YTDLP_COOKIES_FILE", "")
    proxies = _ytdlp_proxies()

    def _base(proxy: str | None) -> list[str]:
        b = ["yt-dlp", "--no-download", "--dump-json", "--no-playlist", "--no-check-certificate"]
        # Cookies omitted when proxy set — IP mismatch causes YouTube to invalidate the session
        if not proxy and cookies_file and Path(cookies_file).exists():
            b += ["--cookies", cookies_file]
        if proxy:
            b += ["--proxy", proxy]
        return b

    def _strategies(proxy: str | None) -> list[list[str]]:
        b = _base(proxy)
        return [
            b + ["--extractor-args", "youtube:player_client=android", url],
            b + ["--extractor-args", "youtube:player_client=tv_embedded", url],
            b + [url],
        ]

    all_strategies: list[tuple[list[str], str | None]] = []
    for i, strat in enumerate(_strategies(proxies[0] if proxies else None)):
        all_strategies.append((strat, proxies[i % len(proxies)] if proxies else None))

    last_err = "yt-dlp returned no data"
    for i, (args, proxy) in enumerate(all_strategies):
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
            stderr = result.stderr or ""
            if "429" in stderr or "Too Many Requests" in stderr:
                # Rotate proxy for remaining strategies on 429
                if proxies and len(proxies) > 1:
                    next_proxy = proxies[(i + 1) % len(proxies)]
                    remaining = _strategies(next_proxy)[i + 1:]
                    all_strategies[i + 1:] = [(s, next_proxy) for s in remaining]
                raise RuntimeError(f"YouTube rate-limited (429): {stderr[:200]}")
            if result.returncode == 0 and result.stdout.strip():
                try:
                    return json.loads(result.stdout.strip().splitlines()[0])
                except json.JSONDecodeError as e:
                    last_err = f"yt-dlp JSON parse error: {e}"
                    continue
            last_err = stderr[:300] or last_err
        except subprocess.TimeoutExpired:
            last_err = "yt-dlp timed out"
            continue
        except RuntimeError:
            raise
        except Exception as e:
            last_err = str(e)[:300]
    raise RuntimeError(last_err)


router = APIRouter(tags=["video"])


@router.get("/caption-styles", response_model=list[CaptionStyleInfo])
async def list_caption_styles():
    """Static catalog of caption styles — the frontend picker renders from this."""
    return CAPTION_STYLE_CATALOG


_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
_TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}
_INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com"}
_SUPPORTED_HOSTS = _YOUTUBE_HOSTS | _TIKTOK_HOSTS | _INSTAGRAM_HOSTS


def _validate_youtube_url(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in _YOUTUBE_HOSTS:
        raise ValueError("Only HTTPS YouTube URLs are supported")
    if host == "youtu.be":
        if not parsed.path.strip("/"):
            raise ValueError("YouTube URL is missing a video id")
    elif parsed.path != "/watch" or "v=" not in parsed.query:
        raise ValueError("YouTube URL must be a watch URL")
    return url.strip()


def _validate_video_url(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in _SUPPORTED_HOSTS:
        raise ValueError("Only HTTPS YouTube, TikTok, or Instagram URLs are supported")
    if not parsed.path.strip("/"):
        raise ValueError("URL is missing a video path")
    return url.strip()


def _storage_url_to_relative_path(storage_url: str) -> str | None:
    if not storage_url.startswith("/storage/"):
        return None
    rel = storage_url[len("/storage/"):]
    if not rel or ".." in Path(rel).parts or Path(rel).is_absolute():
        return None
    return rel


def _decode_access_token(raw_token: str) -> TokenPayload:
    payload = decode_token(raw_token)
    if payload.get("type") != "access":
        raise ValueError("Invalid token type")
    return TokenPayload(**payload)

# Helpers
# ---------------------------------------------------------------------------

def _get_celery():
    from workers.celery_app import celery_app
    return celery_app


class ClipZipRequest(_BaseModel):
    clip_ids: list[uuid.UUID]
    zip_name: str | None = None


def _safe_stem(title: str | None, fallback: str) -> str:
    raw = (title or fallback).strip()
    return re.sub(r"[^a-z0-9_\-]", "_", raw, flags=re.IGNORECASE)[:60]


def _preview_storage_key(tenant_id: str, video_id: str) -> str:
    return f"previews/{tenant_id}/{video_id}/preview_360p.mp4"


async def _download_preview_source(source_ref: str, out_path: str) -> None:
    rel = _storage_url_to_relative_path(source_ref)
    if rel:
        storage_root = Path(os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage"))
        local_src = (storage_root / rel).resolve()
        if not local_src.exists():
            raise HTTPException(status_code=422, detail="Source file not found on disk.")
        shutil.copyfile(local_src, out_path)
        return

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        async with client.stream("GET", source_ref) as resp:
            resp.raise_for_status()
            with open(out_path, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)


# ---------------------------------------------------------------------------
# Upload & import
# ---------------------------------------------------------------------------

async def _oembed_inspect(video_id: str, url: str) -> dict:
    """Fetch YouTube metadata via oEmbed + noembed (no API key, no rate-limit).
    Returns partial dict: title, thumbnail_url, channel. Duration/views need yt-dlp."""
    import urllib.request as _req, urllib.parse as _uparse, asyncio as _asyncio

    def _fetch_sync() -> dict:
        result: dict = {}
        # YouTube oEmbed — single fast request for title/channel/thumbnail.
        try:
            oe_url = f"https://www.youtube.com/oembed?url={_uparse.quote(url, safe='')}&format=json"
            with _req.urlopen(oe_url, timeout=4) as r:
                d = json.loads(r.read())
            result["title"] = d.get("title") or ""
            result["channel"] = d.get("author_name") or ""
            # Prefer maxres without a verify round-trip; client falls back on error.
            raw_thumb = d.get("thumbnail_url") or ""
            result["thumbnail_url"] = (
                raw_thumb.replace("/hqdefault", "/maxresdefault") if raw_thumb
                else f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
            )
        except Exception:
            result["thumbnail_url"] = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"

        return result

    return await _asyncio.get_event_loop().run_in_executor(None, _fetch_sync)


async def _scrape_youtube_meta(video_id: str, timeout: int = 5) -> dict:
    """Scrape duration/views/live-status from the watch page in one HTTP GET.

    Replaces a ~10s yt-dlp subprocess with a sub-second request that parses the
    fields embedded in the page's ytInitialPlayerResponse. Best-effort: returns
    {} on any failure so oEmbed still covers title/thumbnail."""
    import urllib.request as _req, re as _re, html as _html, asyncio as _asyncio

    def _fetch_sync() -> dict:
        watch = f"https://www.youtube.com/watch?v={video_id}&hl=en"
        req = _req.Request(watch, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": "CONSENT=YES+1",
        })
        try:
            with _req.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "ignore")
        except Exception:
            return {}
        res: dict = {}
        m = _re.search(r'"lengthSeconds":"(\d+)"', body)
        if m:
            res["duration"] = int(m.group(1))
        m = _re.search(r'"viewCount":"(\d+)"', body)
        if m:
            res["view_count"] = int(m.group(1))
        m = _re.search(r'<meta name="title" content="([^"]*)"', body)
        if m:
            res["title"] = _html.unescape(m.group(1))
        # No lengthSeconds + explicit live flag → a live/upcoming stream.
        if "duration" not in res and '"isLiveContent":true' in body:
            res["is_live"] = True
        return res

    return await _asyncio.get_event_loop().run_in_executor(None, _fetch_sync)


def _parse_iso8601_duration(iso: str) -> int | None:
    """PT1H2M3S -> total seconds. Returns None if unparseable / empty (live)."""
    m = re.match(r"^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", iso or "")
    if not m:
        return None
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    total = h * 3600 + mi * 60 + s
    return total or None


async def _youtube_data_api(video_id: str, timeout: float = 4.0) -> dict | None:
    """Fetch metadata via the official YouTube Data API v3 — ~100ms, no scraping.

    Returns dict {title, channel, duration, thumbnail_url, view_count, is_live} or
    None when no API key is set / the call fails (caller falls back to scrape)."""
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        return None
    params = {
        "part": "snippet,contentDetails,statistics,liveStreamingDetails",
        "id": video_id,
        "key": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get("https://www.googleapis.com/youtube/v3/videos", params=params)
        if r.status_code != 200:
            return None
        items = r.json().get("items") or []
        if not items:
            return None
        it = items[0]
        snip = it.get("snippet", {}) or {}
        details = it.get("contentDetails", {}) or {}
        stats = it.get("statistics", {}) or {}
        # Pick the largest available thumbnail.
        thumbs = snip.get("thumbnails", {}) or {}
        best = max(thumbs.values(), key=lambda t: (t.get("width", 0) or 0), default={})
        return {
            "title": snip.get("title") or "",
            "channel": snip.get("channelTitle") or "",
            "duration": _parse_iso8601_duration(details.get("duration", "")),
            "thumbnail_url": best.get("url") or f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
            "view_count": int(stats["viewCount"]) if stats.get("viewCount") else None,
            "is_live": snip.get("liveBroadcastContent") in ("live", "upcoming"),
        }
    except Exception:
        return None


# In-memory inspect cache: video_id -> (expiry_monotonic, YouTubeInspectResponse).
# Metadata is immutable enough for a short TTL; repeat lookups return in microseconds.
_INSPECT_CACHE: dict[str, tuple[float, "YouTubeInspectResponse"]] = {}
_INSPECT_TTL = 3600.0  # 1 hour


@router.post("/youtube/inspect", response_model=YouTubeInspectResponse)
async def inspect_youtube(
    body: YouTubeInspectRequest,
    token: TokenPayload = Depends(get_current_user),
):
    import re
    import time as _time

    url = body.url.strip()

    yt_pattern = re.compile(
        r"(?:https?://)?(?:www\.|m\.)?(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/)([A-Za-z0-9_-]{11})"
    )
    match = yt_pattern.search(url)
    if not match:
        return YouTubeInspectResponse(valid=False, url=url, error="Not a valid YouTube URL")

    video_id = match.group(1)

    # Cache hit — instant.
    cached = _INSPECT_CACHE.get(video_id)
    if cached and cached[0] > _time.monotonic():
        return cached[1]

    # Primary: official YouTube Data API v3 — ~100ms, one request, all fields.
    api = await _youtube_data_api(video_id)
    if api is not None:
        if api.get("is_live"):
            return YouTubeInspectResponse(
                valid=False, url=url, video_id=video_id,
                error="Live and upcoming streams are not supported. Please use a recorded video.",
            )
        duration = api.get("duration")
        title = api.get("title") or ""
        channel = api.get("channel") or ""
        view_count = api.get("view_count")
        thumbnail = api.get("thumbnail_url")
    else:
        # Fallback: oEmbed (title/thumb) + watch-page scrape (duration/views/live), in parallel.
        oembed_data, scrape = await asyncio.gather(
            _oembed_inspect(video_id, url),
            _scrape_youtube_meta(video_id),
        )
        if scrape.get("is_live"):
            return YouTubeInspectResponse(
                valid=False, url=url, video_id=video_id,
                error="Live and upcoming streams are not supported. Please use a recorded video.",
            )
        duration = scrape.get("duration")
        title = oembed_data.get("title") or scrape.get("title") or ""
        channel = oembed_data.get("channel") or ""
        view_count = scrape.get("view_count")
        thumbnail = oembed_data.get("thumbnail_url")

    resp = YouTubeInspectResponse(
        valid=True,
        url=url,
        video_id=video_id,
        title=title or None,
        channel=channel or None,
        duration_sec=int(duration) if duration else None,
        thumbnail_url=thumbnail or None,
        view_count=view_count,
        upload_date=None,
        description=None,
    )

    # Only cache complete results (avoid pinning a transient failure for an hour).
    if resp.title and resp.duration_sec:
        _INSPECT_CACHE[video_id] = (_time.monotonic() + _INSPECT_TTL, resp)
    return resp


@router.post("/youtube/formats", response_model=YouTubeFormatsResponse)
async def youtube_formats(
    body: YouTubeInspectRequest,
    token: TokenPayload = Depends(get_current_user),
):
    """Return the quality options actually available for a YouTube URL.

    Probes via yt-dlp (tv client + PO token + cookies + proxy fallback) so the
    frontend only offers qualities a download can really fetch.
    """
    try:
        url = _validate_youtube_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    # Lazy import: the worker module is heavy (PyAV/celery); only load on demand.
    from workers.tasks.video import _list_youtube_formats

    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None, functools.partial(_list_youtube_formats, url, 30)
        )
    except RuntimeError as exc:
        # private / members-only / no formats — a client-actionable condition
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to probe video formats. Try again.",
        )
    return YouTubeFormatsResponse(url=url, **data)


@router.post("/upload", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_video(
    file: UploadFile = File(...),
    title: str = Form(...),
    config: str = Form(default="{}"),  # JSON-encoded ClipConfig
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
    pub_db: AsyncSession = Depends(get_db_no_rls),
):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only video files are accepted.",
        )

    try:
        clip_config = ClipConfig.model_validate_json(config)
    except Exception:
        clip_config = ClipConfig()

    video_id = uuid.uuid4()
    tenant_id = uuid.UUID(token.tenant_id) if isinstance(token.tenant_id, str) else token.tenant_id
    task_config = clip_config.model_dump()
    task_config["notification_user_id"] = token.sub
    if task_config.get("auto_publish_config"):
        task_config["auto_publish_config"]["notification_user_id"] = token.sub

    tmp_dir = Path(f"/tmp/viralo-video/{video_id}")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename).name if file.filename else "upload.mp4"
    tmp_path = str(tmp_dir / safe_name)

    max_upload_bytes = int(os.getenv("MAX_VIDEO_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024)))
    file_size = 0
    async with aiofiles.open(tmp_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            file_size += len(chunk)
            if file_size > max_upload_bytes:
                raise HTTPException(status_code=413, detail="Video upload exceeds the maximum allowed size.")
            await f.write(chunk)

    # Enforce storage quota before accepting the upload
    await check_storage_quota(pub_db, tenant_id, additional_bytes=file_size)

    # Upload source to persistent storage so retry can re-use it
    original_storage_key: str | None = None
    try:
        from shared.storage.base import get_storage
        storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
        storage_key = f"originals/{tenant_id}/{video_id}/{safe_name}"
        with open(tmp_path, "rb") as sf:
            original_storage_key = await storage.upload(sf, storage_key, file.content_type or "video/mp4")
    except Exception:
        pass  # non-fatal — retry just won't work for uploads

    video = Video(
        id=video_id,
        tenant_id=tenant_id,
        title=title,
        source_type="uploaded",
        status="queued",
        clip_config=task_config,
        original_storage_key=original_storage_key,
    )
    db.add(video)
    await db.commit()

    # Track storage usage (non-fatal if this fails)
    try:
        await increment_storage_used(pub_db, tenant_id, file_size)
    except Exception:
        pass

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.process_uploaded_video",
        args=[str(tenant_id), str(video_id), tmp_path, task_config],
    )
    await db.execute(update(Video).where(Video.id == video_id).values(celery_task_id=task.id))
    await db.commit()
    await db.refresh(video)

    return VideoResponse.model_validate(video)


@router.post("/youtube", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def import_youtube(
    body: YouTubeImportRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    try:
        body.url = _validate_youtube_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    video_id = uuid.uuid4()
    tenant_id = uuid.UUID(token.tenant_id) if isinstance(token.tenant_id, str) else token.tenant_id
    clip_config = body.config
    task_config = clip_config.model_dump()
    task_config["notification_user_id"] = token.sub
    if task_config.get("auto_publish_config"):
        task_config["auto_publish_config"]["notification_user_id"] = token.sub

    video = Video(
        id=video_id,
        tenant_id=tenant_id,
        title=body.title,
        source_type="youtube_url",
        source_url=body.url,
        status="queued",
        clip_config=task_config,
    )
    db.add(video)
    await db.commit()

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.process_youtube_video",
        args=[str(tenant_id), str(video_id), body.url, task_config],
    )
    await db.execute(update(Video).where(Video.id == video_id).values(celery_task_id=task.id))
    await db.commit()

    await db.refresh(video)
    return VideoResponse.model_validate(video)


# ---------------------------------------------------------------------------
# SSE progress stream
# ---------------------------------------------------------------------------

@router.post("/progress/{job_id}/ticket")
async def create_progress_ticket(
    job_id: str,
    token: TokenPayload = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_no_rls),
):
    import secrets

    owner = await db.execute(
        select(Video.id).where(
            Video.celery_task_id == job_id,
            Video.tenant_id == uuid.UUID(token.tenant_id),
            Video.status != "deleted",
        )
    )
    if owner.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Job not found")
    ticket = secrets.token_urlsafe(32)
    await redis.setex(f"progress_ticket:{ticket}", 60, job_id)
    return {"ticket": ticket}

@router.get("/progress/{job_id}")
async def video_progress(
    job_id: str,
    ticket: str | None = Query(None),
    redis: aioredis.Redis = Depends(get_redis),
):
    claimed_job = await redis.getdel(f"progress_ticket:{ticket}") if ticket else None
    if claimed_job != job_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid stream ticket")

    async def event_generator():
        import time as _time
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"job:{job_id}:progress", f"job:{job_id}:clips")
        try:
            try:
                latest = await redis.get(f"job:{job_id}:progress:last")
            except Exception:
                latest = None
            if latest:
                if isinstance(latest, bytes):
                    latest = latest.decode()
                yield f"data: {latest}\n\n"
                try:
                    parsed = json.loads(latest)
                    if parsed.get("status") in ("complete", "failed", "cancelled"):
                        return
                except json.JSONDecodeError:
                    pass

            deadline = _time.monotonic() + 600  # 10 minutes from now
            keepalive_at = _time.monotonic() + 15
            while _time.monotonic() < deadline:
                try:
                    message = await asyncio.wait_for(
                        pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                        timeout=2.0,
                    )
                except asyncio.TimeoutError:
                    message = None

                if message and message["type"] == "message":
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode()
                    yield f"data: {data}\n\n"
                    try:
                        parsed = json.loads(data)
                        if parsed.get("status") in ("complete", "failed") and "event" not in parsed:
                            break
                    except json.JSONDecodeError:
                        pass
                else:
                    if _time.monotonic() >= keepalive_at:
                        yield 'data: {"type":"keepalive"}\n\n'
                        keepalive_at = _time.monotonic() + 15
        except Exception:
            pass
        finally:
            await pubsub.unsubscribe(f"job:{job_id}:progress", f"job:{job_id}:clips")
            await pubsub.aclose()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Video CRUD
# ---------------------------------------------------------------------------

@router.get("/videos/clipping", response_model=VideoListResponse)
async def list_clipping_videos(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    tenant_id = uuid.UUID(token.tenant_id)
    excl = or_(Video.source_type != "ranking", Video.source_type.is_(None))
    query = select(Video).where(Video.tenant_id == tenant_id, Video.status != "deleted", excl)
    count_query = select(func.count()).select_from(Video).where(Video.tenant_id == tenant_id, Video.status != "deleted", excl)
    if status:
        query = query.where(Video.status == status)
        count_query = count_query.where(Video.status == status)
    total = (await db.execute(count_query)).scalar_one()
    query = query.order_by(Video.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    videos = (await db.execute(query)).scalars().all()
    return VideoListResponse(items=list(videos), total=total, page=page, per_page=per_page)


@router.get("/videos/ranking", response_model=VideoListResponse)
async def list_ranking_videos(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    tenant_id = uuid.UUID(token.tenant_id)
    query = select(Video).where(Video.tenant_id == tenant_id, Video.status != "deleted", Video.source_type == "ranking")
    count_query = select(func.count()).select_from(Video).where(Video.tenant_id == tenant_id, Video.status != "deleted", Video.source_type == "ranking")
    if status:
        query = query.where(Video.status == status)
        count_query = count_query.where(Video.status == status)
    total = (await db.execute(count_query)).scalar_one()
    query = query.order_by(Video.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    videos = (await db.execute(query)).scalars().all()
    return VideoListResponse(items=list(videos), total=total, page=page, per_page=per_page)


@router.get("/search", response_model=SearchResponse)
async def search_videos_and_clips(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(8, ge=1, le=25),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> SearchResponse:
    """Keyword search across videos and clips for the current tenant."""
    term = f"%{q}%"
    tenant_uuid = uuid.UUID(token.tenant_id)

    video_stmt = (
        select(Video)
        .where(
            Video.tenant_id == tenant_uuid,
            Video.status != "deleted",
            or_(
                Video.title.ilike(term),
                Video.topic.ilike(term),
                Video.script_text.ilike(term),
            ),
        )
        .order_by(Video.created_at.desc())
        .limit(limit)
    )
    video_result = await db.execute(video_stmt)
    videos = video_result.scalars().all()

    clip_stmt = (
        select(Clip)
        .where(
            Clip.tenant_id == tenant_uuid,
            Clip.status != "deleted",
            or_(
                Clip.title.ilike(term),
                Clip.caption_srt.ilike(term),
            ),
        )
        .order_by(Clip.created_at.desc())
        .limit(limit)
    )
    clip_result = await db.execute(clip_stmt)
    clips = clip_result.scalars().all()

    return SearchResponse(
        query=q,
        videos=[SearchVideoHit.model_validate(v) for v in videos],
        clips=[SearchClipHit.model_validate(c) for c in clips],
    )


@router.get("/videos", response_model=VideoListResponse)
async def list_videos(
    status: str | None = Query(None),
    source_type: str | None = Query(None),
    exclude_source_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    tenant_id = uuid.UUID(token.tenant_id)
    query = select(Video).where(Video.tenant_id == tenant_id, Video.status != "deleted")
    count_query = select(func.count()).select_from(Video).where(Video.tenant_id == tenant_id, Video.status != "deleted")

    if status:
        query = query.where(Video.status == status)
        count_query = count_query.where(Video.status == status)

    if source_type:
        query = query.where(Video.source_type == source_type)
        count_query = count_query.where(Video.source_type == source_type)

    if exclude_source_type:
        cond = or_(Video.source_type != exclude_source_type, Video.source_type.is_(None))
        query = query.where(cond)
        count_query = count_query.where(cond)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = query.order_by(Video.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    videos = result.scalars().all()

    return VideoListResponse(
        items=[VideoResponse.model_validate(v) for v in videos],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/videos/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")
    return VideoResponse.model_validate(video)


@router.patch("/videos/{video_id}", response_model=VideoResponse)
async def update_video(
    video_id: uuid.UUID,
    body: VideoUpdateRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    if body.title is not None:
        video.title = body.title
    if body.topic is not None:
        video.topic = body.topic

    await db.commit()
    return VideoResponse.model_validate(video)


@router.post("/videos/{video_id}/preview-proxy", response_model=VideoResponse)
async def create_video_preview_proxy(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Generate or reuse a low-res preview proxy for trimming UI."""
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    meta = dict(video.video_metadata or {})
    existing = meta.get("preview_storage_url")
    if isinstance(existing, str) and existing:
        return VideoResponse.model_validate(video)

    source_ref = video.original_storage_key or video.source_url
    if not source_ref:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No preview source available.")

    storage_provider = os.getenv("STORAGE_PROVIDER", "local")
    preview_key = _preview_storage_key(str(token.tenant_id), str(video_id))

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        source_path = tmp_path / "source.mp4"
        out_path = tmp_path / "preview_360p.mp4"

        try:
            if video.source_type == "youtube_url" and video.source_url:
                from workers.tasks.video.download import _download_youtube
                _download_youtube(video.source_url, str(source_path), quality="360p")
            else:
                await _download_preview_source(source_ref, str(source_path))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Failed to load preview source: {exc}")

        cmd = [
            "ffmpeg", "-y", "-threads", "1", "-i", str(source_path),
            "-vf", "scale=-2:360:flags=lanczos",
            "-c:v", "libx264", "-crf", "34", "-preset", "veryfast",
            "-c:a", "aac", "-b:a", "64k", "-ac", "2",
            "-movflags", "+faststart",
            str(out_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Preview encode failed: {stderr.decode()[-400:]}")

        try:
            from shared.storage.base import get_storage
            if storage_provider == "cloudinary":
                import cloudinary as _cld, cloudinary.uploader as _cld_up
                _cld.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))
                result = _cld_up.upload(
                    str(out_path),
                    public_id=preview_key.replace(".mp4", ""),
                    resource_type="video",
                    overwrite=True,
                )
                preview_url = result["secure_url"]
            else:
                storage = get_storage(storage_provider)
                with open(out_path, "rb") as f:
                    preview_url = await storage.upload(f, preview_key, "video/mp4")
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Preview upload failed: {exc}")

    meta["preview_storage_url"] = preview_url
    meta["preview_quality"] = "360p"
    video.video_metadata = meta
    await db.commit()
    return VideoResponse.model_validate(video)


@router.post("/videos/{video_id}/fetch-metadata", response_model=VideoResponse)
async def fetch_video_metadata(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Fetch title + thumbnail from YouTube and patch the video record."""
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")
    if video.source_type != "youtube_url" or not video.source_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a YouTube video.")

    import urllib.request as _req, urllib.parse as _uparse, logging as _log
    try:
        oembed_url = f"https://www.youtube.com/oembed?url={_uparse.quote(video.source_url.strip(), safe='')}&format=json"
        with _req.urlopen(oembed_url, timeout=10) as _resp:
            data = json.loads(_resp.read())
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"YouTube oEmbed failed: {exc}")

    title = data.get("title")
    thumb_url = data.get("thumbnail_url") or ""
    if thumb_url and "/hqdefault" in thumb_url:
        thumb_url = thumb_url.replace("/hqdefault", "/sddefault")

    if title:
        video.title = title
    if thumb_url:
        try:
            _provider = os.getenv("STORAGE_PROVIDER", "local")
            _vid_id_str = str(video_id)
            _thumb_data = _req.urlopen(thumb_url, timeout=15).read()
            _storage_key = f"thumbnails/{_vid_id_str}/thumb.jpg"
            if _provider == "cloudinary":
                import cloudinary as _cld, cloudinary.uploader as _cld_up
                _cld.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))
                import os as _os2
                _result = _cld_up.upload(
                    _thumb_data, public_id=_os2.path.splitext(_storage_key)[0],
                    resource_type="image", overwrite=True
                )
                thumb_url = _result["secure_url"]
                _log.info("thumbnail uploaded to Cloudinary: %s", thumb_url)
            else:
                from shared.storage.base import get_storage as _get_storage
                thumb_url = await _get_storage(_provider).upload(_thumb_data, _storage_key, "image/jpeg")
        except BaseException as _e:
            _log.warning("thumbnail upload failed (%s): %s", type(_e).__name__, _e)
        video.thumbnail_url = thumb_url

    await db.commit()
    return VideoResponse.model_validate(video)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    import shutil

    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    # Fetch clips before deleting so we can remove their files
    clips_result = await db.execute(select(Clip).where(Clip.video_id == video_id, Clip.tenant_id == uuid.UUID(token.tenant_id)))
    clips = clips_result.scalars().all()

    # Delete clip storage files
    storage_root = Path(os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage"))
    for clip in clips:
        if clip.storage_url:
            rel = _storage_url_to_relative_path(clip.storage_url)
            if not rel:
                continue
            clip_path = (storage_root / rel).resolve()
            if storage_root.resolve() not in clip_path.parents:
                continue
            try:
                clip_path.unlink(missing_ok=True)
            except Exception:
                pass

    # Delete source/temp files
    temp_dir = Path(os.getenv("VIDEO_TEMP_DIR", "/tmp/viralo-video")) / str(video_id)
    shutil.rmtree(temp_dir, ignore_errors=True)

    # Nullify clip_id on scheduled posts, and delete captions, to avoid FK
    # violations when deleting clips (captions.clip_id has no ON DELETE CASCADE).
    clip_ids = [str(c.id) for c in clips]
    if clip_ids:
        from sqlalchemy import text as sa_text
        # Use ANY(:arr) with parameterized array — no string interpolation
        await db.execute(
            sa_text("UPDATE scheduled_posts SET clip_id = NULL WHERE tenant_id = CAST(:tid AS uuid) AND clip_id = ANY(CAST(:ids AS uuid[]))"),
            {"tid": str(token.tenant_id), "ids": "{" + ",".join(clip_ids) + "}"},
        )
        await db.execute(
            sa_text("DELETE FROM captions WHERE tenant_id = CAST(:tid AS uuid) AND clip_id = ANY(CAST(:ids AS uuid[]))"),
            {"tid": str(token.tenant_id), "ids": "{" + ",".join(clip_ids) + "}"},
        )

    # Revoke running/queued Celery task before deleting
    if video.celery_task_id and video.status in ("queued", "processing"):
        try:
            from workers.celery_app import celery_app
            celery_app.control.revoke(video.celery_task_id, terminate=True, signal="SIGTERM")
        except Exception:
            pass

    # Hard delete clips from DB, soft delete video
    for clip in clips:
        await db.delete(clip)
    video.status = "deleted"
    await db.commit()


@router.post("/videos/{video_id}/cancel", response_model=VideoResponse)
async def cancel_video(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    if video.status not in ("queued", "processing"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel a video with status '{video.status}'. Only queued/processing videos can be cancelled.",
        )

    # Revoke Celery task — terminate=True sends SIGTERM to the worker process
    if video.celery_task_id:
        try:
            celery_app = _get_celery()
            celery_app.control.revoke(video.celery_task_id, terminate=True, signal="SIGTERM")
        except Exception:
            pass  # Worker may already be done; DB update is the source of truth

    video.status = "cancelled"
    video.pipeline_step = "cancelled"
    await db.commit()
    return VideoResponse.model_validate(video)


@router.post("/videos/{video_id}/retry", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_video(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id))
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")
    if video.status not in ("failed", "cancelled", "error"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot retry a video with status '{video.status}'. Only failed/error/cancelled videos can be retried.",
        )

    tenant_id = uuid.UUID(token.tenant_id) if isinstance(token.tenant_id, str) else token.tenant_id

    video.status = "queued"
    video.pipeline_step = None
    video.pipeline_pct = 0
    await db.commit()

    clip_config = video.clip_config or {}
    celery_app = _get_celery()
    if video.source_type == "youtube_url" and video.source_url:
        task = celery_app.send_task(
            "workers.tasks.video.process_youtube_video",
            args=[str(tenant_id), str(video_id), video.source_url, clip_config],
        )
    else:
        if not video.original_storage_key:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Original file no longer available for retry. Please re-upload.",
            )
        task = celery_app.send_task(
            "workers.tasks.video.process_uploaded_video",
            args=[str(tenant_id), str(video_id), video.original_storage_key, clip_config],
        )

    video.celery_task_id = task.id
    await db.commit()
    await db.refresh(video)
    return VideoResponse.model_validate(video)


@router.post("/videos/{video_id}/generate-clips", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def generate_viral_clips(
    video_id: uuid.UUID,
    body: GenerateClipsRequest = GenerateClipsRequest(),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Score the video's transcript for viral moments and create Clip records (no re-render)."""
    from sqlalchemy import text as sa_text

    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.tenant_id == uuid.UUID(token.tenant_id), Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    # Verify transcript exists
    tr = await db.execute(
        sa_text("SELECT 1 FROM transcripts WHERE video_id = CAST(:vid AS uuid)"),
        {"vid": str(video_id)},
    )
    if not tr.fetchone():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Video has no transcript yet. Run the full pipeline first.",
        )

    tenant_id = uuid.UUID(token.tenant_id) if isinstance(token.tenant_id, str) else token.tenant_id
    cfg = body.config.model_dump()

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.generate_viral_clips",
        args=[str(tenant_id), str(video_id), cfg],
    )

    await db.execute(
        sa_text("UPDATE videos SET celery_task_id = :tid WHERE id = CAST(:vid AS uuid) AND tenant_id = CAST(:tenant_id AS uuid)"),
        {"tid": task.id, "vid": str(video_id), "tenant_id": str(tenant_id)},
    )
    await db.commit()
    await db.refresh(video)
    return VideoResponse.model_validate(video)


# ---------------------------------------------------------------------------
# Clip CRUD
# ---------------------------------------------------------------------------

@router.get("/clips", response_model=ClipListResponse)
async def list_clips(
    video_id: uuid.UUID | None = Query(None),
    min_virality_score: float | None = Query(None, ge=0.0, le=10.0),
    sort_by: Literal["created_at", "score"] = Query("created_at"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    query = select(Clip).where(Clip.tenant_id == uuid.UUID(token.tenant_id), Clip.status != "deleted")
    if video_id:
        query = query.where(Clip.video_id == video_id)
    if min_virality_score is not None:
        query = query.where(Clip.score >= min_virality_score)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    order_col = Clip.score.desc().nulls_last() if sort_by == "score" else Clip.created_at.desc()
    result = await db.execute(
        query.order_by(order_col).offset((page - 1) * per_page).limit(per_page)
    )
    clips = result.scalars().all()
    posts_by_clip: dict[uuid.UUID, list[ScheduledPostSummary]] = {}
    if clips:
        from sqlalchemy import text as sa_text

        clip_ids = [str(c.id) for c in clips]
        rows = (
            await db.execute(
                sa_text(
                    """
                    SELECT id, clip_id, platform, status, scheduled_at, posted_at, created_at, last_error
                    FROM scheduled_posts
                    WHERE tenant_id = CAST(:tid AS uuid)
                      AND clip_id = ANY(CAST(:ids AS uuid[]))
                      AND status != 'deleted'
                    ORDER BY created_at DESC
                    """
                ),
                {"tid": str(token.tenant_id), "ids": "{" + ",".join(clip_ids) + "}"},
            )
        ).mappings().all()
        for row in rows:
            cid = row["clip_id"]
            posts_by_clip.setdefault(cid, []).append(ScheduledPostSummary.model_validate(row))

    return ClipListResponse(
        items=[
            ClipResponse.model_validate(c).model_copy(
                update={"scheduled_posts": posts_by_clip.get(c.id, [])}
            )
            for c in clips
        ],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("/clips/{clip_id}/upscale", response_model=ClipResponse)
async def upscale_clip(
    clip_id: uuid.UUID,
    target_resolution: Literal["1080p", "4K"] = Query(default="4K"),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Upscale clip to 1080p or 4K using FFmpeg lanczos. Runs synchronously — expect 10–60s."""
    import tempfile

    result = await db.execute(
        select(Clip).where(Clip.id == clip_id, Clip.tenant_id == uuid.UUID(token.tenant_id), Clip.status != "deleted")
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found.")
    if not clip.storage_url:
        raise HTTPException(status_code=422, detail="Clip has no source file.")

    scale_map = {"1080p": "1920:1080", "4K": "3840:2160"}
    scale = scale_map[target_resolution]

    storage_provider = os.getenv("STORAGE_PROVIDER", "local")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        src_path = tmp_path / "source.mp4"
        out_path = tmp_path / f"upscaled_{target_resolution}.mp4"

        # Resolve source — local or remote
        rel = _storage_url_to_relative_path(clip.storage_url)
        if rel:
            storage_root = Path(os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage"))
            local_src = (storage_root / rel).resolve()
            if not local_src.exists():
                raise HTTPException(status_code=422, detail="Clip source file not found on disk.")
            src_path = local_src
        else:
            # Remote URL (Cloudinary etc.) — download to temp
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                async with client.stream("GET", clip.storage_url) as resp:
                    resp.raise_for_status()
                    with open(src_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                            f.write(chunk)

        cmd = [
            "ffmpeg", "-y", "-threads", "1", "-i", str(src_path),
            "-vf", f"scale={scale}:flags=lanczos",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-threads", "1",
            "-c:a", "copy",
            str(out_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg failed: {stderr.decode()[-500:]}")

        # Upload result
        storage_key = f"clips/{token.tenant_id}/{clip_id}_upscaled_{target_resolution}.mp4"
        if storage_provider == "cloudinary":
            import cloudinary as _cld, cloudinary.uploader as _cld_up
            _cld.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))
            cld_result = _cld_up.upload(
                str(out_path),
                public_id=storage_key.replace(".mp4", ""),
                resource_type="video",
                overwrite=True,
            )
            upscaled_url = cld_result["secure_url"]
        else:
            from shared.storage.base import get_storage as _get_storage
            with open(out_path, "rb") as f:
                upscaled_url = await _get_storage(storage_provider).upload(f.read(), storage_key, "video/mp4")

    clip.upscaled_storage_url = upscaled_url
    await db.commit()
    return ClipResponse.model_validate(clip)


@router.post("/clips/download-zip")
async def download_clips_zip(
    body: ClipZipRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    if not body.clip_ids:
        raise HTTPException(status_code=400, detail="No clip IDs provided.")
    if len(body.clip_ids) > 50:
        raise HTTPException(status_code=400, detail="Max 50 clips per zip.")

    result = await db.execute(
        select(Clip).where(Clip.id.in_(body.clip_ids), Clip.tenant_id == uuid.UUID(token.tenant_id), Clip.status != "deleted")
    )
    clips = result.scalars().all()

    if not clips:
        raise HTTPException(status_code=404, detail="No clips found.")

    import tempfile
    tmp = tempfile.SpooledTemporaryFile(max_size=50 * 1024 * 1024)  # spill to disk > 50 MB

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        with zipfile.ZipFile(tmp, mode="w", compression=zipfile.ZIP_STORED) as zf:
            seen: dict[str, int] = {}
            for i, clip in enumerate(clips):
                if not clip.storage_url:
                    continue
                stem = _safe_stem(clip.title, f"clip_{i + 1}")
                key = stem.lower()
                if key in seen:
                    seen[key] += 1
                    stem = f"{stem}_{seen[key]}"
                else:
                    seen[key] = 0
                filename = f"{stem}.mp4"

                try:
                    # Stream clip data in chunks — don't load entire file into memory
                    async with client.stream("GET", clip.storage_url) as resp:
                        resp.raise_for_status()
                        with zf.open(filename, "w", force_zip64=True) as zentry:
                            async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                                zentry.write(chunk)
                except Exception:
                    continue

    tmp.seek(0)
    zip_name = _safe_stem(body.zip_name, "clips") + ".zip"

    async def _iter_and_close():
        try:
            while True:
                chunk = tmp.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            tmp.close()

    return StreamingResponse(
        _iter_and_close(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.post("/clips/concat", status_code=202)
async def concat_clips(
    body: ClipConcatRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Queue concatenation of top-2 clips into a composite."""
    tenant_id = token.tenant_id

    if body.clip_ids is not None:
        clip_ids = [str(c) for c in body.clip_ids]
        if len(clip_ids) != 2:
            raise HTTPException(status_code=400, detail="Provide exactly 2 clip_ids")
    else:
        result = await db.execute(
            select(Clip.id)
            .where(
                Clip.video_id == body.video_id,
                Clip.tenant_id == uuid.UUID(tenant_id),
                Clip.status == "ready",
                Clip.score.isnot(None),
                or_(
                    Clip.clip_metadata["composite"].astext.is_(None),
                    Clip.clip_metadata["composite"].astext == "false",
                ),
            )
            .order_by(Clip.score.desc())
            .limit(2)
        )
        rows = result.scalars().all()
        if len(rows) < 2:
            raise HTTPException(status_code=422, detail="Need at least 2 ready clips with scores")
        clip_ids = [str(r) for r in rows]

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.concat_top_clips",
        args=[tenant_id, str(body.video_id), clip_ids],
    )
    return {"task_id": task.id, "clip_ids": clip_ids, "message": "Concatenation queued"}


@router.post("/clips/merge-ai", status_code=202)
async def merge_ai_clips_endpoint(
    body: ClipMergeAiRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Queue LLM-assisted merge of selected clips. Beta feature."""
    tenant_id = token.tenant_id
    clip_ids = [str(c) for c in body.clip_ids]

    if len(clip_ids) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 clip_ids to merge")
    if len(clip_ids) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 clips per merge operation")

    result = await db.execute(
        select(func.count()).where(
            Clip.id.in_([uuid.UUID(c) for c in clip_ids]),
            Clip.tenant_id == uuid.UUID(tenant_id),
            Clip.status == "ready",
        )
    )
    count = result.scalar_one()
    if count != len(clip_ids):
        raise HTTPException(status_code=404, detail="One or more clips not found or not ready")

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.merge_ai_clips",
        args=[tenant_id, clip_ids],
    )
    return {"task_id": task.id, "clip_ids": clip_ids, "message": "MergeAI queued — merged clips will appear in your library when ready"}


@router.get("/clips/{clip_id}", response_model=ClipResponse)
async def get_clip(
    clip_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(Clip.id == clip_id, Clip.tenant_id == uuid.UUID(token.tenant_id), Clip.status != "deleted")
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")
    return ClipResponse.model_validate(clip)


@router.patch("/clips/{clip_id}", response_model=ClipResponse)
async def patch_clip(
    clip_id: uuid.UUID,
    body: ClipPatchRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(Clip.id == clip_id, Clip.tenant_id == uuid.UUID(token.tenant_id), Clip.status != "deleted")
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")
    meta = dict(clip.clip_metadata or {})
    if body.tags is not None:
        meta["tags"] = body.tags
    if body.platform_copy is not None:
        meta["platform_copy"] = body.platform_copy
    clip.clip_metadata = meta
    await db.commit()
    return ClipResponse.model_validate(clip)


@router.patch("/clips/{clip_id}/editor", response_model=EditorDataResponse)
async def save_editor_data(
    clip_id: uuid.UUID,
    body: EditorDataRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Persist editor state (trim, captions, sound markers) into clip_metadata.editor."""
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
            Clip.status != "deleted",
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")

    meta = dict(clip.clip_metadata or {})
    meta["editor"] = body.model_dump()
    clip.clip_metadata = meta
    await db.commit()
    return EditorDataResponse(clip_id=clip.id, editor=body)


@router.get("/clips/{clip_id}/editor", response_model=EditorDataResponse)
async def get_editor_data(
    clip_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Return previously saved editor state for a clip."""
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
            Clip.status != "deleted",
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")

    editor_raw = (clip.clip_metadata or {}).get("editor", {})
    editor = EditorDataRequest(**editor_raw) if editor_raw else EditorDataRequest()
    return EditorDataResponse(clip_id=clip.id, editor=editor)


@router.post("/clips/{clip_id}/retry-upload", response_model=ClipResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_clip_upload(
    clip_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Re-queue an upload_failed clip for upload."""
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
            Clip.status.in_(["upload_failed", "failed"]),
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found or not in failed state.")

    clip.status = "pending_upload"
    clip.upload_error = None
    await db.commit()

    # Re-dispatch upload task — safe path: tenant_id and clip_id are validated UUIDs
    safe_tid = str(uuid.UUID(str(token.tenant_id)))  # reject non-UUID tenant_id
    clip_path = str(Path("/tmp/viralo-video") / safe_tid / f"clip_{clip_id}.mp4")
    job_id = str(clip.video_id)
    celery_app = _get_celery()
    celery_app.send_task(
        "workers.tasks.video.upload_clip_to_storage",
        args=[str(clip_id), clip_path, token.tenant_id, job_id],
    )
    return clip


@router.delete("/clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_clip(
    clip_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(Clip.id == clip_id, Clip.tenant_id == uuid.UUID(token.tenant_id), Clip.status != "deleted")
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")
    clip.status = "deleted"
    await db.commit()


# ---------------------------------------------------------------------------
# Video ranking
# ---------------------------------------------------------------------------

class RankingSegmentRequest(_BaseModel):
    source_type: str  # "url" or "upload"
    url: str | None = None
    video_id: uuid.UUID | None = None
    start_sec: float = Field(default=0.0, ge=0)
    end_sec: float = Field(default=30.0, gt=0)
    segment_title: str = ""

    @model_validator(mode="after")
    def validate_trim_window(self):
        if self.end_sec <= self.start_sec:
            raise ValueError("end_sec must exceed start_sec")
        return self


class CreateRankingRequest(_BaseModel):
    title: str
    theme: str = "classic"                   # kept for backward compat
    template: str = "viral"
    template_config: dict | None = None
    order: str = "countdown"  # "countdown" or "ascending"
    segments: list[RankingSegmentRequest]


class RankingPreviewSourceRequest(_BaseModel):
    url: str


class RankingPreviewSourceResponse(_BaseModel):
    preview_url: str
    quality: str = "360p"


class SuggestTitleRequest(_BaseModel):
    topic: str
    segment_count: int = 5


@router.post("/ranking", status_code=status.HTTP_202_ACCEPTED)
async def create_ranking(
    req: CreateRankingRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    if len(req.segments) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 segments")
    VALID_TEMPLATES = ("viral", "classic", "neon", "minimal")
    effective_template = req.template if req.template in VALID_TEMPLATES else req.theme
    if effective_template not in VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="invalid template")
    if req.order not in ("countdown", "ascending"):
        raise HTTPException(status_code=400, detail="invalid order")
    for i, seg in enumerate(req.segments):
        if seg.source_type == "upload" and seg.video_id is None:
            raise HTTPException(status_code=400, detail=f"segment {i}: upload requires video_id")
        if seg.source_type == "url":
            if not seg.url:
                raise HTTPException(status_code=400, detail=f"segment {i}: url required")
            try:
                seg.url = _validate_video_url(seg.url)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"segment {i}: {e}")
        if seg.end_sec <= seg.start_sec:
            raise HTTPException(status_code=400, detail=f"segment {i}: end_sec must exceed start_sec")

    tenant_id = uuid.UUID(token.tenant_id) if isinstance(token.tenant_id, str) else token.tenant_id
    video_id = uuid.uuid4()
    job_id = str(uuid.uuid4())

    video = Video(
        id=video_id,
        tenant_id=tenant_id,
        title=req.title,
        source_type="ranking",
        status="queued",
        celery_task_id=job_id,
        video_metadata={
            "title": req.title,
            "theme": effective_template,
            "template": effective_template,
            "template_config": req.template_config,
            "order": req.order,
            "segment_count": len(req.segments),
        },
    )
    db.add(video)
    await db.commit()

    segments = [
        {
            "source_type": s.source_type,
            "url": s.url,
            "video_id": str(s.video_id) if s.video_id else None,
            "start_sec": s.start_sec,
            "end_sec": s.end_sec,
            "segment_title": s.segment_title or "",
        }
        for s in req.segments
    ]

    celery_app = _get_celery()
    try:
        celery_app.send_task(
            "workers.tasks.video.generate_video_ranking",
            args=[str(tenant_id), str(video_id), segments, req.title, effective_template, req.order],
            kwargs={"template_config": req.template_config},
            task_id=job_id,
        )
    except Exception as exc:
        video.status = "failed"
        video.pipeline_step = "failed"
        video.error_message = "Could not queue ranking video. Please try again."
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=video.error_message,
        ) from exc

    return {"video_id": str(video_id), "job_id": job_id}


@router.post("/ranking/preview-source", response_model=RankingPreviewSourceResponse)
async def create_ranking_preview_source(
    req: RankingPreviewSourceRequest,
    token: TokenPayload = Depends(get_current_user),
):
    try:
        url = _validate_video_url(req.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    storage_provider = os.getenv("STORAGE_PROVIDER", "local")
    preview_key = f"previews/{token.tenant_id}/ranking-url/{uuid.uuid4()}/preview_360p.mp4"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        source_path = tmp_path / "source.mp4"
        out_path = tmp_path / "preview_360p.mp4"

        try:
            from workers.tasks.video.download import _download_youtube
            _download_youtube(url, str(source_path), quality="360p")
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Failed to load preview source: {exc}")

        cmd = [
            "ffmpeg", "-y", "-threads", "1", "-i", str(source_path),
            "-vf", "scale=-2:360:flags=lanczos",
            "-c:v", "libx264", "-crf", "35", "-preset", "veryfast",
            "-c:a", "aac", "-b:a", "56k", "-ac", "2",
            "-movflags", "+faststart",
            str(out_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Preview encode failed: {stderr.decode()[-400:]}")

        try:
            from shared.storage.base import get_storage
            if storage_provider == "cloudinary":
                import cloudinary as _cld, cloudinary.uploader as _cld_up
                _cld.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))
                result = _cld_up.upload(
                    str(out_path),
                    public_id=preview_key.replace(".mp4", ""),
                    resource_type="video",
                    overwrite=True,
                )
                preview_url = result["secure_url"]
            else:
                storage = get_storage(storage_provider)
                with open(out_path, "rb") as f:
                    preview_url = await storage.upload(f, preview_key, "video/mp4")
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Preview upload failed: {exc}")

    return RankingPreviewSourceResponse(preview_url=preview_url)


@router.post("/ranking/suggest-title")
async def suggest_ranking_title(
    req: SuggestTitleRequest,
    token: TokenPayload = Depends(get_current_user),
):
    from workers.tasks.video import _suggest_ranking_title
    return _suggest_ranking_title(req.topic, req.segment_count)
