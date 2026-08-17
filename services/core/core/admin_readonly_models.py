"""Read-only ORM mirrors of tables owned by other services (video, platform).

The core service's package does not depend on the video/platform_svc packages
(see root pyproject.toml uv workspace — core only lists viralo-shared), so we
can't import their real model classes without adding a cross-service package
dependency. These tables live in the same physical database though, so we
map a minimal read-only subset of columns here purely for admin aggregation
queries. Never used for writes — the owning service's models remain the
source of truth for schema/migrations.

WARNING — these are ordinary SQLAlchemy mapped models, not enforced
read-only at the DB layer. The event listeners at the bottom of this file
catch the common accident (a normal ORM write via session.add()/attribute
mutation + commit/session.delete()) and raise immediately instead of
silently succeeding — that's the realistic way a future change would touch
this file by mistake. They do NOT stop every possible write path: raw
Core-level statements (session.execute(insert(...)/update(...)/delete(...)))
and bulk operations (session.bulk_insert_mappings, etc.) bypass ORM mapper
events entirely and are not blocked by this file. Treat this as a guardrail
against accidental misuse, not a security boundary — the only way to make
this a real boundary is a database role/connection restricted to SELECT on
these tables, which is a production infra change, not app code (tracked in
TODO.md). Do not add write operations against these classes; if a write to
video/platform-owned data is ever needed from core, do it via that
service's API instead of writing directly to its tables.

SCHEMA DRIFT: if the owning service renames or removes a column these
models reference, this file goes stale silently until a query fails at
runtime. Keep in sync manually when video/platform models change; there is
no automated check for this yet.

GUARDRAIL (not a security boundary — see WARNING above): before_insert/
before_update/before_delete mapper events raise RuntimeError for every
class in this module, so an accidental ORM write attempt fails loudly at
flush time instead of silently succeeding.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, event
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from shared.models.base import Base


class AdminVideoView(Base):
    __tablename__ = "videos"
    __table_args__ = {"extend_existing": True}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AdminClipView(Base):
    __tablename__ = "clips"
    __table_args__ = {"extend_existing": True}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    video_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("videos.id"), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AdminSocialAccountView(Base):
    __tablename__ = "social_accounts"
    __table_args__ = {"extend_existing": True}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    platform: Mapped[str] = mapped_column(String(30), nullable=False)
    platform_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AdminScheduledPostView(Base):
    __tablename__ = "scheduled_posts"
    __table_args__ = {"extend_existing": True}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    platform: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def _reject_write(mapper, connection, target) -> None:
    raise RuntimeError(
        f"{type(target).__name__} is a read-only admin view over a table owned "
        "by another service — writes through this model are not permitted. "
        "Use the owning service's API instead."
    )


# Guardrail against accidental ORM writes (session.add/delete + commit) -
# NOT a security boundary. Raw Core statements and bulk operations bypass
# these mapper events entirely; see the module docstring WARNING above.
for _view_cls in (AdminVideoView, AdminClipView, AdminSocialAccountView, AdminScheduledPostView):
    event.listen(_view_cls, "before_insert", _reject_write)
    event.listen(_view_cls, "before_update", _reject_write)
    event.listen(_view_cls, "before_delete", _reject_write)
