"""Scheduled post management and calendar endpoints."""
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from platform_svc.models import ScheduledPost, SocialAccount
from platform_svc.schemas import (
    ScheduledPostCreate,
    ScheduledPostListResponse,
    ScheduledPostResponse,
    ScheduledPostUpdate,
)

router = APIRouter(tags=["scheduling"])

# ---------------------------------------------------------------------------
# Optimal posting time heuristics (no ML — time-of-day recommendations)
# ---------------------------------------------------------------------------

OPTIMAL_TIMES: dict[str, list[str]] = {
    "tiktok": ["07:00", "19:00", "22:00"],
    "instagram": ["08:00", "12:00", "20:00"],
    "youtube": ["14:00", "17:00", "20:00"],
    "twitter": ["08:00", "12:00", "17:00"],
    "linkedin": ["08:00", "12:00", "17:00"],
    "facebook": ["09:00", "13:00", "19:00"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_query(
    tenant_id: uuid.UUID,
    platform: str | None,
    post_status: str | None,
    from_dt: datetime | None,
    to_dt: datetime | None,
):
    q = select(ScheduledPost).where(
        ScheduledPost.tenant_id == tenant_id,
        ScheduledPost.status != "deleted",
    )
    if platform:
        q = q.where(ScheduledPost.platform == platform)
    if post_status:
        q = q.where(ScheduledPost.status == post_status)
    if from_dt:
        q = q.where(ScheduledPost.scheduled_at >= from_dt)
    if to_dt:
        q = q.where(ScheduledPost.scheduled_at <= to_dt)
    return q


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def _resolve_clip_storage_url(db: AsyncSession, clip_id: uuid.UUID, tenant_id: uuid.UUID) -> str | None:
    """Fetch storage_url from clips table for a tenant-owned clip_id."""
    row = await db.execute(
        text("SELECT storage_url FROM clips WHERE id = CAST(:cid AS uuid) AND tenant_id = CAST(:tenant_id AS uuid)"),
        {"cid": str(clip_id), "tenant_id": str(tenant_id)},
    )
    r = row.fetchone()
    return r[0] if r else None


@router.post("/scheduled-posts", response_model=ScheduledPostResponse, status_code=status.HTTP_201_CREATED)
async def create_scheduled_post(
    body: ScheduledPostCreate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Schedule a tenant-owned clip for posting to a tenant-owned social account."""
    tenant_id = uuid.UUID(token.tenant_id)

    account_result = await db.execute(
        select(SocialAccount).where(
            SocialAccount.id == body.social_account_id,
            SocialAccount.tenant_id == tenant_id,
            SocialAccount.is_active == True,
        )
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Social account not found.")

    clip_storage_url = await _resolve_clip_storage_url(db, body.clip_id, tenant_id)
    if not clip_storage_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found.")

    post = ScheduledPost(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        clip_id=body.clip_id,
        social_account_id=body.social_account_id,
        platform=account.platform,
        status="scheduled",
        scheduled_at=body.scheduled_at,
        caption=body.caption,
        hashtags=body.hashtags,
        clip_storage_url=clip_storage_url,
        platform_kwargs={
            **(body.platform_kwargs or {}),
            "notification_user_id": token.sub,
        },
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return ScheduledPostResponse.model_validate(post)


@router.post("/scheduled-posts/{post_id}/publish-now", response_model=ScheduledPostResponse)
async def publish_post_now(
    post_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Immediately enqueue a scheduled post for publishing (bypasses scheduled_at)."""
    import os
    from celery import Celery

    result = await db.execute(
        update(ScheduledPost).where(
            ScheduledPost.id == post_id,
            ScheduledPost.tenant_id == uuid.UUID(token.tenant_id),
            ScheduledPost.status.in_(["scheduled", "pending", "failed"]),
        ).values(
            status="processing",
            scheduled_at=datetime.now(timezone.utc),
        ).returning(ScheduledPost)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found or not in a publishable state (must be scheduled/pending/failed).",
        )

    # Ensure clip_storage_url is set
    if not post.clip_storage_url and post.clip_id:
        post.clip_storage_url = await _resolve_clip_storage_url(db, post.clip_id, uuid.UUID(token.tenant_id))

    await db.commit()

    # Enqueue directly — don't wait for beat
    broker_url = os.getenv("CELERY_BROKER_URL", os.getenv("RABBITMQ_URL", "amqp://viralo:viralo@rabbitmq:5672//"))
    app = Celery(broker=broker_url)
    app.send_task(
        "workers.tasks.post.publish_post",
        args=[str(token.tenant_id), str(post_id)],
        queue="viralo.post.publish",
    )

    return ScheduledPostResponse.model_validate(post)


@router.get("/scheduled-posts", response_model=ScheduledPostListResponse)
async def list_scheduled_posts(
    platform: str | None = Query(None),
    post_status: str | None = Query(None, alias="status"),
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """List scheduled posts with optional filters and pagination."""
    base_q = _build_query(uuid.UUID(token.tenant_id), platform, post_status, from_dt, to_dt)

    count_q = select(func.count()).select_from(base_q.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    q = base_q.order_by(ScheduledPost.scheduled_at.asc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    posts = result.scalars().all()

    return ScheduledPostListResponse(
        items=[ScheduledPostResponse.model_validate(p) for p in posts],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/scheduled-posts/{post_id}", response_model=ScheduledPostResponse)
async def get_scheduled_post(
    post_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.tenant_id == uuid.UUID(token.tenant_id), ScheduledPost.status != "deleted")
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled post not found.")
    return ScheduledPostResponse.model_validate(post)


@router.patch("/scheduled-posts/{post_id}", response_model=ScheduledPostResponse)
async def update_scheduled_post(
    post_id: uuid.UUID,
    body: ScheduledPostUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.tenant_id == uuid.UUID(token.tenant_id), ScheduledPost.status != "deleted")
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled post not found.")

    if post.status == "posted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify a post that has already been published.",
        )

    if body.scheduled_at is not None:
        post.scheduled_at = body.scheduled_at
    if body.caption is not None:
        post.caption = body.caption
    if body.hashtags is not None:
        post.hashtags = body.hashtags

    await db.commit()
    await db.refresh(post)
    return ScheduledPostResponse.model_validate(post)


@router.delete("/scheduled-posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_scheduled_post(
    post_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Cancel a scheduled post (sets status to cancelled)."""
    result = await db.execute(
        select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.tenant_id == uuid.UUID(token.tenant_id), ScheduledPost.status != "deleted")
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled post not found.")

    if post.status == "posted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot cancel a post that has already been published.",
        )

    post.status = "cancelled"
    await db.commit()


@router.get("/calendar")
async def get_calendar(
    month: str | None = Query(None, description="YYYY-MM format, defaults to current month"),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> list[dict[str, Any]]:
    """Return scheduled posts grouped by calendar day for a given month."""
    if month:
        try:
            year, mon = month.split("-")
            from_dt = datetime(int(year), int(mon), 1, tzinfo=timezone.utc)
            # Last day of month — go to first of next month
            if int(mon) == 12:
                to_dt = datetime(int(year) + 1, 1, 1, tzinfo=timezone.utc)
            else:
                to_dt = datetime(int(year), int(mon) + 1, 1, tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must be in YYYY-MM format.")
    else:
        now = datetime.now(timezone.utc)
        from_dt = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        if now.month == 12:
            to_dt = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            to_dt = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)

    q = (
        select(ScheduledPost)
        .where(
            ScheduledPost.tenant_id == uuid.UUID(token.tenant_id),
            ScheduledPost.status != "deleted",
            ScheduledPost.scheduled_at >= from_dt,
            ScheduledPost.scheduled_at < to_dt,
        )
        .order_by(ScheduledPost.scheduled_at.asc())
    )
    result = await db.execute(q)
    posts = result.scalars().all()

    # Group by date string (YYYY-MM-DD)
    calendar: dict[str, list[Any]] = {}
    for post in posts:
        day_key = post.scheduled_at.strftime("%Y-%m-%d")
        if day_key not in calendar:
            calendar[day_key] = []
        calendar[day_key].append(ScheduledPostResponse.model_validate(post).model_dump())

    return [{"date": date, "posts": posts_list} for date, posts_list in calendar.items()]


@router.get("/optimal-time/{platform}")
async def get_optimal_times(
    platform: str,
    token: TokenPayload = Depends(get_current_user),
) -> dict[str, Any]:
    """Return recommended posting times for a platform based on engagement heuristics."""
    platform = platform.lower()
    times = OPTIMAL_TIMES.get(platform)
    if times is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No optimal time data for platform '{platform}'. Supported: {', '.join(OPTIMAL_TIMES)}",
        )
    return {
        "platform": platform,
        "optimal_times_utc": times,
        "note": "Times are in UTC. Adjust for your audience's local timezone.",
    }
