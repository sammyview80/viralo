"""Platform fetchers for viral_search — YouTube, TikTok, Tavily."""
from __future__ import annotations

import logging
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)

YT_API_KEY = os.getenv("YOUTUBE_API_KEY", "")
TAVILY_KEY = os.getenv("TAVILY_API_KEY", "")
YT_MAX_RESULTS = int(os.getenv("YT_TREND_MAX_RESULTS", "10"))
TIKTOK_MAX_RESULTS = int(os.getenv("TIKTOK_TREND_MAX_RESULTS", "8"))


def _video_meta(
    platform: str, video_id: str, title: str, url: str,
    views: int | None = None, likes: int | None = None,
    comments: int | None = None, duration_sec: int | None = None,
    published_at: str | None = None, channel: str | None = None,
    hashtags: list[str] | None = None, thumbnail: str | None = None,
    description: str | None = None,
) -> dict:
    return {
        "platform": platform, "video_id": video_id, "title": title, "url": url,
        "views": views, "likes": likes, "comments": comments,
        "duration_sec": duration_sec, "published_at": published_at,
        "channel": channel, "hashtags": hashtags or [],
        "thumbnail": thumbnail, "description": (description or "")[:500],
    }


# ── YouTube ───────────────────────────────────────────────────────────────────

def youtube_search(topic: str) -> list[dict]:
    if not YT_API_KEY:
        return []
    try:
        import googleapiclient.discovery
        yt = googleapiclient.discovery.build("youtube", "v3", developerKey=YT_API_KEY)
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        search_resp = yt.search().list(
            part="id,snippet", q=topic, type="video", order="viewCount",
            publishedAfter=since, maxResults=YT_MAX_RESULTS,
            relevanceLanguage="en", videoDuration="medium",
        ).execute()
        video_ids = [i["id"]["videoId"] for i in search_resp.get("items", [])]
        if not video_ids:
            return []
        stats_resp = yt.videos().list(
            part="statistics,contentDetails,snippet", id=",".join(video_ids),
        ).execute()
        results = []
        for item in stats_resp.get("items", []):
            snip = item["snippet"]
            stats = item.get("statistics", {})
            cd = item.get("contentDetails", {})
            vid_id = item["id"]
            results.append(_video_meta(
                platform="youtube", video_id=vid_id,
                title=snip.get("title", ""),
                url=f"https://www.youtube.com/watch?v={vid_id}",
                views=int(stats.get("viewCount", 0) or 0),
                likes=int(stats.get("likeCount", 0) or 0),
                comments=int(stats.get("commentCount", 0) or 0),
                duration_sec=_iso8601_duration_to_sec(cd.get("duration", "")),
                published_at=snip.get("publishedAt"),
                channel=snip.get("channelTitle"),
                hashtags=(snip.get("tags") or [])[:10],
                thumbnail=(snip.get("thumbnails", {}).get("high", {}) or {}).get("url"),
                description=snip.get("description", ""),
            ))
        results.sort(key=lambda x: x["views"] or 0, reverse=True)
        return results
    except Exception as e:
        log.warning("YouTube search error: %s", e)
        return []


def youtube_trending_chart(region_code: str = "US", category_id: str = "28") -> list[dict]:
    if not YT_API_KEY:
        return []
    try:
        import googleapiclient.discovery
        yt = googleapiclient.discovery.build("youtube", "v3", developerKey=YT_API_KEY)
        resp = yt.videos().list(
            part="id,snippet,statistics,contentDetails",
            chart="mostPopular", regionCode=region_code,
            videoCategoryId=category_id, maxResults=YT_MAX_RESULTS,
        ).execute()
        results = []
        for item in resp.get("items", []):
            snip = item["snippet"]
            stats = item.get("statistics", {})
            vid_id = item["id"]
            results.append(_video_meta(
                platform="youtube", video_id=vid_id,
                title=snip.get("title", ""),
                url=f"https://www.youtube.com/watch?v={vid_id}",
                views=int(stats.get("viewCount", 0) or 0),
                likes=int(stats.get("likeCount", 0) or 0),
                comments=int(stats.get("commentCount", 0) or 0),
                duration_sec=_iso8601_duration_to_sec(
                    item.get("contentDetails", {}).get("duration", "")),
                published_at=snip.get("publishedAt"),
                channel=snip.get("channelTitle"),
                hashtags=(snip.get("tags") or [])[:10],
                thumbnail=(snip.get("thumbnails", {}).get("high", {}) or {}).get("url"),
                description=snip.get("description", ""),
            ))
        return results
    except Exception as e:
        log.warning("YouTube trending chart error: %s", e)
        return []


# ── TikTok ────────────────────────────────────────────────────────────────────

def tiktok_trending(topic: str) -> list[dict]:
    try:
        import yt_dlp  # noqa
    except ImportError:
        log.info("yt-dlp not installed — skipping TikTok")
        return []

    tag = re.sub(r"\s+", "", topic.lower())
    url = f"https://www.tiktok.com/tag/{tag}"
    ydl_opts = {
        "quiet": True, "no_warnings": True, "extract_flat": "in_playlist",
        "playlistend": TIKTOK_MAX_RESULTS, "skip_download": True,
        "ignoreerrors": True,
        "cookiefile": os.getenv("TIKTOK_COOKIES_FILE", "") or None,
    }
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        entries = (info or {}).get("entries") or []
        results = [_entry_to_meta(e, "tiktok") for e in entries if e]
        return [r for r in results if r]
    except Exception as e:
        log.warning("TikTok hashtag error (%s): %s", topic, e)
        return tiktok_search(topic)


def tiktok_search(topic: str) -> list[dict]:
    try:
        import yt_dlp
        search_url = f"tiktoksearch{TIKTOK_MAX_RESULTS}:{topic} viral"
        ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": True,
                    "skip_download": True, "ignoreerrors": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_url, download=False)
        entries = (info or {}).get("entries") or []
        return [r for r in [_entry_to_meta(e, "tiktok") for e in entries if e] if r]
    except Exception as e:
        log.warning("TikTok search fallback error: %s", e)
        return []


def _entry_to_meta(e: dict, platform: str) -> dict | None:
    url = e.get("url") or e.get("webpage_url", "")
    if not url:
        return None
    return _video_meta(
        platform=platform, video_id=e.get("id", ""),
        title=(e.get("title") or e.get("description") or "")[:200], url=url,
        views=e.get("view_count"), likes=e.get("like_count"),
        comments=e.get("comment_count"),
        duration_sec=int(e.get("duration") or 0) or None,
        published_at=_tiktok_ts(e.get("timestamp")),
        channel=e.get("uploader") or e.get("creator"),
        hashtags=_extract_hashtags(e.get("description", "")),
        thumbnail=e.get("thumbnail"), description=e.get("description", ""),
    )


# ── Tavily web search fallback ────────────────────────────────────────────────

def tavily_search(topic: str, hint_platform: str = "web") -> list[dict]:
    if not TAVILY_KEY:
        return []
    try:
        from langchain_community.tools.tavily_search import TavilySearchResults
        tool = TavilySearchResults(max_results=8, api_key=TAVILY_KEY)
        query = f"trending {hint_platform} videos {topic} viral 2025"
        raw = tool.invoke({"query": query}) or []
        results = []
        for i, item in enumerate(raw):
            url = item.get("url", "")
            detected = _detect_platform(url)
            results.append(_video_meta(
                platform=detected, video_id=_extract_video_id(url, detected) or f"tv_{i}",
                title=item.get("title", f"result {i+1}"), url=url,
                hashtags=_extract_hashtags(item.get("content", "")),
                description=item.get("content", ""),
            ))
        return results
    except Exception as e:
        log.warning("Tavily error: %s", e)
        return []


# ── Helpers ───────────────────────────────────────────────────────────────────

def _iso8601_duration_to_sec(duration: str) -> int | None:
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration or "")
    if not m:
        return None
    h, mn, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mn * 60 + s


def _tiktok_ts(ts: Any) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _extract_hashtags(text: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"#(\w+)", text or "")))[:15]


def _detect_platform(url: str) -> str:
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    if "tiktok.com" in url:
        return "tiktok"
    if "instagram.com" in url:
        return "instagram"
    return "web"


def _extract_video_id(url: str, platform: str) -> str | None:
    if platform == "youtube":
        m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
        return m.group(1) if m else None
    if platform == "tiktok":
        m = re.search(r"/video/(\d+)", url)
        return m.group(1) if m else None
    return None
