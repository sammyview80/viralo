"""GET /trends/search — viral trend search with MD cache."""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from shared.deps import get_current_user
from shared.schemas.auth import TokenPayload

log = logging.getLogger(__name__)
router = APIRouter(tags=["trends"])


# ── Response schemas ──────────────────────────────────────────────────────────

class VideoMeta(BaseModel):
    platform: str
    video_id: str
    title: str
    url: str
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    duration_sec: int | None = None
    published_at: str | None = None
    channel: str | None = None
    hashtags: list[str] = []
    thumbnail: str | None = None
    description: str = ""


class PlatformSummary(BaseModel):
    youtube_count: int
    tiktok_count: int
    web_count: int
    total: int
    from_cache: bool


class TrendAnalysis(BaseModel):
    insights: str
    suggested_topics: list[str]


class TrendSearchResponse(BaseModel):
    topic: str
    from_cache: bool
    summary: PlatformSummary
    top_by_views: list[VideoMeta]
    common_hashtags: list[str]
    youtube: list[VideoMeta]
    tiktok: list[VideoMeta]
    web: list[VideoMeta]
    analysis: TrendAnalysis | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/trends/search", response_model=TrendSearchResponse)
async def search_trends(
    topic: Annotated[str, Query(min_length=1, max_length=200)],
    platforms: Annotated[list[str], Query()] = ["youtube", "tiktok", "web"],
    force_refresh: bool = False,
    _token: TokenPayload = Depends(get_current_user),
):
    """Search viral trending videos across platforms. Results cached for TTL hours."""
    # Validate platforms
    valid = {"youtube", "tiktok", "web"}
    platforms = [p for p in platforms if p in valid] or ["youtube", "tiktok", "web"]

    from agent.graph.nodes.viral_search import search_viral_trends
    result = search_viral_trends(topic, platforms=platforms, force_refresh=force_refresh)

    return TrendSearchResponse(
        topic=result.topic,
        from_cache=result.from_cache,
        summary=PlatformSummary(**result.platform_summary()),
        top_by_views=[VideoMeta(**v) for v in result.top_by_views(10)],
        common_hashtags=result.common_hashtags(20),
        youtube=[VideoMeta(**v) for v in result.youtube],
        tiktok=[VideoMeta(**v) for v in result.tiktok],
        web=[VideoMeta(**v) for v in result.web],
        analysis=TrendAnalysis(**result.analysis) if result.analysis else None,
    )


@router.delete("/trends/cache")
async def clear_cache(
    topic: str | None = None,
    _token: TokenPayload = Depends(get_current_user),
):
    """Clear trend cache. topic=None clears all."""
    import re
    from pathlib import Path
    from agent.graph.nodes.viral_search import CACHE_DIR
    deleted = 0
    if topic:
        slug = re.sub(r"[^\w]+", "_", topic.lower().strip())[:50]
        for p in CACHE_DIR.glob(f"{slug}__*.md"):
            p.unlink()
            deleted += 1
    else:
        for p in CACHE_DIR.glob("*.md"):
            p.unlink()
            deleted += 1
    return {"deleted": deleted}
