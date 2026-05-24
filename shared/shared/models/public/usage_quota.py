import uuid
from sqlalchemy import BigInteger, Date, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from shared.models.base import Base, TimestampMixin


class UsageQuota(Base, TimestampMixin):
    __tablename__ = "usage_quotas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), unique=True, nullable=False)
    period_start: Mapped[Date | None] = mapped_column(Date, nullable=True)
    videos_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_bytes_used: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    brainstorm_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    api_calls_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    llm_tokens_used: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
