import uuid
from sqlalchemy import ForeignKey, String, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from shared.models.base import Base, TimestampMixin


class Tenant(Base, TimestampMixin):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subdomain: Mapped[str] = mapped_column(String(63), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")  # active|suspended|deleted
    trial_ends_at: Mapped[str | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    storage_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="cloudinary")  # cloudinary|r2|s3
    llm_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="groq")  # google|openai|anthropic|groq
    llm_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="UTC")
    niche: Mapped[str | None] = mapped_column(String(100), nullable=True)
    goal: Mapped[str | None] = mapped_column(String(20), nullable=True)  # marketing|hustle|viral|agency
    referral_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    brand_kit: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notification_prefs: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    webhook_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # {"url", "secret", "enabled"}
