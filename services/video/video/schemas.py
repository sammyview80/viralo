from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, get_args
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EditorCaptionTemplate = Literal[
    "default",
    "modern",
    "bouncy",
    "mr-beast",
    "business",
    "clean",
    "neon",
    "podcast",
    "cinematic",
    "gaming",
    "news",
    "luxury",
    "karaoke",
    "meme",
    "documentary",
    "sports",
    "soft",
]


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
    caption_style: Literal[
        "capcut", "capcut-bold", "tiktok", "word-pop", "hormozi", "beast", "neon", "karaoke", "classic", "impact", "minimal",
        "sunset", "royal", "ocean", "bubble", "banger", "money", "reveal-light", "podcast",
        "pop-yellow", "pop-red", "karaoke-green", "karaoke-cyan", "comic", "cinema"
    ] | None = Field(
        default=None, description="Caption visual style (None = auto from template)"
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

    # Auto-publish: schedule generated clips to social accounts after the pipeline completes
    auto_publish: bool = Field(default=False, description="Auto-schedule clips to social accounts after generation")
    auto_publish_config: dict | None = Field(default=None, description="Auto-publish settings: social_account_ids, publish_per_day, publish_interval_hours, caption_template")

    @model_validator(mode="after")
    def _check_duration_bounds(self) -> "ClipConfig":
        # Frontend can send an inverted pair (e.g. slider race). Swap rather than
        # 422 so a transient UI glitch never blocks a clip job.
        if self.duration_min > self.duration_max:
            self.duration_min, self.duration_max = self.duration_max, self.duration_min
        return self


class CaptionStyleInfo(BaseModel):
    """Caption style catalog entry — drives the frontend picker and its preview."""
    id: str
    label: str
    desc: str
    family: Literal["pill", "reveal", "pop", "karaoke", "outline", "minimal"]
    highlight: str  # hex color of the active-word highlight / pill fill
    uppercase: bool = False


CAPTION_STYLE_CATALOG: list[CaptionStyleInfo] = [
    CaptionStyleInfo(id="tiktok",      label="TikTok",      desc="Words appear as spoken, dark box", family="reveal",  highlight="#ffffff"),
    CaptionStyleInfo(id="word-pop",    label="Word Pop",    desc="One big word at a time, centered", family="pop",     highlight="#ffffff", uppercase=True),
    CaptionStyleInfo(id="capcut",      label="CapCut",      desc="Word pills, yellow highlight",     family="pill",    highlight="#f5c518"),
    CaptionStyleInfo(id="capcut-bold", label="CapCut Bold", desc="Thicker strokes, high contrast",   family="pill",    highlight="#f5c518"),
    CaptionStyleInfo(id="hormozi",     label="Hormozi",     desc="Bold caps pills, green highlight", family="pill",    highlight="#39ff14", uppercase=True),
    CaptionStyleInfo(id="beast",       label="Beast",       desc="Big bold caps, red highlight",     family="pill",    highlight="#ff2d2d", uppercase=True),
    CaptionStyleInfo(id="neon",        label="Neon",        desc="Cyan highlight on dark band",      family="pill",    highlight="#00e5ff"),
    CaptionStyleInfo(id="karaoke",     label="Karaoke",     desc="Full line, word-by-word color",    family="karaoke", highlight="#f5c518"),
    CaptionStyleInfo(id="classic",     label="Classic",     desc="White subtitles, black outline",   family="outline", highlight="#ffffff"),
    CaptionStyleInfo(id="impact",      label="Impact",      desc="Huge meme-style outlined caps",    family="outline", highlight="#ffffff", uppercase=True),
    CaptionStyleInfo(id="minimal",     label="Minimal",     desc="Clean lower-third, no outline",    family="minimal", highlight="#ffffff"),
    CaptionStyleInfo(id="sunset",       label="Sunset",       desc="Word pills, hot-pink highlight",    family="pill",    highlight="#ff5e7e"),
    CaptionStyleInfo(id="royal",        label="Royal",        desc="Word pills, purple highlight",      family="pill",    highlight="#a855f7"),
    CaptionStyleInfo(id="ocean",        label="Ocean",        desc="Word pills, sky-blue highlight",    family="pill",    highlight="#38bdf8"),
    CaptionStyleInfo(id="bubble",       label="Bubble",       desc="Playful pink pills, no band",       family="pill",    highlight="#ff7ad9"),
    CaptionStyleInfo(id="banger",       label="Banger",       desc="Bold caps pills, orange highlight", family="pill",    highlight="#ff8a00", uppercase=True),
    CaptionStyleInfo(id="money",        label="Money",        desc="Bold caps pills, green highlight",  family="pill",    highlight="#22c55e", uppercase=True),
    CaptionStyleInfo(id="reveal-light", label="Reveal Light", desc="Words appear, white box",           family="reveal",  highlight="#ffffff"),
    CaptionStyleInfo(id="podcast",      label="Podcast",      desc="Big words on dark studio box",      family="reveal",  highlight="#ffffff"),
    CaptionStyleInfo(id="pop-yellow",   label="Pop Yellow",   desc="One big yellow word at a time",     family="pop",     highlight="#ffe600", uppercase=True),
    CaptionStyleInfo(id="pop-red",      label="Pop Red",      desc="One big red word at a time",        family="pop",     highlight="#ff2d2d", uppercase=True),
    CaptionStyleInfo(id="karaoke-green",label="Karaoke Green",desc="Full line, green word sweep",       family="karaoke", highlight="#39ff14"),
    CaptionStyleInfo(id="karaoke-cyan", label="Karaoke Cyan", desc="Full line, cyan word sweep",        family="karaoke", highlight="#00e5ff"),
    CaptionStyleInfo(id="comic",        label="Comic",        desc="Yellow caps, thick black outline",  family="outline", highlight="#ffe600", uppercase=True),
    CaptionStyleInfo(id="cinema",       label="Cinema",       desc="Subtle subtitles on dark band",     family="outline", highlight="#ffffff"),
]

# Import-time drift guard: the catalog must exactly match ClipConfig's Literal
_style_literal = next(
    a for a in get_args(ClipConfig.model_fields["caption_style"].annotation) if a is not type(None)
)
assert {s.id for s in CAPTION_STYLE_CATALOG} == set(get_args(_style_literal)), \
    "CAPTION_STYLE_CATALOG out of sync with ClipConfig.caption_style Literal"


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
    template: EditorCaptionTemplate = "default"

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
