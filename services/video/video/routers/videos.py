import asyncio
import json
import os
import subprocess
import uuid
from pathlib import Path

import aiofiles
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import decode_token
from shared.deps import get_current_user, get_redis, get_tenant_db
from shared.schemas.auth import TokenPayload
from video.models import Clip, Video
from video.schemas import (
    ClipConfig,
    ClipListResponse,
    ClipPatchRequest,
    ClipResponse,
    GenerateClipsRequest,
    VideoListResponse,
    VideoResponse,
    VideoUpdateRequest,
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_celery():
    from workers.celery_app import celery_app
    return celery_app


# ---------------------------------------------------------------------------
# Upload & import
# ---------------------------------------------------------------------------

async def _oembed_inspect(video_id: str, url: str) -> dict:
    """Fetch YouTube metadata via oEmbed + noembed (no API key, no rate-limit).
    Returns partial dict: title, thumbnail_url, channel. Duration/views need yt-dlp."""
    import urllib.request as _req, urllib.parse as _uparse, asyncio as _asyncio

    def _fetch_sync() -> dict:
        result: dict = {}
        # Primary: YouTube oEmbed
        try:
            oe_url = f"https://www.youtube.com/oembed?url={_uparse.quote(url, safe='')}&format=json"
            with _req.urlopen(oe_url, timeout=8) as r:
                d = json.loads(r.read())
            result["title"] = d.get("title") or ""
            result["channel"] = d.get("author_name") or ""
            raw_thumb = d.get("thumbnail_url") or ""
            # oEmbed gives hqdefault; try maxresdefault first
            if raw_thumb:
                maxres = raw_thumb.replace("/hqdefault.jpg", "/maxresdefault.jpg").replace("/hqdefault", "/maxresdefault")
                try:
                    with _req.urlopen(maxres, timeout=4) as tr:
                        if tr.status == 200:
                            raw_thumb = maxres
                except Exception:
                    pass
            result["thumbnail_url"] = raw_thumb
        except Exception:
            pass

        # Fallback thumbnail from known URL pattern if oEmbed failed
        if not result.get("thumbnail_url"):
            result["thumbnail_url"] = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        # noembed for view_count (best-effort, may not have it)
        try:
            ne_url = f"https://noembed.com/embed?url={_uparse.quote(url, safe='')}"
            with _req.urlopen(ne_url, timeout=6) as r:
                ne = json.loads(r.read())
            if not result.get("title") and ne.get("title"):
                result["title"] = ne["title"]
        except Exception:
            pass

        return result

    return await _asyncio.get_event_loop().run_in_executor(None, _fetch_sync)


@router.post("/video/youtube/inspect", response_model=YouTubeInspectResponse)
async def inspect_youtube(
    body: YouTubeInspectRequest,
    token: TokenPayload = Depends(get_current_user),
):
    import re

    url = body.url.strip()

    yt_pattern = re.compile(
        r"(?:https?://)?(?:www\.|m\.)?(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/)([A-Za-z0-9_-]{11})"
    )
    match = yt_pattern.search(url)
    if not match:
        return YouTubeInspectResponse(valid=False, url=url, error="Not a valid YouTube URL")

    video_id = match.group(1)

    # Primary: oEmbed — fast, no auth, no rate-limit
    oembed_data = await _oembed_inspect(video_id, url)

    # Secondary: yt-dlp for duration, view_count, upload_date, description
    # If YouTube returns 429, skip gracefully — oEmbed data is enough to start
    ytdlp_data: dict = {}
    try:
        ytdlp_data = _ytdlp_fetch_json(url, timeout=20)
    except Exception:
        pass  # 429 or timeout — non-fatal, oEmbed covers the critical fields

    duration = ytdlp_data.get("duration")
    upload_raw = ytdlp_data.get("upload_date", "")
    upload_date = (
        f"{upload_raw[:4]}-{upload_raw[4:6]}-{upload_raw[6:]}"
        if len(upload_raw) == 8 else upload_raw
    )

    # yt-dlp thumbnail is higher quality if available
    thumb_url = oembed_data.get("thumbnail_url") or ""
    if ytdlp_data.get("thumbnails"):
        best = max(
            (t for t in ytdlp_data["thumbnails"] if t.get("url")),
            key=lambda t: (t.get("width", 0) or 0),
            default=None,
        )
        if best:
            thumb_url = best["url"]
    elif ytdlp_data.get("thumbnail"):
        thumb_url = ytdlp_data["thumbnail"]

    title = ytdlp_data.get("title") or oembed_data.get("title") or ""
    channel = ytdlp_data.get("uploader") or ytdlp_data.get("channel") or oembed_data.get("channel") or ""

    return YouTubeInspectResponse(
        valid=True,
        url=url,
        video_id=video_id,
        title=title or None,
        channel=channel or None,
        duration_sec=int(duration) if duration else None,
        thumbnail_url=thumb_url or None,
        view_count=ytdlp_data.get("view_count"),
        upload_date=upload_date or None,
        description=(ytdlp_data.get("description") or "")[:500] or None,
    )


@router.post("/video/upload", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_video(
    file: UploadFile = File(...),
    title: str = Form(...),
    config: str = Form(default="{}"),  # JSON-encoded ClipConfig
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
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

    tmp_dir = Path(f"/tmp/viralo-video/{video_id}")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename).name if file.filename else "upload.mp4"
    tmp_path = str(tmp_dir / safe_name)

    async with aiofiles.open(tmp_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            await f.write(chunk)

    # Upload source to persistent storage so retry can re-use it
    original_storage_key: str | None = None
    try:
        from shared.storage.base import get_storage
        storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
        storage_key = f"originals/{tenant_id}/{video_id}/{safe_name}"
        async with aiofiles.open(tmp_path, "rb") as sf:
            content = await sf.read()
        import io as _io
        original_storage_key = await storage.upload(_io.BytesIO(content), storage_key, file.content_type or "video/mp4")
    except Exception:
        pass  # non-fatal — retry just won't work for uploads

    video = Video(
        id=video_id,
        title=title,
        source_type="uploaded",
        status="queued",
        clip_config=clip_config.model_dump(),
        original_storage_key=original_storage_key,
    )
    db.add(video)
    await db.commit()
    await db.refresh(video)

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.process_uploaded_video",
        args=[str(tenant_id), str(video_id), tmp_path, clip_config.model_dump()],
        queue="viralo.video.generate",
    )
    await db.execute(update(Video).where(Video.id == video_id).values(celery_task_id=task.id))
    await db.commit()
    await db.refresh(video)

    return VideoResponse.model_validate(video)


@router.post("/video/youtube", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def import_youtube(
    body: YouTubeImportRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    video_id = uuid.uuid4()
    tenant_id = uuid.UUID(token.tenant_id) if isinstance(token.tenant_id, str) else token.tenant_id
    clip_config = body.config

    video = Video(
        id=video_id,
        title=body.title,
        source_type="youtube_url",
        source_url=body.url,
        status="queued",
        clip_config=clip_config.model_dump(),
    )
    db.add(video)
    await db.commit()
    await db.refresh(video)

    celery_app = _get_celery()
    task = celery_app.send_task(
        "workers.tasks.video.process_youtube_video",
        args=[str(tenant_id), str(video_id), body.url, clip_config.model_dump()],
        queue="viralo.video.generate",
    )
    await db.execute(update(Video).where(Video.id == video_id).values(celery_task_id=task.id))
    await db.commit()
    await db.refresh(video)

    return VideoResponse.model_validate(video)


# ---------------------------------------------------------------------------
# SSE progress stream
# ---------------------------------------------------------------------------

@router.get("/video/progress/{job_id}")
async def video_progress(
    job_id: str,
    token: str | None = Query(None, alias="token"),
    redis: aioredis.Redis = Depends(get_redis),
):
    # EventSource cannot send custom headers; accept token as query param
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    try:
        decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    async def event_generator():
        pubsub = redis.pubsub()
        # Subscribe to both progress events and per-clip upload events
        await pubsub.subscribe(f"job:{job_id}:progress", f"job:{job_id}:clips")
        try:
            timeout = 600  # 10 minutes
            elapsed = 0
            while elapsed < timeout:
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
                        # Only close stream on terminal progress status, not on clip events
                        if parsed.get("status") in ("complete", "failed") and "event" not in parsed:
                            break
                    except json.JSONDecodeError:
                        pass
                else:
                    elapsed += 1
                    if elapsed % 15 == 0:
                        yield 'data: {"type":"keepalive"}\n\n'
        except Exception:
            pass
        finally:
            await pubsub.unsubscribe(f"job:{job_id}:progress", f"job:{job_id}:clips")
            await pubsub.aclose()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Video CRUD
# ---------------------------------------------------------------------------

@router.get("/videos", response_model=VideoListResponse)
async def list_videos(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    query = select(Video).where(Video.status != "deleted")
    count_query = select(func.count()).select_from(Video).where(Video.status != "deleted")

    if status:
        query = query.where(Video.status == status)
        count_query = count_query.where(Video.status == status)

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
        select(Video).where(Video.id == video_id, Video.status != "deleted")
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
        select(Video).where(Video.id == video_id, Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    if body.title is not None:
        video.title = body.title
    if body.topic is not None:
        video.topic = body.topic

    await db.commit()
    await db.refresh(video)
    return VideoResponse.model_validate(video)


@router.post("/videos/{video_id}/fetch-metadata", response_model=VideoResponse)
async def fetch_video_metadata(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Fetch title + thumbnail from YouTube and patch the video record."""
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.status != "deleted")
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
    await db.refresh(video)
    return VideoResponse.model_validate(video)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    import shutil

    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.status != "deleted")
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")

    # Fetch clips before deleting so we can remove their files
    clips_result = await db.execute(select(Clip).where(Clip.video_id == video_id))
    clips = clips_result.scalars().all()

    # Delete clip storage files
    storage_root = Path(os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage"))
    for clip in clips:
        if clip.storage_url:
            # storage_url is like /storage/clips/tenant/clip.mp4 — strip leading /storage/
            rel = clip.storage_url.lstrip("/storage/").lstrip("storage/")
            clip_path = storage_root / rel
            try:
                clip_path.unlink(missing_ok=True)
            except Exception:
                pass

    # Delete source/temp files
    temp_dir = Path(os.getenv("VIDEO_TEMP_DIR", "/tmp/viralo-video")) / str(video_id)
    shutil.rmtree(temp_dir, ignore_errors=True)

    # Nullify clip_id on scheduled posts to avoid FK violation when deleting clips
    clip_ids = [str(c.id) for c in clips]
    if clip_ids:
        from sqlalchemy import text as sa_text
        placeholders = ", ".join(f"CAST('{cid}' AS uuid)" for cid in clip_ids)
        await db.execute(
            sa_text(f"UPDATE scheduled_posts SET clip_id = NULL WHERE clip_id IN ({placeholders})")
        )

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
        select(Video).where(Video.id == video_id, Video.status != "deleted")
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
    await db.refresh(video)
    return VideoResponse.model_validate(video)


@router.post("/videos/{video_id}/retry", response_model=VideoResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_video(
    video_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Video).where(Video.id == video_id)
    )
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found.")
    if video.status not in ("failed", "cancelled"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot retry a video with status '{video.status}'. Only failed/cancelled videos can be retried.",
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
            queue="viralo.video.generate",
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
            queue="viralo.video.generate",
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
        select(Video).where(Video.id == video_id, Video.status != "deleted")
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
        queue="viralo.video.generate",
    )

    await db.execute(
        sa_text("UPDATE videos SET celery_task_id = :tid WHERE id = CAST(:vid AS uuid)"),
        {"tid": task.id, "vid": str(video_id)},
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
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    query = select(Clip).where(Clip.status != "deleted")
    if video_id:
        query = query.where(Clip.video_id == video_id)
    if min_virality_score is not None:
        query = query.where(Clip.score >= min_virality_score)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    result = await db.execute(
        query.order_by(Clip.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    clips = result.scalars().all()
    return ClipListResponse(
        items=[ClipResponse.model_validate(c) for c in clips],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/clips/{clip_id}", response_model=ClipResponse)
async def get_clip(
    clip_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(Clip.id == clip_id, Clip.status != "deleted")
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
        select(Clip).where(Clip.id == clip_id, Clip.status != "deleted")
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
    await db.refresh(clip)
    return ClipResponse.model_validate(clip)


@router.delete("/clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_clip(
    clip_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(Clip.id == clip_id, Clip.status != "deleted")
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")
    clip.status = "deleted"
    await db.commit()
