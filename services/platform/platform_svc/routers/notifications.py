"""Notification endpoints including SSE real-time stream."""
import asyncio
import json
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_redis, get_tenant_db
from shared.schemas.auth import TokenPayload
from platform_svc.models import Notification
from platform_svc.schemas import NotificationListResponse, NotificationResponse

router = APIRouter(tags=["notifications"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/notifications", response_model=NotificationListResponse)
async def list_notifications(
    unread: bool | None = Query(None, description="If true, return only unread notifications"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """List notifications for the current tenant, optionally filtered to unread only."""
    q = select(Notification)
    count_q = select(func.count()).select_from(Notification)

    if unread is True:
        q = q.where(Notification.is_read == False)
        count_q = count_q.where(Notification.is_read == False)

    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    q = q.order_by(Notification.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    notifications = result.scalars().all()

    return NotificationListResponse(
        items=[_to_response(n) for n in notifications],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.patch("/notifications/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Mark a single notification as read."""
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")

    notification.is_read = True
    await db.commit()
    await db.refresh(notification)
    return _to_response(notification)


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_notifications_read(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Mark all unread notifications as read for the current tenant."""
    await db.execute(
        update(Notification)
        .where(Notification.is_read == False)
        .values(is_read=True)
    )
    await db.commit()


@router.delete("/notifications/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    notification_id: uuid.UUID,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Permanently delete a notification."""
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")

    await db.delete(notification)
    await db.commit()


@router.get("/notifications/stream")
async def notifications_stream(
    token: TokenPayload = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    SSE stream for real-time notifications.
    Subscribes to Redis channel: notifications:{tenant_id}
    """
    tenant_id = token.tenant_id

    async def event_generator():
        pubsub = redis.pubsub()
        channel = f"notifications:{tenant_id}"
        await pubsub.subscribe(channel)
        try:
            timeout_seconds = 3600  # 1 hour max connection
            elapsed = 0
            while elapsed < timeout_seconds:
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
                    # Check for disconnect signal
                    try:
                        parsed = json.loads(data)
                        if parsed.get("type") == "disconnect":
                            break
                    except (json.JSONDecodeError, AttributeError):
                        pass
                else:
                    elapsed += 1
                    # Send keepalive every 30 seconds
                    if elapsed % 30 == 0:
                        yield 'data: {"type":"keepalive"}\n\n'
        except Exception:
            pass
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _to_response(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        is_read=n.is_read,
        metadata=n.notification_metadata,
        created_at=n.created_at,
    )
