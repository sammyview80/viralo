import uuid
from decimal import Decimal
from sqlalchemy import Boolean, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from shared.models.base import Base, TimestampMixin


class Plan(Base, TimestampMixin):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), nullable=False)  # free | pro | agency
    price_monthly: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    price_yearly: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    stripe_price_id_mo: Mapped[str | None] = mapped_column(String(100))
    stripe_price_id_yr: Mapped[str | None] = mapped_column(String(100))
    videos_per_month: Mapped[int] = mapped_column(Integer, nullable=False)  # -1 = unlimited
    platforms_allowed: Mapped[int] = mapped_column(Integer, nullable=False)
    brainstorm_sessions: Mapped[int] = mapped_column(Integer, nullable=False)
    workflows_allowed: Mapped[int] = mapped_column(Integer, nullable=False)
    voice_clone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    custom_llm_key: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    storage_gb: Mapped[int] = mapped_column(Integer, nullable=False)
    team_members: Mapped[int] = mapped_column(Integer, nullable=False)
