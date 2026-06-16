"""
Viral Trend Search Agent — multi-source trending video discovery.

Source priority:
  1. MD cache  — fresh cache returns instantly, zero API calls
  2. YouTube Data API v3 search  →  trending chart fallback  →  Tavily fallback
  3. TikTok yt-dlp hashtag page  →  yt-dlp search fallback  →  Tavily fallback
  4. Tavily web search (deduped vs above)

Cache: Markdown file with embedded JSON. TTL via TREND_CACHE_TTL_HOURS (default 6h).
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent.graph.nodes._viral_search_sources import (
    tavily_search,
    tiktok_trending,
    youtube_search,
    youtube_trending_chart,
)
from shared.llm import call_llm_json

log = logging.getLogger(__name__)

CACHE_DIR = Path(os.getenv("TREND_CACHE_DIR", "/tmp/viralo-trend-cache"))
CACHE_TTL_HOURS = int(os.getenv("TREND_CACHE_TTL_HOURS", "6"))


# ── LLM Analysis ──────────────────────────────────────────────────────────────

def _analyze_trends_with_llm(topic: str, videos: list[dict]) -> dict:
    if not videos:
        return {"insights": "No trending videos found to analyze.", "suggested_topics": []}

    # Take top 15 videos for analysis
    sample = sorted(
        [v for v in videos if v.get("views")],
        key=lambda x: x["views"], reverse=True
    )[:15]
    if not sample:
        sample = videos[:10]

    v_data = []
    for v in sample:
        v_data.append({
            "title": v.get("title"),
            "views": v.get("views"),
            "description": (v.get("description") or "")[:200],
            "hashtags": v.get("hashtags", [])[:5]
        })

    prompt = f"""
Analyze these trending videos for the topic '{topic}' and provide a viral content analysis.

Videos:
{json.dumps(v_data, indent=2, ensure_ascii=False)}

Return ONLY a JSON object with:
- "insights": A 2-sentence punchy summary of why this topic is currently trending and what formats are working.
- "suggested_topics": A list of 3-5 specific, related search queries for finding more trending content in this niche.
"""
    try:
        messages = [{"role": "user", "content": prompt}]
        res = call_llm_json(messages, temperature=0.7, max_tokens=500)
        return {
            "insights": res.get("insights") or "",
            "suggested_topics": res.get("suggested_topics") or []
        }
    except Exception as e:
        log.warning("Trend analysis LLM failed: %s", e)
        return {"insights": "Trend analysis temporarily unavailable.", "suggested_topics": []}


# ── Cache ─────────────────────────────────────────────────────────────────────

def _cache_key(topic: str, platforms: list[str]) -> str:
    slug = re.sub(r"[^\w]+", "_", topic.lower().strip())[:50]
    return f"{slug}__{'_'.join(sorted(platforms))}"


def _cache_path(key: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{key}.md"


def _cache_read(key: str) -> dict | None:
    p = _cache_path(key)
    if not p.exists():
        return None
    try:
        raw = p.read_text()
        m = re.search(r"```json\s*([\s\S]+?)\s*```", raw)
        if not m:
            return None
        data = json.loads(m.group(1))
        cached_at = datetime.fromisoformat(data.get("cached_at", "2000-01-01T00:00:00+00:00"))
        age_h = (datetime.now(timezone.utc) - cached_at).total_seconds() / 3600
        return data if age_h <= CACHE_TTL_HOURS else None
    except Exception as e:
        log.warning("cache read error %s: %s", key, e)
        return None


def _cache_write(key: str, topic: str, platforms: list[str],
                 yt: list[dict], tt: list[dict], web: list[dict],
                 analysis: dict | None = None) -> None:
    p = _cache_path(key)
    now = datetime.now(timezone.utc).isoformat()
    all_vids = yt + tt + web
    payload = {
        "topic": topic, "platforms": platforms, "cached_at": now,
        "ttl_hours": CACHE_TTL_HOURS, "count": len(all_vids),
        "videos_youtube": yt, "videos_tiktok": tt, "videos_web": web,
        "analysis": analysis,
    }
    lines = [
        f"# Trend Cache — {topic}",
        f"",
        f"> Generated: {now} | TTL: {CACHE_TTL_HOURS}h | Count: {len(all_vids)}",
        f"",
        "```json",
        json.dumps(payload, indent=2, ensure_ascii=False),
        "```",
        "",
        "## Videos",
    ]
    for v in sorted(all_vids, key=lambda x: x.get("views") or 0, reverse=True)[:20]:
        views_str = f"{v['views']:,}" if v.get("views") else "?"
        lines.append(f"- [{v['title'][:80]}]({v['url']}) — {views_str} views `{v['platform']}`")
    p.write_text("\n".join(lines))
    log.info("trend cache written: %s (%d videos)", p, len(all_vids))


# ── Result ────────────────────────────────────────────────────────────────────

class TrendSearchResult:
    def __init__(self, topic: str, youtube: list[dict], tiktok: list[dict],
                 web: list[dict], from_cache: bool, analysis: dict | None = None):
        self.topic = topic
        self.youtube = youtube
        self.tiktok = tiktok
        self.web = web
        self.from_cache = from_cache
        self.analysis = analysis
        self.all_videos: list[dict] = youtube + tiktok + web

    def top_by_views(self, n: int = 10) -> list[dict]:
        return sorted(
            [v for v in self.all_videos if v.get("views")],
            key=lambda x: x["views"], reverse=True,
        )[:n]

    def platform_summary(self) -> dict:
        return {
            "youtube_count": len(self.youtube),
            "tiktok_count": len(self.tiktok),
            "web_count": len(self.web),
            "total": len(self.all_videos),
            "from_cache": self.from_cache,
        }

    def common_hashtags(self, top_n: int = 20) -> list[str]:
        tags: list[str] = []
        for v in self.all_videos:
            tags.extend(v.get("hashtags") or [])
        return [tag for tag, _ in Counter(tags).most_common(top_n)]

    def to_dict(self) -> dict:
        return {
            "topic": self.topic,
            "youtube": self.youtube,
            "tiktok": self.tiktok,
            "web": self.web,
            "summary": self.platform_summary(),
            "top_by_views": self.top_by_views(5),
            "common_hashtags": self.common_hashtags(15),
            "analysis": self.analysis,
        }


# ── Main API ──────────────────────────────────────────────────────────────────

def search_viral_trends(
    topic: str,
    platforms: list[str] | None = None,
    force_refresh: bool = False,
) -> TrendSearchResult:
    """
    Search viral trending videos with cache-first strategy.

    Args:
        topic: e.g. "AI tools 2025"
        platforms: subset of ["youtube", "tiktok", "web"] — default all
        force_refresh: bypass cache
    """
    platforms = platforms or ["youtube", "tiktok", "web"]
    key = _cache_key(topic, platforms)

    if not force_refresh:
        cached = _cache_read(key)
        if cached:
            log.info("trend cache HIT: %s", key)
            return TrendSearchResult(
                topic=topic,
                youtube=cached.get("videos_youtube", []) if "youtube" in platforms else [],
                tiktok=cached.get("videos_tiktok", []) if "tiktok" in platforms else [],
                web=cached.get("videos_web", []) if "web" in platforms else [],
                from_cache=True,
                analysis=cached.get("analysis"),
            )

    log.info("trend cache MISS — fetching: %s", key)

    yt: list[dict] = []
    tt: list[dict] = []
    web: list[dict] = []

    if "youtube" in platforms:
        yt = youtube_search(topic)
        if not yt:
            yt = youtube_trending_chart()
        if not yt:
            yt = [v for v in tavily_search(topic, "youtube") if v["platform"] == "youtube"]

    if "tiktok" in platforms:
        tt = tiktok_trending(topic)
        if not tt:
            tt = [v for v in tavily_search(topic, "tiktok") if v["platform"] == "tiktok"]

    if "web" in platforms:
        seen_urls = {v["url"] for v in yt + tt}
        web = [v for v in tavily_search(topic, "web") if v["url"] not in seen_urls]

    analysis = _analyze_trends_with_llm(topic, yt + tt + web)
    _cache_write(key, topic, platforms, yt, tt, web, analysis=analysis)

    return TrendSearchResult(topic=topic, youtube=yt, tiktok=tt, web=web, from_cache=False, analysis=analysis)


# ── LangGraph node ────────────────────────────────────────────────────────────

async def viral_search_agent_fn(state: Any, config: Any) -> dict:
    """LangGraph node — drop-in replacement for trend_agent_fn."""
    from agent.graph.nodes._base import broadcast
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]

    await broadcast(redis, session_id, "viral_search_agent", "agent_message",
                    f"Searching viral trends for: {topic}...")

    result = search_viral_trends(topic)
    s = result.platform_summary()

    await broadcast(redis, session_id, "viral_search_agent", "agent_message",
                    f"Found {s['total']} videos (YT:{s['youtube_count']} "
                    f"TT:{s['tiktok_count']} Web:{s['web_count']}) — cache:{result.from_cache}")

    await broadcast(redis, session_id, "viral_search_agent", "agent_change",
                    "Viral trend search complete",
                    extra={"next": "competitor_agent", "progress": 20})

    return {"trend_data": {
        "topic": topic,
        "source": "viral_search_agent",
        "from_cache": result.from_cache,
        "top_videos": result.top_by_views(5),
        "common_hashtags": result.common_hashtags(15),
        "platform_breakdown": s,
        "youtube_trending": result.youtube[:5],
        "tiktok_trending": result.tiktok[:5],
        "analysis": result.analysis,
    }}
