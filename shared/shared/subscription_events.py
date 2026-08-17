import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.public.subscription_event import SubscriptionEvent

logger = logging.getLogger(__name__)


async def log_subscription_event(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    subscription_id: uuid.UUID,
    event_type: str,
    from_plan_name: str | None,
    to_plan_name: str | None,
) -> None:
    """Best-effort subscription audit-log write. Must never raise — callers
    invoke this after the actual plan/status mutation is already committed,
    so a logging failure here should never block or roll back that mutation."""
    try:
        event = SubscriptionEvent(
            tenant_id=tenant_id,
            subscription_id=subscription_id,
            event_type=event_type,
            from_plan_name=from_plan_name,
            to_plan_name=to_plan_name,
        )
        db.add(event)
        await db.commit()
    except Exception:
        logger.exception(
            "Failed to write subscription_event tenant_id=%s subscription_id=%s event_type=%s",
            tenant_id, subscription_id, event_type,
        )
