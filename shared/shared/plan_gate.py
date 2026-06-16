from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_tenant_db
from shared.models.public.plan import Plan
from shared.models.public.subscription import Subscription
from shared.models.public.tenant import Tenant
from shared.schemas.auth import TokenPayload


@dataclass
class PlanFeatures:
    videos_per_month: int                    # -1 = unlimited
    storage_gb: int                          # -1 = unlimited
    brainstorm: bool
    workflows: bool
    channels: bool
    integrations: list[str] = field(default_factory=list)  # [] = none
    accounts_per_platform: int = 0           # -1 = unlimited
    watermark: bool = False
    video_duration_limit_min: int | None = None  # None = unlimited


PLAN_FEATURES: dict[str, PlanFeatures] = {
    "free": PlanFeatures(
        videos_per_month=5,
        storage_gb=1,
        brainstorm=False,
        workflows=False,
        channels=False,
        integrations=[],
        accounts_per_platform=0,
        watermark=True,
        video_duration_limit_min=20,
    ),
    "starter": PlanFeatures(
        videos_per_month=15,
        storage_gb=10,
        brainstorm=True,
        workflows=False,
        channels=False,
        integrations=["youtube", "instagram", "tiktok"],
        accounts_per_platform=1,
        watermark=False,
        video_duration_limit_min=None,
    ),
    "pro": PlanFeatures(
        videos_per_month=30,
        storage_gb=20,
        brainstorm=True,
        workflows=False,
        channels=False,
        integrations=["youtube", "instagram", "tiktok"],
        accounts_per_platform=3,
        watermark=False,
        video_duration_limit_min=None,
    ),
    "creator": PlanFeatures(
        videos_per_month=60,
        storage_gb=40,
        brainstorm=True,
        workflows=True,
        channels=True,
        integrations=["youtube", "instagram", "tiktok"],
        accounts_per_platform=5,
        watermark=False,
        video_duration_limit_min=None,
    ),
    "unlimited": PlanFeatures(
        videos_per_month=-1,
        storage_gb=-1,
        brainstorm=True,
        workflows=True,
        channels=True,
        integrations=["youtube", "instagram", "tiktok"],
        accounts_per_platform=-1,
        watermark=False,
        video_duration_limit_min=None,
    ),
}

# Plans ordered from lowest to highest tier (used for upgrade messaging)
_PLAN_ORDER = ["free", "starter", "pro", "creator", "unlimited"]

# Map feature strings to the minimum plan that grants them
_FEATURE_MIN_PLAN: dict[str, str] = {
    "brainstorm": "starter",
    "workflows": "creator",
    "channels": "creator",
    "integrations": "starter",
    "watermark_free": "starter",
}


def get_plan_features(plan_name: str) -> PlanFeatures:
    return PLAN_FEATURES.get(plan_name, PLAN_FEATURES["free"])


def _check_feature(features: PlanFeatures, feature: str) -> bool:
    """Return True if the PlanFeatures object grants the given feature string."""
    attr = getattr(features, feature, None)
    if attr is None:
        # feature string not a direct attribute — check integrations membership
        if feature in ("youtube", "instagram", "tiktok"):
            return feature in features.integrations
        return False
    if isinstance(attr, bool):
        return attr
    if isinstance(attr, list):
        return len(attr) > 0
    if isinstance(attr, int):
        return attr != 0
    return bool(attr)


async def get_tenant_plan(
    db: AsyncSession, tenant_id: uuid.UUID
) -> tuple[str, PlanFeatures]:
    """Return (plan_name, PlanFeatures) for tenant. Defaults to 'free'."""
    result = await db.execute(
        select(Plan.name)
        .join(Subscription, Subscription.plan_id == Plan.id)
        .where(
            Subscription.tenant_id == tenant_id,
            Subscription.status.in_(["active", "trialing"]),
        )
        .order_by(Subscription.current_period_end.desc())
        .limit(1)
    )
    plan_name: str | None = result.scalar_one_or_none()

    if not plan_name:
        # Fall back to plan_id on tenant row
        tenant_result = await db.execute(
            select(Plan.name)
            .join(Tenant, Tenant.plan_id == Plan.id)
            .where(Tenant.id == tenant_id)
            .limit(1)
        )
        plan_name = tenant_result.scalar_one_or_none()

    plan_name = plan_name or "free"
    return plan_name, get_plan_features(plan_name)


async def require_feature(
    feature: str,
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> PlanFeatures:
    """Raise HTTP 402 if tenant's plan does not grant the requested feature."""
    plan_name, features = await get_tenant_plan(db, tenant_id)

    if not _check_feature(features, feature):
        min_plan = _FEATURE_MIN_PLAN.get(feature, "a higher tier plan")
        raise HTTPException(
            status_code=402,
            detail=f"Upgrade required: {min_plan} plan or above needed for '{feature}'",
        )

    return features


async def check_storage_quota(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    additional_bytes: int = 0,
) -> None:
    """Raise HTTP 402 if adding additional_bytes would exceed the plan storage limit."""
    from shared.models.public.usage_quota import UsageQuota  # noqa: PLC0415

    _, features = await get_tenant_plan(db, tenant_id)

    if features.storage_gb == -1:
        return  # unlimited

    limit_bytes = features.storage_gb * 1_073_741_824

    quota_result = await db.execute(
        select(UsageQuota).where(UsageQuota.tenant_id == tenant_id)
    )
    quota = quota_result.scalar_one_or_none()
    used_bytes = quota.storage_bytes_used if quota else 0

    if used_bytes + additional_bytes > limit_bytes:
        used_gb = round(used_bytes / 1_073_741_824, 2)
        raise HTTPException(
            status_code=402,
            detail=(
                f"Storage limit reached: {used_gb} GB used of {features.storage_gb} GB. "
                "Upgrade your plan for more storage."
            ),
        )


async def increment_storage_used(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    bytes_added: int,
) -> None:
    """Add bytes_added to tenant's storage_bytes_used. Creates quota row if absent."""
    from shared.models.public.usage_quota import UsageQuota  # noqa: PLC0415

    quota_result = await db.execute(
        select(UsageQuota).where(UsageQuota.tenant_id == tenant_id)
    )
    quota = quota_result.scalar_one_or_none()
    if quota:
        quota.storage_bytes_used = (quota.storage_bytes_used or 0) + bytes_added
    else:
        db.add(UsageQuota(tenant_id=tenant_id, storage_bytes_used=bytes_added))
    await db.commit()


def plan_gate(feature: str) -> Any:
    """FastAPI dependency factory. Raises 402 if tenant lacks the feature."""
    # Import here to avoid circular import (deps imports nothing from plan_gate)
    from shared.deps import get_current_user  # noqa: PLC0415

    async def _dep(
        token: TokenPayload = Depends(get_current_user),
        db: AsyncSession = Depends(get_tenant_db),
    ) -> PlanFeatures:
        tenant_id = uuid.UUID(token.tenant_id)
        return await require_feature(feature, db, tenant_id)

    return Depends(_dep)
