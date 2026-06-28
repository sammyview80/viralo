from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ClipConfig(BaseModel):
    # Clip boundaries
    duration_min: int = Field(default=15, ge=5, le=300, description="Min clip length in seconds")
    duration_max: int = Field(default=60, ge=10, le=600, description="Max clip length in seconds")
    max_clips: int = Field(default=5, ge=1, le=30, description="Max number of clips to generate")

    # Output format
    aspect_ratio: Literal["9:16", "1:1", "16:9", "4:5"] = Field(default="9:16", description="Output aspect ratio")

    # AI scoring
    min_score: float = Field(default=0.5, ge=0.0, le=1.0, description="Min virality score 0-1 (0.5 = balanced, 0.8 = viral only)")

    # Captions
    add_captions: bool = Field(default=True, description="Burn captions into clip")
    caption_style: Literal["capcut", "capcut-bold", "classic", "minimal"] = Field(
        default="capcut", description="Caption visual style"
    )

    # Output quality
    output_quality: Literal["source", "1080p", "720p", "480p", "360p"] = Field(
        default="1080p", description="Output resolution cap (source = no downscale)"
    )

    topic_focus: str | None = Field(default=None, description="Guide AI to focus on specific topic")

    # Template / occasion-aware rendering
    template_id: Literal["sports-hype", "gaming-clutch", "cinematic", "music-vibe", "talking-head", "generic"] | None = Field(default=None, description="Template ID override (None = auto-detect from occasion)")
    music: bool = Field(default=True, description="Mix background music track into clip")
    music_track: Literal["hype", "dramatic", "chill"] | None = Field(default=None, description="Music track key override (None = auto from template)")
    voiceover: bool = Field(default=False, description="Generate and mix AI narrator voiceover")
    occasion: Literal["football", "soccer", "sports", "cricket", "ufc", "boxing", "mma", "f1", "racing", "gaming", "esports", "podcast", "interview", "concert", "music", "wedding", "travel", "general"] | None = Field(default=None, description="Content occasion hint. None = auto-detect.")

    @model_validator(mode="after")
    def _check_duration_bounds(self) -> "ClipConfig":
        # Frontend can send an inverted pair (e.g. slider race). Swap rather than
        # 422 so a transient UI glitch never blocks a clip job.
        if self.duration_min > self.duration_max:
            self.duration_min, self.duration_max = self.duration_max, self.duration_min
        return self


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

    @field_validator("clip_config", mode="before")
    @classmethod
    def hide_destination_config(cls, value: Any) -> Any:
        if isinstance(value, dict):
            hidden = {"platforms", "language", "precision_mode"}
            return {k: v for k, v in value.items() if k not in hidden}
        return value


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
    upscaled_storage_url: str | None = None
    created_at: Any
    model_config = {"from_attributes": True}


class ClipPatchRequest(BaseModel):
    tags: list[str] | None = None
    platform_copy: dict[str, dict] | None = None


class EditorCaption(BaseModel):
    id: str
    text: str
    start_sec: float = Field(ge=0)
    end_sec: float = Field(ge=0)
    position: Literal["top", "center", "bottom"] = "bottom"
    color: str = "#ffffff"
    font_size: int = Field(default=24, ge=12, le=48)
    template: Literal["default", "modern", "bouncy", "mr-beast", "business"] = "default"

    @field_validator("color")
    @classmethod
    def validate_hex_color(cls, v: str) -> str:
        import re
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", v):
            raise ValueError("color must be a 6-digit hex color like #ffffff")
        return v


class EditorMarker(BaseModel):
    id: str
    time_ms: float = Field(ge=0)
    sound: Literal["ding", "quack", "applause", "airhorn", "womp", "tada"]
    emoji: str
    label: str


class EditorDataRequest(BaseModel):
    trim_start_sec: float = Field(default=0, ge=0)
    trim_end_sec: float | None = Field(default=None, ge=0)
    captions: list[EditorCaption] = Field(default_factory=list)
    markers: list[EditorMarker] = Field(default_factory=list)


class EditorDataResponse(BaseModel):
    clip_id: uuid.UUID
    editor: EditorDataRequest


class RenderRequest(BaseModel):
    trim_start_sec: float = Field(default=0, ge=0)
    trim_end_sec: float | None = Field(default=None, ge=0)
    captions: list[EditorCaption] = Field(default_factory=list)
    markers: list[EditorMarker] = Field(default_factory=list)
    quality: Literal["draft", "720p", "1080p"] = "1080p"


class RenderStatusResponse(BaseModel):
    render_id: str
    clip_id: uuid.UUID
    status: Literal["queued", "processing", "done", "error"]
    progress_pct: int = 0
    download_url: str | None = None
    error_message: str | None = None
    created_at: str


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


class YouTubeFormatInfo(BaseModel):
    height: int
    fps: float | None = None
    ext: str | None = None
    filesize: int | None = None


class YouTubeFormatsResponse(BaseModel):
    url: str
    qualities: list[str]          # subset of ["source","1080p","720p","480p","360p"]
    max_height: int
    title: str | None = None
    duration: float | None = None
    formats: list[YouTubeFormatInfo] = Field(default_factory=list)


class SearchVideoHit(BaseModel):
    type: Literal["video"] = "video"
    id: uuid.UUID
    title: str | None
    status: str
    thumbnail_url: str | None
    duration_sec: float | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SearchClipHit(BaseModel):
    type: Literal["clip"] = "clip"
    id: uuid.UUID
    video_id: uuid.UUID
    title: str | None
    platform: str | None
    score: float | None
    status: str
    thumbnail_url: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SearchResponse(BaseModel):
    query: str
    videos: list[SearchVideoHit]
    clips: list[SearchClipHit]
