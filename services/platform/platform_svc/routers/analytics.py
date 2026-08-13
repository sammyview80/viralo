"""Analytics endpoints — overview, per-post, and single post detail."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from platform_svc.models import AnalyticsEvent, AnalyticsSnapshot, ScheduledPost
from platform_svc.schemas import (
    AnalyticsEventResponse,
    AnalyticsOverviewResponse,
    AnalyticsSnapshotResponse,
    AnalyticsTimeseriesPoint,
    AnalyticsTimeseriesResponse,
    PostAnalyticsDetail,
)

router = APIRouter(tags=["analytics"])

_PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90}


@router.get("/analytics/overview", response_model=AnalyticsOverviewResponse)
async def analytics_overview(
    period: str = Query("30d", pattern="^(7d|30d|90d)$"),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Return cross-platform aggregate analytics for the current tenant.
    Aggregates the most recent analytics_event per scheduled post within the period.
    """
    days = _PERIOD_DAYS[period]
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Get all scheduled posts in period that have been posted
    posts_q = select(ScheduledPost.id).where(
        ScheduledPost.status == "posted",
        ScheduledPost.posted_at >= since,
    )
    posts_result = await db.execute(posts_q)
    post_ids = [row[0] for row in posts_result.all()]

    if not post_ids:
        return AnalyticsOverviewResponse(
            total_views=0,
            total_likes=0,
            total_comments=0,
            total_shares=0,
            engagement_rate=0.0,
            posts_count=0,
            period=period,
        )

    # For each post, get the latest analytics event
    # Use a subquery to pick max fetched_at per scheduled_post_id
    latest_sq = (
        select(
            AnalyticsEvent.scheduled_post_id,
            func.max(AnalyticsEvent.fetched_at).label("max_fetched"),
        )
        .where(AnalyticsEvent.scheduled_post_id.in_(post_ids))
        .group_by(AnalyticsEvent.scheduled_post_id)
        .subquery()
    )

    events_q = select(AnalyticsEvent).join(
        latest_sq,
        (AnalyticsEvent.scheduled_post_id == latest_sq.c.scheduled_post_id)
        & (AnalyticsEvent.fetched_at == latest_sq.c.max_fetched),
    )
    events_result = await db.execute(events_q)
    events = events_result.scalars().all()

    total_views = sum(e.views or 0 for e in events)
    total_likes = sum(e.likes or 0 for e in events)
    total_comments = sum(e.comments or 0 for e in events)
    total_shares = sum(e.shares or 0 for e in events)

    # Average engagement rate across events that have it
    eng_rates = [float(e.engagement_rate) for e in events if e.engagement_rate is not None]
    avg_engagement = sum(eng_rates) / len(eng_rates) if eng_rates else 0.0

    return AnalyticsOverviewResponse(
        total_views=total_views,
        total_likes=total_likes,
        total_comments=total_comments,
        total_shares=total_shares,
        engagement_rate=round(avg_engagement, 4),
        posts_count=len(post_ids),
        period=period,
    )


@router.get("/analytics/timeseries", response_model=AnalyticsTimeseriesResponse)
async def analytics_timeseries(
    period: str = Query("30d", pattern="^(7d|30d|90d)$"),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Return daily view totals (across all tenant posts) for the given period."""
    days = _PERIOD_DAYS[period]
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date()

    daily_q = (
        select(
            AnalyticsSnapshot.snapshot_date,
            func.sum(AnalyticsSnapshot.views).label("views"),
        )
        .where(AnalyticsSnapshot.snapshot_date >= since)
        .group_by(AnalyticsSnapshot.snapshot_date)
        .order_by(AnalyticsSnapshot.snapshot_date.asc())
    )
    result = await db.execute(daily_q)
    rows = result.all()

    points = [
        AnalyticsTimeseriesPoint(date=row.snapshot_date.isoformat(), views=int(row.views or 0))
        for row in rows
    ]
    return AnalyticsTimeseriesResponse(period=period, points=points)


@router.get("/analytics/posts")
async def analytics_posts(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> dict:
    """Return per-post analytics summary (paginated)."""
    # Count posted posts with any analytics events
    count_sq = (
        select(func.count(func.distinct(AnalyticsEvent.scheduled_post_id)))
    )
    total_result = await db.execute(count_sq)
    total = total_result.scalar_one()

    # Get distinct post IDs with events, paginated
    post_ids_q = (
        select(AnalyticsEvent.scheduled_post_id)
        .distinct()
        .order_by(AnalyticsEvent.scheduled_post_id)
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    post_ids_result = await db.execute(post_ids_q)
    post_ids = [row[0] for row in post_ids_result.all()]

    if not post_ids:
        return {"items": [], "total": total, "page": page, "per_page": per_page}

    # Fetch posts
    posts_result = await db.execute(
        select(ScheduledPost).where(ScheduledPost.id.in_(post_ids))
    )
    posts_map = {p.id: p for p in posts_result.scalars().all()}

    # Latest event per post
    latest_sq = (
        select(
            AnalyticsEvent.scheduled_post_id,
            func.max(AnalyticsEvent.fetched_at).label("max_fetched"),
        )
        .where(AnalyticsEvent.scheduled_post_id.in_(post_ids))
        .group_by(AnalyticsEvent.scheduled_post_id)
        .subquery()
    )
    events_result = await db.execute(
        select(AnalyticsEvent).join(
            latest_sq,
            (AnalyticsEvent.scheduled_post_id == latest_sq.c.scheduled_post_id)
            & (AnalyticsEvent.fetched_at == latest_sq.c.max_fetched),
        )
    )
    events_map = {e.scheduled_post_id: e for e in events_result.scalars().all()}

    items = []
    for pid in post_ids:
        post = posts_map.get(pid)
        event = events_map.get(pid)
        if not post:
            continue
        item = {
            "post_id": str(pid),
            "platform": post.platform,
            "status": post.status,
            "posted_at": post.posted_at.isoformat() if post.posted_at else None,
            "caption": post.caption,
            "views": event.views if event else None,
            "likes": event.likes if event else None,
            "comments": event.comments if event else None,
            "shares": event.shares if event else None,
            "engagement_rate": float(event.engagement_rate) if event and event.engagement_rate else None,
            "fetched_at": event.fetched_at.isoformat() if event else None,
        }
        items.append(item)

    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get("/analytics/{post_id}", response_model=PostAnalyticsDetail)
async def analytics_post_detail(
    post_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Return full analytics detail for a single scheduled post."""
    post_result = await db.execute(
        select(ScheduledPost).where(ScheduledPost.id == post_id)
    )
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheduled post not found.")

    # Latest analytics event
    latest_event_q = (
        select(AnalyticsEvent)
        .where(AnalyticsEvent.scheduled_post_id == post_id)
        .order_by(AnalyticsEvent.fetched_at.desc())
        .limit(1)
    )
    event_result = await db.execute(latest_event_q)
    latest_event = event_result.scalar_one_or_none()

    # All snapshots ordered oldest first
    snapshots_q = (
        select(AnalyticsSnapshot)
        .where(AnalyticsSnapshot.scheduled_post_id == post_id)
        .order_by(AnalyticsSnapshot.snapshot_date.asc())
    )
    snapshots_result = await db.execute(snapshots_q)
    snapshots = snapshots_result.scalars().all()

    return PostAnalyticsDetail(
        post_id=post.id,
        platform=post.platform,
        status=post.status,
        posted_at=post.posted_at,
        caption=post.caption,
        latest_event=AnalyticsEventResponse.model_validate(latest_event) if latest_event else None,
        snapshots=[AnalyticsSnapshotResponse.model_validate(s) for s in snapshots],
    )
