import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from shared.models.base import Base, TimestampMixin
from shared.models.tenant.mixins import TenantMixin
import shared.models.public.tenant  # noqa: F401 — registers Tenant in metadata for FK resolution


class Video(Base, TenantMixin, TimestampMixin):
    __tablename__ = "videos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    topic: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="uploaded")
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    pipeline_step: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pipeline_pct: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    celery_task_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    storage_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    script_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    step_artifacts: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(20), nullable=True)
    video_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    clip_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class Clip(Base, TenantMixin, TimestampMixin):
    __tablename__ = "clips"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("videos.id"), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    start_sec: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    end_sec: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    start_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)
    score: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    storage_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption_srt: Mapped[str | None] = mapped_column(Text, nullable=True)
    clip_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    upload_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
