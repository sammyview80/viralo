import uuid
from sqlalchemy import String, Text, ForeignKey, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.models.base import Base, TimestampMixin
from shared.models.tenant.mixins import TenantMixin


class BrainstormSession(Base, TenantMixin, TimestampMixin):
    __tablename__ = "brainstorm_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    langgraph_thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, unique=True)
    langgraph_checkpoint: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    current_agent: Mapped[str | None] = mapped_column(String(50), nullable=True)
    agents_completed: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    niche_verdict: Mapped[str | None] = mapped_column(Text, nullable=True)
    video_ideas: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    generated_workflow_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    generated_video_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    messages: Mapped[list["AgentMessage"]] = relationship(
        "AgentMessage", back_populates="session", cascade="all, delete-orphan"
    )


class AgentMessage(Base, TenantMixin):
    __tablename__ = "agent_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("brainstorm_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agent: Mapped[str] = mapped_column(String(50), nullable=False)
    msg_type: Mapped[str] = mapped_column(String(30), nullable=False, default="agent_message")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    msg_metadata: Mapped[dict | None] = mapped_column("msg_metadata", JSONB, nullable=True)
    created_at: Mapped[str | None] = mapped_column(nullable=True)

    session: Mapped["BrainstormSession"] = relationship("BrainstormSession", back_populates="messages")
