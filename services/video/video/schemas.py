import uuid
from typing import Any, Literal
from pydantic import BaseModel, Field


class ClipConfig(BaseModel):
    # Clip boundaries
    duration_min: int = Field(default=15, ge=5, le=300, description="Min clip length in seconds")
    duration_max: int = Field(default=60, ge=10, le=600, description="Max clip length in seconds")
    max_clips: int = Field(default=5, ge=1, le=30, description="Max number of clips to generate")

    # Output format
    aspect_ratio: Literal["9:16", "1:1", "16:9", "4:5"] = Field(default="9:16", description="Output aspect ratio")
    platforms: list[Literal["tiktok", "reels", "shorts", "twitter", "linkedin"]] = Field(
        default=["tiktok", "reels", "shorts"], description="Target platforms for clip labelling"
    )

    # AI scoring
    min_score: float = Field(default=0.5, ge=0.0, le=1.0, description="Min virality score 0-1 (0.5 = balanced, 0.8 = viral only)")

    # Captions
    add_captions: bool = Field(default=True, description="Burn captions into clip")
    caption_style: Literal["capcut", "capcut-bold", "classic", "minimal"] = Field(
        default="capcut", description="Caption visual style"
    )

    # Output quality
    output_quality: Literal["source", "1080p", "720p", "480p"] = Field(
        default="1080p", description="Output resolution cap (source = no downscale)"
    )

    # Content
    language: str = Field(default="en", description="Spoken language (en, es, fr, ...)")
    topic_focus: str | None = Field(default=None, description="Guide AI to focus on specific topic")

    # Precision mode
    precision_mode: bool = False


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
    celery_task_id: str | None = None
    error_message: str | None = None
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
    clip_metadata: dict | None = None
    upload_attempts: int | None = None
    upload_error: str | None = None
    created_at: Any
    model_config = {"from_attributes": True}


class ClipPatchRequest(BaseModel):
    tags: list[str] | None = None
    platform_copy: dict[str, dict] | None = None


class VideoListResponse(BaseModel):
    items: list[VideoResponse]
    total: int
    page: int
    per_page: int


class ClipListResponse(BaseModel):
    items: list[ClipResponse]
    total: int
    page: int
    per_page: int


class YouTubeImportRequest(BaseModel):
    url: str
    title: str | None = None
    config: ClipConfig = Field(default_factory=ClipConfig)


class GenerateClipsRequest(BaseModel):
    config: ClipConfig = Field(default_factory=ClipConfig)


class VideoUpdateRequest(BaseModel):
    title: str | None = None
    topic: str | None = None


class ClipConcatRequest(BaseModel):
    video_id: uuid.UUID
    clip_ids: list[uuid.UUID] | None = None


class ClipMergeAiRequest(BaseModel):
    clip_ids: list[uuid.UUID]  # 2–10 clips to consider for merging


class YouTubeInspectRequest(BaseModel):
    url: str


class YouTubeInspectResponse(BaseModel):
    valid: bool
    url: str
    video_id: str | None = None
    title: str | None = None
    channel: str | None = None
    duration_sec: int | None = None
    thumbnail_url: str | None = None
    view_count: int | None = None
    upload_date: str | None = None
    description: str | None = None
    error: str | None = None
