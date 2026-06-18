import asyncio
import json
import os
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from shared.deps import get_current_user
from shared.schemas.auth import TokenPayload
from agent.llm import get_llm
from agent.graph.nodes._base import get_search_tool, parse_json_block

router = APIRouter(tags=["tags"])

PLATFORMS = ["reels", "shorts", "tiktok", "twitter", "youtube", "linkedin"]

_RESEARCH_QUERIES = [
    "trending viral hashtags {niche} TikTok 2025",
    "most viral {topic} Instagram Reels hashtags",
    "top YouTube Shorts hashtags {niche} viral",
]

_SYNTH_PROMPT = """You are a viral social media strategist. You have just researched trending hashtags.

Topic: {topic}
Niche/Genre: {niche}

Research findings:
{research}

Using ONLY tags confirmed by the research above (not generic guesses), create viral-optimised copy for each platform.

Return ONLY valid JSON:
{{
  "primary_hashtags": ["#Tag1", "#Tag2", ...],
  "platforms": {{
    "reels": {{"description": "<hook-driven caption, max 150 chars>", "tags": ["#tag1", ...]}},
    "shorts": {{"description": "<punchy caption, max 120 chars>", "tags": ["#tag1", ...]}},
    "tiktok": {{"description": "<casual hook caption, max 150 chars>", "tags": ["#tag1", ...]}},
    "twitter": {{"description": "<concise caption, max 240 chars>", "tags": ["#tag1", "#tag2"]}},
    "youtube": {{"description": "<keyword-rich description, max 200 chars>", "tags": ["#tag1", ...]}},
    "linkedin": {{"description": "<professional insight caption, max 200 chars>", "tags": ["#tag1", ...]}}
  }}
}}

Rules:
- primary_hashtags: 5-8 highest-traffic tags from research, include # prefix
- Reels/TikTok/Shorts: max 7 tags, hook in first 3 words of description
- YouTube: max 12 tags, keyword-rich
- Twitter: max 3 tags
- LinkedIn: max 5 tags, professional tone
- Descriptions must start with a scroll-stopping hook
- Return ONLY the JSON object"""


class TagSuggestRequest(BaseModel):
    topic: str
    niche: str | None = None
    extra_context: str | None = None


class PlatformCopy(BaseModel):
    description: str
    tags: list[str]


class TagSuggestResponse(BaseModel):
    primary_hashtags: list[str]
    platforms: dict[str, PlatformCopy]
    research_used: bool = False


async def _run_search(search_tool, query: str) -> str:
    """Run a single Tavily search, return text snippet."""
    try:
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, lambda: search_tool.invoke(query))
        if isinstance(results, list):
            return "\n".join(
                f"- {r.get('title', '')}: {r.get('content', '')[:300]}"
                for r in results[:4]
            )
        return str(results)[:800]
    except Exception:
        return ""


@router.post("/tags/suggest", response_model=TagSuggestResponse)
async def suggest_tags(
    body: TagSuggestRequest,
    token: TokenPayload = Depends(get_current_user),
):
    llm = get_llm()
    search = get_search_tool()

    niche = body.niche or body.topic
    topic = body.topic

    # ── Step 1: Web research (parallel queries) ───────────────────────────────
    research_text = ""
    research_used = False
    if search:
        queries = [
            q.format(topic=topic, niche=niche)
            for q in _RESEARCH_QUERIES
        ]
        results = await asyncio.gather(*[_run_search(search, q) for q in queries])
        snippets = [r for r in results if r.strip()]
        if snippets:
            research_text = "\n\n".join(
                f"Query: {queries[i]}\nResults:\n{snippets[i]}"
                for i, s in enumerate(snippets)
                if s.strip()
            )
            research_used = True

    if not research_text:
        # Fallback: ask LLM to reason from training data
        research_text = (
            f"No live search available. Use known viral hashtag patterns for '{niche}' content "
            f"on TikTok, Reels, and YouTube Shorts as of 2025."
        )

    # ── Step 2: Synthesize with research context ──────────────────────────────
    extra = f" Context: {body.extra_context}" if body.extra_context else ""
    prompt_text = _SYNTH_PROMPT.format(
        topic=topic + extra,
        niche=niche,
        research=research_text[:4000],
    )

    full_text = ""
    try:
        from langchain_core.messages import HumanMessage
        async for chunk in llm.astream([HumanMessage(content=prompt_text)]):
            content = getattr(chunk, "content", "") or ""
            if content:
                full_text += content
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM error: {str(e)}",
        )

    data = parse_json_block(full_text)
    if not data or "primary_hashtags" not in data or "platforms" not in data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Failed to parse tag suggestions from LLM response",
        )

    platforms_out: dict[str, Any] = {}
    for p in PLATFORMS:
        pdata = data["platforms"].get(p, {})
        platforms_out[p] = PlatformCopy(
            description=pdata.get("description", ""),
            tags=pdata.get("tags", []),
        )

    return TagSuggestResponse(
        primary_hashtags=data["primary_hashtags"],
        platforms=platforms_out,
        research_used=research_used,
    )
