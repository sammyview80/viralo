import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from video.models import Clip
from video.schemas import RenderRequest, RenderStatusResponse

router = APIRouter(tags=["render"])


def _get_celery():
    from workers.celery_app import celery_app
    return celery_app


@router.post("/clips/{clip_id}/render", status_code=status.HTTP_202_ACCEPTED)
async def start_render(
    clip_id: uuid.UUID,
    body: RenderRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
            Clip.status != "deleted",
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found.")
    if not clip.storage_url:
        raise HTTPException(status_code=422, detail="Clip has no source video — cannot render.")

    render_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    # Seed render record in metadata before enqueue
    meta = dict(clip.clip_metadata or {})
    renders = meta.get("renders", [])
    renders.append({
        "render_id": render_id,
        "status": "queued",
        "progress_pct": 0,
        "download_url": None,
        "error_message": None,
        "created_at": created_at,
        "quality": body.quality,
    })
    meta["renders"] = renders
    clip.clip_metadata = meta
    await db.commit()

    _get_celery().send_task(
        "workers.tasks.video.render_clip_with_edits",
        kwargs={
            "tenant_id": token.tenant_id,
            "clip_id": str(clip_id),
            "render_id": render_id,
            "storage_url": clip.storage_url,
            "trim_start_sec": body.trim_start_sec,
            "trim_end_sec": body.trim_end_sec,
            "captions": [c.model_dump() for c in body.captions],
            "markers": [m.model_dump() for m in body.markers],
            "quality": body.quality,
        },
    )
    return {"render_id": render_id, "clip_id": str(clip_id), "status": "queued"}


@router.get("/clips/{clip_id}/render/{render_id}", response_model=RenderStatusResponse)
async def get_render_status(
    clip_id: uuid.UUID,
    render_id: str,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found.")

    renders: list[dict] = (clip.clip_metadata or {}).get("renders", [])
    rec = next((r for r in reversed(renders) if r["render_id"] == render_id), None)
    if not rec:
        raise HTTPException(status_code=404, detail="Render job not found.")

    return RenderStatusResponse(
        render_id=render_id,
        clip_id=clip_id,
        status=rec["status"],
        progress_pct=rec.get("progress_pct", 0),
        download_url=rec.get("download_url"),
        error_message=rec.get("error_message"),
        created_at=rec.get("created_at", ""),
    )
