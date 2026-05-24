import uuid
from datetime import datetime
from sqlalchemy import Boolean, ForeignKey, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from shared.models.base import Base, TimestampMixin


class Subscription(Base, TimestampMixin):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("plans.id"), nullable=False)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")  # active|past_due|cancelled|trialing|paused
    billing_cycle: Mapped[str] = mapped_column(String(10), nullable=False, default="monthly")  # monthly|yearly
    current_period_start: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), index=True, nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
