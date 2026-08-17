import uuid
from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from shared.models.base import Base, TimestampMixin


class SubscriptionEvent(Base, TimestampMixin):
    __tablename__ = "subscription_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    subscription_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("subscriptions.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)  # upgraded|downgraded|cancelled|created|renewed
    from_plan_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_plan_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
