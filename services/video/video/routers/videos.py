import asyncio
import json
import os
import uuid
from pathlib import Path

import aiofiles
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_redis, get_tenant_db
from shared.schemas.auth import TokenPayload
from video.models import Clip, Video
from video.schemas import (
    ClipConfig,
    ClipResponse,
    VideoListResponse,
    VideoResponse,
    VideoUpdateRequest,
    YouTubeImportRequest,
)

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

    video = Video(
        id=video_id,
        title=title,
        source_type="uploaded",
        status="queued",
        clip_config=clip_config.model_dump(),
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
    token: TokenPayload = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    async def event_generator():
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"job:{job_id}:progress")
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
                        if parsed.get("status") in ("complete", "failed"):
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
            await pubsub.unsubscribe(f"job:{job_id}:progress")
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

    # Hard delete clips from DB, soft delete video
    for clip in clips:
        await db.delete(clip)
    video.status = "deleted"
    await db.commit()


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
    if video.status != "failed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot retry a video with status '{video.status}'. Only 'failed' videos can be retried.",
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
        task = celery_app.send_task(
            "workers.tasks.video.process_uploaded_video",
            args=[str(tenant_id), str(video_id), None, clip_config],
            queue="viralo.video.generate",
        )

    video.celery_task_id = task.id
    await db.commit()
    await db.refresh(video)
    return VideoResponse.model_validate(video)


# ---------------------------------------------------------------------------
# Clip CRUD
# ---------------------------------------------------------------------------

@router.get("/clips", response_model=list[ClipResponse])
async def list_clips(
    video_id: uuid.UUID | None = Query(None),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    query = select(Clip).where(Clip.status != "deleted")
    if video_id:
        query = query.where(Clip.video_id == video_id)
    query = query.order_by(Clip.created_at.desc())
    result = await db.execute(query)
    clips = result.scalars().all()
    return [ClipResponse.model_validate(c) for c in clips]


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
