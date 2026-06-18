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
    auto_publish_config: dict
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
                   auto_publish, auto_publish_config, active, subscribed_at, lease_expires_at,
                   last_video_id, last_notified_at, created_at
            FROM channel_subscriptions
            WHERE tenant_id = :tid
            ORDER BY created_at DESC
        """),
        {"tid": current_user.tenant_id},
    )
    rows = result.fetchall()
    out = []
    for r in rows:
        d = dict(r._mapping)
        if d.get("auto_publish_config") is None:
            d["auto_publish_config"] = {}
        out.append(d)
    return out


async def _resolve_channel_id(input_str: str) -> tuple[str, str]:
    """
    Resolve any YouTube URL / @handle / UCxxxxxx to (channel_id, channel_name).
    Tries yt-dlp channel page scrape via oEmbed then RSS probe.
    """
    import os, httpx, re as _re

    s = input_str.strip()

    # Already a bare UCxxxxxx ID
    if _re.match(r'^UC[\w-]{22}$', s):
        return s, ""

    # Extract UCxxxxxx from /channel/UCxxxxxx URLs
    m = _re.search(r'/channel/(UC[\w-]{22})', s)
    if m:
        return m.group(1), ""

    # Extract channel_id query param
    m = _re.search(r'channel_id=(UC[\w-]{22})', s)
    if m:
        return m.group(1), ""

    # Handle @handle or youtube.com/@handle URLs — scrape channel page
    handle = None
    m = _re.search(r'/@([\w.-]+)', s)
    if m:
        handle = m.group(1)
    elif _re.match(r'^@?([\w.-]+)$', s):
        handle = s.lstrip('@')

    _YT_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def _extract_channel_from_html(html: str, fallback_name: str = "") -> tuple[str, str] | None:
        cid_match = (
            _re.search(r'"externalId":"(UC[\w-]{22})"', html) or
            _re.search(r'"externalChannelId":"(UC[\w-]{22})"', html) or
            _re.search(r'"channelId":"(UC[\w-]{22})"', html) or
            _re.search(r'"browseId":"(UC[\w-]{22})"', html)
        )
        name_match = (
            _re.search(r'"og:title" content="([^"]+)"', html) or
            _re.search(r'"channelName":"([^"]+)"', html) or
            _re.search(r'"author":"([^"]+)"', html)
        )
        if cid_match:
            name = name_match.group(1) if name_match else fallback_name
            return cid_match.group(1), name
        return None

    # Handle YouTube watch URLs — use YouTube Data API to get channel from video
    vid_m = _re.search(r'(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/)([A-Za-z0-9_-]{11})', s)
    if vid_m:
        vid_id = vid_m.group(1)
        yt_key = os.getenv("YOUTUBE_API_KEY", "")
        if yt_key:
            try:
                async with httpx.AsyncClient(timeout=10) as c:
                    r = await c.get(
                        "https://www.googleapis.com/youtube/v3/videos",
                        params={"part": "snippet", "id": vid_id, "key": yt_key},
                    )
                items = r.json().get("items", [])
                if items:
                    snip = items[0]["snippet"]
                    cid = snip.get("channelId", "")
                    name = snip.get("channelTitle", "")
                    if cid:
                        return cid, name
            except Exception:
                pass
        # Fallback: scrape video page
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
                r = await c.get(s, headers=_YT_HEADERS)
            result = _extract_channel_from_html(r.text)
            if result:
                return result
        except Exception:
            pass

    if handle:
        url = f"https://www.youtube.com/@{handle}"
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
                r = await c.get(url, headers=_YT_HEADERS)
            result = _extract_channel_from_html(r.text, handle)
            if result:
                return result
        except Exception:
            pass

    raise HTTPException(status_code=422, detail=f"Could not resolve YouTube channel ID from: {input_str!r}")


@router.get("/websub/resolve")
async def resolve_channel(
    q: str = Query(..., description="YouTube URL, @handle, or channel ID"),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Resolve any YouTube handle/URL to channel_id + channel_name."""
    channel_id, channel_name = await _resolve_channel_id(q)
    return {"channel_id": channel_id, "channel_name": channel_name}


@router.post("/websub/channels", status_code=201)
async def add_channel(
    req: SubscribeRequest,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)

    # Resolve handle/URL → real UCxxxxxx channel_id
    channel_id, resolved_name = await _resolve_channel_id(req.channel_id)
    channel_name = req.channel_name or resolved_name

    subscribe_channel.apply_async(
        args=[channel_id, tenant_id, channel_name, req.channel_url or f"https://www.youtube.com/channel/{channel_id}",
              req.auto_publish, req.auto_publish_config],
        queue="viralo.post.publish",
    )
    return {"channel_id": channel_id, "channel_name": channel_name, "status": "subscribing"}


class UpdateChannelRequest(BaseModel):
    auto_publish: bool | None = None
    auto_publish_config: dict | None = None


@router.patch("/websub/channels/{channel_id}", status_code=200)
async def update_channel(
    channel_id: str,
    req: UpdateChannelRequest,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    import json as _json
    sets = []
    params: dict = {"cid": channel_id, "tid": current_user.tenant_id}
    if req.auto_publish is not None:
        sets.append("auto_publish = :ap")
        params["ap"] = req.auto_publish
    if req.auto_publish_config is not None:
        sets.append("auto_publish_config = :cfg")
        params["cfg"] = _json.dumps(req.auto_publish_config)
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")
    sets.append("updated_at = now()")
    await db.execute(
        text(f"UPDATE channel_subscriptions SET {', '.join(sets)} WHERE channel_id = :cid AND tenant_id = :tid"),
        params,
    )
    await db.commit()
    return {"channel_id": channel_id, "updated": True}


@router.get("/websub/channels/{channel_id}/videos")
async def channel_recent_videos(
    channel_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Fetch recent videos for a channel via YouTube public RSS feed (no API key needed)."""
    import httpx
    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(feed_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/atom+xml,application/xml,text/xml,*/*",
                "Accept-Language": "en-US,en;q=0.9",
            })
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "yt": "http://www.youtube.com/xml/schemas/2015",
            "media": "http://search.yahoo.com/mrss/",
        }
        videos = []
        for entry in root.findall("atom:entry", ns):
            vid_id = entry.findtext("yt:videoId", namespaces=ns) or ""
            title = entry.findtext("atom:title", namespaces=ns) or ""
            published = entry.findtext("atom:published", namespaces=ns) or ""
            link_el = entry.find("atom:link", ns)
            url = link_el.get("href", f"https://www.youtube.com/watch?v={vid_id}") if link_el is not None else ""
            thumb = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg" if vid_id else ""
            # view count from media:group/media:community
            views = None
            community = entry.find("media:group/media:community", ns)
            if community is not None:
                stats = community.find("media:statistics", ns)
                if stats is not None:
                    views = stats.get("views")
            videos.append({
                "video_id": vid_id,
                "title": title,
                "published": published,
                "url": url,
                "thumbnail": thumb,
                "views": views,
            })
        return {"channel_id": channel_id, "videos": videos}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"YouTube RSS error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/websub/channels/{channel_id}/top-videos")
async def channel_top_videos(
    channel_id: str,
    max_results: int = Query(default=25, le=50),
    order: str = Query(default="viewCount"),  # viewCount | date | rating
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Fetch top videos for a channel via YouTube Data API v3.
    Returns videos with already_clipped flag based on existing jobs in this tenant."""
    import os
    import httpx

    api_key = os.getenv("YOUTUBE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="YOUTUBE_API_KEY not configured")

    channels_url = "https://www.googleapis.com/youtube/v3/channels"
    playlist_url = "https://www.googleapis.com/youtube/v3/playlistItems"
    videos_url = "https://www.googleapis.com/youtube/v3/videos"

    async with httpx.AsyncClient(timeout=15) as client:
        # Step 1: get uploads playlist ID for this channel (1 quota unit)
        ch_resp = await client.get(channels_url, params={
            "key": api_key,
            "id": channel_id,
            "part": "contentDetails",
        })
        if ch_resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"YouTube channels API error: {ch_resp.text[:200]}")
        ch_items = ch_resp.json().get("items", [])
        if not ch_items:
            return {"channel_id": channel_id, "videos": [], "order": order}
        uploads_playlist = ch_items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

        # Step 2: list videos from uploads playlist (1 quota unit per page)
        # Fetch up to max_results items; for viewCount sort we need more items to sort client-side
        fetch_count = 50 if order == "viewCount" else max_results
        pl_resp = await client.get(playlist_url, params={
            "key": api_key,
            "playlistId": uploads_playlist,
            "part": "contentDetails",
            "maxResults": min(fetch_count, 50),
        })
        if pl_resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"YouTube playlistItems API error: {pl_resp.text[:200]}")
        video_ids = [
            item["contentDetails"]["videoId"]
            for item in pl_resp.json().get("items", [])
        ]

        if not video_ids:
            return {"channel_id": channel_id, "videos": [], "order": order}

        # Step 3: get full stats + snippet for those IDs (1 quota unit per 50)
        stats_resp = await client.get(videos_url, params={
            "key": api_key,
            "id": ",".join(video_ids),
            "part": "snippet,statistics,contentDetails",
        })
        if stats_resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"YouTube videos API error: {stats_resp.text[:200]}")

        stats_data = stats_resp.json()

    # Step 3: check which video IDs are already clipped in this tenant
    if video_ids:
        rows = await db.execute(
            text(
                "SELECT source_url FROM videos "
                "WHERE source_url IS NOT NULL AND source_type = 'youtube_url' "
                "AND status != 'deleted'"
            )
        )
        clipped_urls = {r[0] for r in rows.fetchall()}
        clipped_ids = {url.split("v=")[-1].split("&")[0] for url in clipped_urls if "v=" in url}
    else:
        clipped_ids = set()

    # Build response
    videos = []
    for item in stats_data.get("items", []):
        vid_id = item["id"]
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        duration_raw = item.get("contentDetails", {}).get("duration", "PT0S")

        thumbnails = snippet.get("thumbnails", {})
        thumb = (
            thumbnails.get("maxres", thumbnails.get("high", thumbnails.get("medium", {}))).get("url", "")
        )

        videos.append({
            "video_id": vid_id,
            "title": snippet.get("title", ""),
            "published": snippet.get("publishedAt", ""),
            "url": f"https://www.youtube.com/watch?v={vid_id}",
            "thumbnail": thumb,
            "views": stats.get("viewCount"),
            "likes": stats.get("likeCount"),
            "comments": stats.get("commentCount"),
            "duration": duration_raw,
            "already_clipped": vid_id in clipped_ids,
        })

    # Sort client-side (playlist order = newest first; we fetched 50 to sort by views)
    if order == "viewCount":
        videos.sort(key=lambda v: int(v["views"] or 0), reverse=True)
    elif order == "rating":
        videos.sort(key=lambda v: int(v["likes"] or 0), reverse=True)
    # order == "date" → already newest-first from playlist

    return {"channel_id": channel_id, "videos": videos[:max_results], "order": order}


@router.delete("/websub/channels/{channel_id}", status_code=204)
async def remove_channel(
    channel_id: str,
    db: AsyncSession = Depends(get_tenant_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    await db.execute(
        text("UPDATE channel_subscriptions SET active = false, updated_at = now() WHERE channel_id = :cid AND tenant_id = :tid"),
        {"cid": channel_id, "tid": current_user.tenant_id},
    )
    await db.commit()
    _subscribe(channel_id, mode="unsubscribe")
    return Response(status_code=204)
