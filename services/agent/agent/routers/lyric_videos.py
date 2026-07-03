from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from agent.lyric_video import plan_lyric_video

router = APIRouter(tags=["lyric-videos"])


class LyricVideoSource(BaseModel):
    type: Literal["upload", "youtube", "spotify", "metadata"] = "metadata"
    title: str | None = None
    artist: str | None = None
    url: str | None = None


class LyricVideoPlanRequest(BaseModel):
    source: LyricVideoSource = Field(default_factory=LyricVideoSource)
    rights_confirmed: bool = False
    transcript_text: str | None = None
    aspect_ratio: Literal["9:16", "16:9", "1:1", "4:5"] | None = None
    template_hint: str | None = None


class LyricVideoPlanResponse(BaseModel):
    source: dict[str, Any]
    rights: dict[str, Any]
    lyrics: list[dict[str, Any]]
    template: dict[str, Any]
    warnings: list[str]
    needs_transcription: bool


@router.post("/lyric-videos/plan", response_model=LyricVideoPlanResponse)
async def create_lyric_video_plan(body: LyricVideoPlanRequest):
    return plan_lyric_video(
        source=body.source.model_dump(),
        rights_confirmed=body.rights_confirmed,
        transcript_text=body.transcript_text,
        aspect_ratio=body.aspect_ratio,
        template_hint=body.template_hint,
    )
