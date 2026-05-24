import uuid
from typing import Any, Literal
from pydantic import BaseModel, Field


class ClipConfig(BaseModel):
    duration_min: int = Field(default=15, ge=5, le=300, description="Min clip length in seconds")
    duration_max: int = Field(default=60, ge=10, le=600, description="Max clip length in seconds")
    aspect_ratio: Literal["9:16", "1:1", "16:9", "4:5"] = "9:16"
    platforms: list[Literal["tiktok", "reels", "shorts", "twitter", "linkedin"]] = ["tiktok", "reels", "shorts"]
    max_clips: int = Field(default=10, ge=1, le=30)
    min_score: float = Field(default=0.5, ge=0.0, le=1.0, description="AI virality score threshold")
    language: str = Field(default="en", description="Transcript language hint")
    add_captions: bool = True
    topic_focus: str | None = Field(default=None, description="Optional topic to focus clips on")


class VideoResponse(BaseModel):
    id: uuid.UUID
    title: str | None
    source_type: str
    status: str
    pipeline_step: str | None
    pipeline_pct: int
    storage_url: str | None
    thumbnail_url: str | None
    duration_sec: int | None
    clip_config: dict | None = None
    created_at: Any
    model_config = {"from_attributes": True}


class ClipResponse(BaseModel):
    id: uuid.UUID
    video_id: uuid.UUID
    title: str | None
    start_ms: int | None
    end_ms: int | None
    duration_ms: int | None
    platform: str | None
    score: float | None
    status: str
    storage_url: str | None
    thumbnail_url: str | None
    caption_srt: str | None
    created_at: Any
    model_config = {"from_attributes": True}


class VideoListResponse(BaseModel):
    items: list[VideoResponse]
    total: int
    page: int
    per_page: int


class YouTubeImportRequest(BaseModel):
    url: str
    title: str | None = None
    config: ClipConfig = Field(default_factory=ClipConfig)


class VideoUpdateRequest(BaseModel):
    title: str | None = None
    topic: str | None = None
