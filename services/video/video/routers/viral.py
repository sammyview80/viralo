"""Viral score analysis endpoint — analyze a YouTube video for virality potential."""
import asyncio
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from shared.deps import get_current_user
from shared.llm import call_llm_json
from shared.schemas.auth import TokenPayload

router = APIRouter(tags=["viral"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ViralAnalyzeRequest(BaseModel):
    url: str = Field(description="YouTube video URL")


class HookStrength(BaseModel):
    score: int = Field(description="0-10")
    type: str | None = Field(description="shock_stat / question / conflict / story / none")
    opening_text: str | None = Field(description="First ~15 words of the video")


class RetentionSignals(BaseModel):
    score: int = Field(description="0-10")
    pacing: str | None = Field(description="slow / medium / fast")
    estimated_drop_point_sec: int | None
    has_cliffhanger: bool


class PlatformFit(BaseModel):
    youtube_shorts: int = Field(description="0-100")
    tiktok: int = Field(description="0-100")
    instagram_reels: int = Field(description="0-100")
    linkedin: int = Field(description="0-100")
    recommended: list[str]


class ClipMoment(BaseModel):
    start_sec: int
    end_sec: int
    reason: str
    clip_score: int = Field(description="0-100")


class ViralAnalyzeResponse(BaseModel):
    viral_score: int = Field(description="Composite virality score 0-100")
    verdict: str = Field(description="One-line human summary")
    hook_strength: HookStrength
    retention: RetentionSignals
    emotional_triggers: list[str] = Field(description="Detected emotions: curiosity/fear/joy/anger/inspiration/humor")
    dominant_emotion: str | None
    content_format: str | None = Field(description="e.g. Problem→Solution, Countdown, Story Arc")
    title_score: int = Field(description="Title curiosity/click potential 0-10")
    shareability_score: int = Field(description="0-10")
    has_cta: bool
    topic: str | None
    niche: str | None
    platform_fit: PlatformFit
    clip_moments: list[ClipMoment]
    improvements: list[str] = Field(description="Ranked actionable suggestions")
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers (reuse yt-dlp pattern from videos.py)
# ---------------------------------------------------------------------------

_YT_RE = re.compile(
    r"(?:https?://)?(?:www\.|m\.)?(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def _ytdlp_fetch(url: str) -> dict:
    import os
    cookies_file = os.getenv("YTDLP_COOKIES_FILE", "")
    proxy = os.getenv("YTDLP_PROXY", "")

    base = ["yt-dlp", "--no-download", "--dump-json", "--no-playlist", "--no-check-certificate"]
    if not proxy and cookies_file and Path(cookies_file).exists():
        base += ["--cookies", cookies_file]
    if proxy:
        base += ["--proxy", proxy]

    for extra in [
        ["--extractor-args", "youtube:player_client=android"],
        ["--extractor-args", "youtube:player_client=tv_embedded"],
        [],
    ]:
        try:
            r = subprocess.run(base + extra + [url], capture_output=True, text=True, timeout=30)
            if r.returncode == 0 and r.stdout.strip():
                return json.loads(r.stdout.strip().splitlines()[0])
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            continue
    return {}


def _oembed_fetch(video_id: str, url: str) -> dict:
    import urllib.request as _req, urllib.parse as _uparse
    result: dict = {}
    try:
        oe_url = f"https://www.youtube.com/oembed?url={_uparse.quote(url, safe='')}&format=json"
        with _req.urlopen(oe_url, timeout=8) as r:
            d = json.loads(r.read())
        result["title"] = d.get("title") or ""
        result["channel"] = d.get("author_name") or ""
        result["thumbnail_url"] = d.get("thumbnail_url") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    except Exception:
        result["thumbnail_url"] = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    return result


_ANALYSIS_PROMPT = """
You are a viral content analyst. Analyze the YouTube video metadata below and return a JSON object scoring its viral potential.

Video metadata:
Title: {title}
Channel: {channel}
Duration (seconds): {duration}
Views: {views}
Upload date: {upload_date}
Description (first 400 chars): {description}
Tags: {tags}
Like count: {likes}
Comment count: {comments}

Return ONLY valid JSON with this exact structure:
{{
  "viral_score": <int 0-100>,
  "verdict": "<one-line human summary>",
  "hook_strength": {{
    "score": <int 0-10>,
    "type": "<shock_stat|question|conflict|story|none>",
    "opening_text": "<first ~15 words inferred from title/description or null>"
  }},
  "retention": {{
    "score": <int 0-10>,
    "pacing": "<slow|medium|fast>",
    "estimated_drop_point_sec": <int or null>,
    "has_cliffhanger": <bool>
  }},
  "emotional_triggers": ["<emotion>", ...],
  "dominant_emotion": "<emotion or null>",
  "content_format": "<format label or null>",
  "title_score": <int 0-10>,
  "shareability_score": <int 0-10>,
  "has_cta": <bool>,
  "topic": "<main topic or null>",
  "niche": "<niche category or null>",
  "platform_fit": {{
    "youtube_shorts": <int 0-100>,
    "tiktok": <int 0-100>,
    "instagram_reels": <int 0-100>,
    "linkedin": <int 0-100>,
    "recommended": ["<platform>", ...]
  }},
  "clip_moments": [
    {{"start_sec": <int>, "end_sec": <int>, "reason": "<why this moment is viral>", "clip_score": <int 0-100>}}
  ],
  "improvements": ["<specific actionable suggestion>", ...]
}}

Rules:
- clip_moments: identify 2-4 best moments based on description/structure (if duration unknown default to 3 spread moments)
- improvements: max 5, ranked most impactful first, be specific (e.g. "Hook too slow — add pattern interrupt at 0:04")
- viral_score: weight hook (25%), retention (20%), emotional triggers (20%), platform fit (15%), title (10%), shareability (10%)
- Be ruthlessly honest, not optimistic
""".strip()


async def _analyze(meta: dict) -> dict:
    title = meta.get("title") or ""
    channel = meta.get("uploader") or meta.get("channel") or meta.get("channel_name") or ""
    duration = meta.get("duration")
    views = meta.get("view_count")
    upload_date = meta.get("upload_date") or ""
    description = (meta.get("description") or "")[:400]
    tags = ", ".join(meta.get("tags") or [])[:200]
    likes = meta.get("like_count")
    comments = meta.get("comment_count")

    prompt = _ANALYSIS_PROMPT.format(
        title=title,
        channel=channel,
        duration=duration or "unknown",
        views=views or "unknown",
        upload_date=upload_date,
        description=description or "none",
        tags=tags or "none",
        likes=likes or "unknown",
        comments=comments or "unknown",
    )

    messages = [
        {"role": "system", "content": "You are a viral content analyst. Return only valid JSON."},
        {"role": "user", "content": prompt},
    ]

    return await asyncio.get_event_loop().run_in_executor(
        None, lambda: call_llm_json(messages, max_tokens=1200, prefer_large=True)
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/video/analyze-viral", response_model=ViralAnalyzeResponse)
async def analyze_viral(
    body: ViralAnalyzeRequest,
    token: TokenPayload = Depends(get_current_user),
):
    url = body.url.strip()
    match = _YT_RE.search(url)
    if not match:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Not a valid YouTube video URL")

    video_id = match.group(1)

    # Fetch metadata — yt-dlp primary, oEmbed fallback
    meta: dict = {}
    try:
        meta = await asyncio.get_event_loop().run_in_executor(None, lambda: _ytdlp_fetch(url))
    except Exception:
        pass

    if not meta.get("title"):
        oembed = await asyncio.get_event_loop().run_in_executor(None, lambda: _oembed_fetch(video_id, url))
        meta.setdefault("title", oembed.get("title") or "")
        meta.setdefault("channel", oembed.get("channel") or "")
        meta.setdefault("thumbnail_url", oembed.get("thumbnail_url") or "")

    if not meta.get("title"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Could not fetch video metadata")

    # LLM analysis
    try:
        analysis = await _analyze(meta)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"LLM analysis failed: {e}")

    # Build response — coerce/validate fields with safe fallbacks
    def _int(v, default=0):
        try: return int(v)
        except: return default

    def _bool(v):
        if isinstance(v, bool): return v
        return str(v).lower() in ("true", "1", "yes")

    hook = analysis.get("hook_strength") or {}
    retention = analysis.get("retention") or {}
    pf = analysis.get("platform_fit") or {}
    raw_moments = analysis.get("clip_moments") or []

    clip_moments = [
        ClipMoment(
            start_sec=_int(m.get("start_sec")),
            end_sec=_int(m.get("end_sec")),
            reason=str(m.get("reason") or ""),
            clip_score=_int(m.get("clip_score"), 50),
        )
        for m in raw_moments if isinstance(m, dict)
    ]

    return ViralAnalyzeResponse(
        viral_score=min(100, max(0, _int(analysis.get("viral_score"), 50))),
        verdict=str(analysis.get("verdict") or ""),
        hook_strength=HookStrength(
            score=min(10, max(0, _int(hook.get("score"), 5))),
            type=hook.get("type") or None,
            opening_text=hook.get("opening_text") or None,
        ),
        retention=RetentionSignals(
            score=min(10, max(0, _int(retention.get("score"), 5))),
            pacing=retention.get("pacing") or None,
            estimated_drop_point_sec=_int(retention.get("estimated_drop_point_sec")) or None,
            has_cliffhanger=_bool(retention.get("has_cliffhanger", False)),
        ),
        emotional_triggers=[str(e) for e in (analysis.get("emotional_triggers") or [])],
        dominant_emotion=analysis.get("dominant_emotion") or None,
        content_format=analysis.get("content_format") or None,
        title_score=min(10, max(0, _int(analysis.get("title_score"), 5))),
        shareability_score=min(10, max(0, _int(analysis.get("shareability_score"), 5))),
        has_cta=_bool(analysis.get("has_cta", False)),
        topic=analysis.get("topic") or None,
        niche=analysis.get("niche") or None,
        platform_fit=PlatformFit(
            youtube_shorts=min(100, max(0, _int(pf.get("youtube_shorts"), 50))),
            tiktok=min(100, max(0, _int(pf.get("tiktok"), 50))),
            instagram_reels=min(100, max(0, _int(pf.get("instagram_reels"), 50))),
            linkedin=min(100, max(0, _int(pf.get("linkedin"), 50))),
            recommended=[str(p) for p in (pf.get("recommended") or [])],
        ),
        clip_moments=clip_moments,
        improvements=[str(i) for i in (analysis.get("improvements") or [])],
        metadata={
            "video_id": video_id,
            "title": meta.get("title") or "",
            "channel": meta.get("uploader") or meta.get("channel") or "",
            "duration_sec": meta.get("duration"),
            "view_count": meta.get("view_count"),
            "like_count": meta.get("like_count"),
            "upload_date": meta.get("upload_date") or "",
            "thumbnail_url": meta.get("thumbnail_url") or meta.get("thumbnail") or "",
        },
    )
