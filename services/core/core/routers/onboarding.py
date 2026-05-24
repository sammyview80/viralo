"""
Onboarding flow (5 steps, all skippable).

Data is buffered in Redis during steps 1-4.
POST /onboarding/finalize provisions the tenant and marks onboarding done.
"""
import json
import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from shared.auth import create_access_token, create_refresh_token
from shared.deps import get_current_user, get_db_no_rls, get_redis
from shared.schemas.auth import TokenPayload, TokenResponse
from shared.models.public.user import User
from shared.models.public.tenant import Tenant
from shared.models.public.usage_quota import UsageQuota

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

ONBOARDING_TTL = 7 * 86400  # 7 days
TOTAL_STEPS = 5


# ── schemas ──────────────────────────────────────────────────────────────────

class OnboardingStatus(BaseModel):
    step: int | None
    is_complete: bool
    data: dict  # buffered data so far


class StepResponse(BaseModel):
    step: int | None
    is_complete: bool
    message: str


class NicheRequest(BaseModel):
    niche: str = Field(min_length=1, max_length=100)
    subdomain: str = Field(
        min_length=3,
        max_length=63,
        pattern=r'^[a-z0-9][a-z0-9\-]*[a-z0-9]$',
        description="Workspace subdomain — collected here since tenant is not yet created",
    )


class SourceRequest(BaseModel):
    source: str = Field(min_length=1, max_length=100)


class GoalRequest(BaseModel):
    goal: Literal["marketing", "hustle", "viral", "agency"]


class ConnectRequest(BaseModel):
    platform: str = Field(min_length=1, max_length=50)


class PlanRequest(BaseModel):
    plan: Literal["free", "starter", "pro", "agency"]


class FinalizeResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    message: str


# ── helpers ───────────────────────────────────────────────────────────────────

def _redis_key(user_id: str) -> str:
    return f"onboarding:{user_id}"


async def _load_data(redis: aioredis.Redis, user_id: str) -> dict:
    raw = await redis.get(_redis_key(user_id))
    return json.loads(raw) if raw else {}


async def _save_data(redis: aioredis.Redis, user_id: str, data: dict) -> None:
    await redis.setex(_redis_key(user_id), ONBOARDING_TTL, json.dumps(data))


def _is_complete(step: int | None) -> bool:
    return step is None


def _advance(user: User, expected_step: int) -> None:
    current = user.onboarding_step or 0
    if current == expected_step:
        next_step = expected_step + 1
        user.onboarding_step = None if next_step > TOTAL_STEPS else next_step


async def _get_user(token: TokenPayload, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.id == uuid.UUID(token.sub)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=OnboardingStatus)
async def get_status(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    user = await _get_user(token, db)
    data = await _load_data(redis, token.sub)
    return OnboardingStatus(
        step=user.onboarding_step,
        is_complete=_is_complete(user.onboarding_step),
        data=data,
    )


@router.post("/niche", response_model=StepResponse)
async def step_niche(
    body: NicheRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    user = await _get_user(token, db)

    # Validate subdomain not already taken
    existing = await db.execute(select(Tenant).where(Tenant.subdomain == body.subdomain))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Subdomain already taken")

    data = await _load_data(redis, token.sub)
    data["niche"] = body.niche
    data["subdomain"] = body.subdomain
    await _save_data(redis, token.sub, data)

    _advance(user, expected_step=0)
    await db.commit()
    return StepResponse(
        step=user.onboarding_step,
        is_complete=_is_complete(user.onboarding_step),
        message="Niche saved",
    )


@router.post("/source", response_model=StepResponse)
async def step_source(
    body: SourceRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    user = await _get_user(token, db)
    data = await _load_data(redis, token.sub)
    data["source"] = body.source
    await _save_data(redis, token.sub, data)
    _advance(user, expected_step=1)
    await db.commit()
    return StepResponse(
        step=user.onboarding_step,
        is_complete=_is_complete(user.onboarding_step),
        message="Source saved",
    )


@router.post("/goal", response_model=StepResponse)
async def step_goal(
    body: GoalRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    user = await _get_user(token, db)
    data = await _load_data(redis, token.sub)
    data["goal"] = body.goal
    await _save_data(redis, token.sub, data)
    _advance(user, expected_step=2)
    await db.commit()
    return StepResponse(
        step=user.onboarding_step,
        is_complete=_is_complete(user.onboarding_step),
        message="Goal saved",
    )


@router.post("/connect", response_model=StepResponse)
async def step_connect(
    body: ConnectRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Platform-specific OAuth lives in platform service; this just advances the step."""
    user = await _get_user(token, db)
    data = await _load_data(redis, token.sub)
    data["platform"] = body.platform
    await _save_data(redis, token.sub, data)
    _advance(user, expected_step=3)
    await db.commit()
    return StepResponse(
        step=user.onboarding_step,
        is_complete=_is_complete(user.onboarding_step),
        message=f"Platform {body.platform!r} noted",
    )


@router.post("/plan", response_model=StepResponse)
async def step_plan(
    body: PlanRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Actual Stripe checkout at /billing/checkout; this records intent and advances step."""
    user = await _get_user(token, db)
    data = await _load_data(redis, token.sub)
    data["plan"] = body.plan
    await _save_data(redis, token.sub, data)
    _advance(user, expected_step=4)
    await db.commit()
    return StepResponse(
        step=user.onboarding_step,
        is_complete=_is_complete(user.onboarding_step),
        message=f"Plan {body.plan!r} selected",
    )


@router.post("/finalize", response_model=FinalizeResponse)
async def finalize_onboarding(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Provisions the tenant from buffered onboarding data, links user, marks done.
    Returns a new access token with tenant_id populated.
    """
    user = await _get_user(token, db)

    if user.tenant_id is not None:
        raise HTTPException(status_code=400, detail="Onboarding already finalized")

    data = await _load_data(redis, token.sub)
    subdomain = data.get("subdomain")
    if not subdomain:
        raise HTTPException(
            status_code=422,
            detail="Missing subdomain — complete step 1 (niche) first",
        )

    # Re-check subdomain uniqueness at finalize time
    existing = await db.execute(select(Tenant).where(Tenant.subdomain == subdomain))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Subdomain already taken")

    # Provision tenant
    tenant = Tenant(
        subdomain=subdomain,
        display_name=user.full_name or subdomain,
        status="active",
        niche=data.get("niche"),
        goal=data.get("goal"),
        referral_source=data.get("source"),
    )
    db.add(tenant)
    await db.flush()

    # Provision usage quota
    quota = UsageQuota(
        tenant_id=tenant.id,
        period_start=date.today(),
    )
    db.add(quota)

    # Link user → tenant and mark onboarding complete
    user.tenant_id = tenant.id
    user.onboarding_step = None

    await db.commit()
    await db.refresh(user)

    # Cache subdomain → tenant_id
    await redis.setex(f"subdomain:{tenant.subdomain}", 3600, str(tenant.id))

    # Clean up onboarding buffer
    await redis.delete(_redis_key(token.sub))

    # Issue new token with tenant_id
    access_token = create_access_token(
        user_id=str(user.id),
        tenant_id=str(tenant.id),
        email=user.email,
        plan=data.get("plan", "free"),
    )

    return FinalizeResponse(
        access_token=access_token,
        message="Onboarding complete — workspace created",
    )


@router.post("/skip", response_model=FinalizeResponse)
async def skip_onboarding(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Skip remaining steps and finalize with whatever data is buffered.
    Subdomain is still required (from step 1).
    """
    return await finalize_onboarding(token=token, db=db, redis=redis)
