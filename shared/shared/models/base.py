import uuid
from datetime import datetime
from sqlalchemy import DateTime, func, event, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


@event.listens_for(Session, "before_flush")
def set_tenant_id_on_insert(session, flush_context, instances):
    """Auto-set tenant_id on new objects from RLS session variable."""
    for obj in session.new:
        if hasattr(obj, "tenant_id") and obj.tenant_id is None:
            try:
                result = session.execute(
                    text("SELECT current_setting('app.current_tenant', true)")
                ).scalar()
                if result:
                    obj.tenant_id = uuid.UUID(result)
            except Exception:
                pass
