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

SYSTEM_PROMPT = """You are a social media hashtag and content strategist.
Given a video topic/niche, search for currently trending and viral hashtags.
Return a JSON object with this exact structure:
{{
  "primary_hashtags": ["#Tag1", "#Tag2", ...],
  "platforms": {{
    "reels": {{"description": "...", "tags": ["#tag1", ...]}},
    "shorts": {{"description": "...", "tags": ["#tag1", ...]}},
    "tiktok": {{"description": "...", "tags": ["#tag1", ...]}},
    "twitter": {{"description": "...", "tags": ["#tag1", ...]}},
    "youtube": {{"description": "...", "tags": ["#tag1", ...]}},
    "linkedin": {{"description": "...", "tags": ["#tag1", ...]}}
  }}
}}

Rules:
- primary_hashtags: broad, high-traffic tags trending NOW, include # prefix
- Each platform description: 1-2 sentences optimized for that platform's tone/algorithm
- Reels/TikTok: casual, hook-driven, 7 tags max
- YouTube: descriptive, keyword-rich, 12 tags max
- Twitter/X: concise, 2-3 tags max
- LinkedIn: professional, 4-5 tags max
- Shorts: punchy, 7 tags max
- Use Tavily search to find what's actually trending, not generic guesses
- Return ONLY the JSON object, no other text"""


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


@router.post("/tags/suggest", response_model=TagSuggestResponse)
async def suggest_tags(
    body: TagSuggestRequest,
    token: TokenPayload = Depends(get_current_user),
):
    llm = get_llm()
    search = get_search_tool()

    topic_str = body.topic
    if body.niche:
        topic_str = f"{body.topic} (niche: {body.niche})"
    if body.extra_context:
        topic_str += f". Extra context: {body.extra_context}"

    from langchain_core.prompts import ChatPromptTemplate
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "Find trending hashtags and write platform copy for this video topic: {topic}"),
    ])

    chain = prompt | llm.bind_tools([search]) if search else prompt | llm

    full_text = ""
    try:
        async for chunk in chain.astream({"topic": topic_str}):
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

    # Normalize: ensure all platforms present
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
    )
