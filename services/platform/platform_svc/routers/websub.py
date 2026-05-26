"""
WebSub webhook endpoints.

GET  /api/v1/websub/callback/{channel_id}  — hub verification challenge
POST /api/v1/websub/callback/{channel_id}  — incoming YouTube push notification

GET  /api/v1/websub/channels               — list subscribed channels
POST /api/v1/websub/channels               — subscribe to a channel
DELETE /api/v1/websub/channels/{channel_id} — unsubscribe
"""
import logging
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from workers.tasks.websub import (
    process_websub_notification,
    subscribe_channel,
    verify_websub_signature,
    WEBSUB_SECRET,
    _subscribe,
    LEASE_SECONDS,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["websub"])

# ---------------------------------------------------------------------------
# Hub verification + push receiver
# ---------------------------------------------------------------------------

@router.get("/websub/callback/{channel_id}", include_in_schema=False)
async def websub_verify(
    channel_id: str,
    hub_mode: str = Query(alias="hub.mode", default=""),
    hub_topic: str = Query(alias="hub.topic", default=""),
    hub_challenge: str = Query(alias="hub.challenge", default=""),
    hub_lease_seconds: int = Query(alias="hub.lease_seconds", default=0),
):
    """YouTube hub calls this to verify our subscription intent."""
    if hub_mode not in ("subscribe", "unsubscribe"):
        raise HTTPException(status_code=400, detail="Invalid hub.mode")
    if not hub_challenge:
        raise HTTPException(status_code=400, detail="Missing hub.challenge")
    log.info("WebSub verify: mode=%s channel=%s", hub_mode, channel_id)
    # Echo challenge back — confirms we own this callback URL
    return Response(content=hub_challenge, media_type="text/plain")


@router.post("/websub/callback/{channel_id}", include_in_schema=False)
async def websub_push(channel_id: str, request: Request):
    """Receive YouTube push notification for new video."""
    body = await request.body()

    # Verify HMAC signature
    sig_header = request.headers.get("X-Hub-Signature", "")
    if WEBSUB_SECRET and not verify_websub_signature(body, sig_header):
        log.warning("WebSub: invalid signature for channel %s", channel_id)
        raise HTTPException(status_code=403, detail="Invalid signature")

    # Parse Atom feed XML to extract video ID and URL
    try:
        root = ET.fromstring(body.decode("utf-8"))
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "yt": "http://www.youtube.com/xml/schemas/2015",
        }
        entry = root.find("atom:entry", ns)
        if entry is None:
            log.info("WebSub: no entry in push for channel %s (may be delete notification)", channel_id)
            return Response(status_code=200)

        video_id_el = entry.find("yt:videoId", ns)
        link_el = entry.find("atom:link", ns)

        video_id = video_id_el.text.strip() if video_id_el is not None else ""
        video_url = link_el.get("href", "") if link_el is not None else f"https://www.youtube.com/watch?v={video_id}"

        if not video_id:
            log.warning("WebSub: could not extract video_id from push for channel %s", channel_id)
            return Response(status_code=200)

        log.info("WebSub push: channel=%s video=%s url=%s", channel_id, video_id, video_url)

    except ET.ParseError as e:
        log.error("WebSub: XML parse error for channel %s: %s", channel_id, e)
        return Response(status_code=200)  # Always 200 to prevent hub retries on our parse errors

    # Dispatch to Celery — return 200 immediately so hub doesn't retry
    process_websub_notification.apply_async(
        args=[channel_id, video_id, video_url, body.decode("utf-8", errors="replace")],
        queue="viralo.post.publish",
    )
    return Response(status_code=200)


# ---------------------------------------------------------------------------
# Channel subscription management (authenticated)
# ---------------------------------------------------------------------------

from pydantic import BaseModel

class SubscribeRequest(BaseModel):
    channel_id: str
    channel_name: str = ""
    channel_url: str = ""
    auto_publish: bool = False
    auto_publish_config: dict = {}


class ChannelResponse(BaseModel):
    id: uuid.UUID
    channel_id: str
    channel_name: str | None
    channel_url: str | None
    auto_publish: bool
    active: bool
    subscribed_at: datetime | None
    lease_expires_at: datetime | None
    last_video_id: str | None
    last_notified_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/websub/channels")
async def list_channels(
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    result = await db.execute(
        text("""
            SELECT id, channel_id, channel_name, channel_url,
                   auto_publish, active, subscribed_at, lease_expires_at,
                   last_video_id, last_notified_at, created_at
            FROM channel_subscriptions
            ORDER BY created_at DESC
        """)
    )
    rows = result.fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/websub/channels", status_code=201)
async def add_channel(
    req: SubscribeRequest,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    subscribe_channel.apply_async(
        args=[req.channel_id, tenant_id, req.channel_name, req.channel_url,
              req.auto_publish, req.auto_publish_config],
        queue="viralo.post.publish",
    )
    return {"channel_id": req.channel_id, "status": "subscribing"}


@router.delete("/websub/channels/{channel_id}", status_code=204)
async def remove_channel(
    channel_id: str,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    await db.execute(
        text("UPDATE channel_subscriptions SET active = false, updated_at = now() WHERE channel_id = :cid"),
        {"cid": channel_id},
    )
    await db.commit()
    _subscribe(channel_id, mode="unsubscribe")
    return Response(status_code=204)
