"""Admin panel: magic-link login + user directory + tier overrides.

Known limitations (accepted, not bugs):
  - POST /admin/users/{id}/tier is a MANUAL OPS OVERRIDE ONLY. It writes the
    local subscription's plan_id/status directly and never touches Stripe.
    It can grant paid-tier access without real payment, and a later Stripe
    webhook (renewal, cancellation, etc.) can silently overwrite it back to
    whatever Stripe believes the plan is. This is an accepted tradeoff for
    support/ops convenience, not an oversight — full Stripe reconciliation
    (e.g. also updating/creating the Stripe subscription so it matches) is
    out of scope for this PR. See the docstring on change_user_tier below.
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel, EmailStr
from sqlalchemy import Date, cast, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.admin_readonly_models import (
    AdminClipView,
    AdminScheduledPostView,
    AdminSocialAccountView,
    AdminVideoView,
)
from core.routers.auth import _client_ip
from shared.auth import AdminAuthNotConfigured, create_admin_token, decode_admin_token, ensure_admin_auth_configured
from shared.config import settings
from shared.deps import get_db_no_rls, get_redis
from shared.email import send_email
from shared.models.public.admin_magic_link import AdminMagicLink
from shared.models.public.admin_notification import AdminNotification
from shared.models.public.api_key import TenantApiKey
from shared.models.public.plan import Plan
from shared.models.public.subscription import Subscription
from shared.models.public.subscription_event import SubscriptionEvent
from shared.models.public.usage_quota import UsageQuota
from shared.models.public.user import User
from shared.subscription_events import log_subscription_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Real tier list — do not invent tiers. Kept in sync with
# shared.plan_gate.PLAN_FEATURES / _PLAN_ORDER.
PLAN_TIERS = ["free", "starter", "pro", "creator", "unlimited"]

_bearer = HTTPBearer()

MAGIC_LINK_TTL_MINUTES = 15
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 900  # 15 minutes


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db_no_rls),
) -> User:
    try:
        payload = decode_admin_token(credentials.credentials)
    except AdminAuthNotConfigured:
        raise HTTPException(status_code=500, detail="Admin auth is not configured (ADMIN_JWT_SECRET unset or unsafe)")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("type") != "admin":
        raise HTTPException(status_code=401, detail="Invalid token type")

    result = await db.execute(select(User).where(User.id == uuid.UUID(payload["sub"])))
    user = result.scalar_one_or_none()
    if not user or not user.is_admin or not user.is_active:
        raise HTTPException(status_code=403, detail="Admin access revoked")
    return user


async def require_superadmin(admin: User = Depends(require_admin)) -> User:
    """Same token/active/is_admin checks as require_admin, plus is_superadmin.
    Only used to gate grant/revoke of admin access itself."""
    if not admin.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return admin


# ─── Magic-link login ───────────────────────────────────────────────────────

class MagicLinkRequest(BaseModel):
    email: EmailStr


class MagicLinkVerifyResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login/request", status_code=status.HTTP_200_OK)
async def request_admin_login(
    body: MagicLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Always returns a generic message — never reveals whether the email
    belongs to an admin account, to avoid leaking who has admin access."""
    try:
        ensure_admin_auth_configured()
    except AdminAuthNotConfigured:
        # Deliberately not the generic response here: this is a server
        # misconfiguration, not "unknown email" — don't silently email a
        # link that's guaranteed to fail at verify.
        raise HTTPException(status_code=500, detail="Admin auth is not configured (ADMIN_JWT_SECRET unset or unsafe)")

    ip = _client_ip(request)
    email = body.email.strip().lower()
    rate_key = f"admin_login_attempts:{ip}:{email}"
    attempts = await redis.incr(rate_key)
    if attempts == 1:
        await redis.expire(rate_key, RATE_LIMIT_WINDOW)
    if attempts > RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")

    generic_response = {"message": "If this email has admin access, a login link has been sent."}

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_admin or not user.is_active:
        return generic_response

    raw_token = secrets.token_urlsafe(32)
    link = AdminMagicLink(
        email=email,
        token_hash=_hash_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=MAGIC_LINK_TTL_MINUTES),
    )
    db.add(link)
    await db.commit()

    # Token in the URL fragment (#), not the query string (?) — fragments are
    # never transmitted to the server, so they never appear in server/proxy
    # access logs or Referer headers. They can still appear in the browser's
    # own address bar / history until AdminVerifyPage clears it client-side.
    verify_url = f"{settings.frontend_url}/admin/verify#token={raw_token}"
    await send_email(
        to=email,
        subject="Your Viralo admin login link",
        html_body=(
            f"<p>Click below to sign in to the Viralo admin panel. "
            f"This link expires in {MAGIC_LINK_TTL_MINUTES} minutes and can only be used once.</p>"
            f'<p><a href="{verify_url}">{verify_url}</a></p>'
        ),
    )
    return generic_response


class MagicLinkVerifyRequest(BaseModel):
    token: str


@router.post("/login/verify", response_model=MagicLinkVerifyResponse)
async def verify_admin_login(
    body: MagicLinkVerifyRequest,
    db: AsyncSession = Depends(get_db_no_rls),
):
    """Token travels in a POST body (never a query string), so this API call
    itself never appears in server/proxy access logs or Referer headers.
    Claiming is a single atomic UPDATE ... WHERE used_at IS NULL RETURNING —
    so two concurrent requests for the same token can never both succeed
    (no read-then-write race)."""
    # Fail before consuming the (single-use) token if admin auth isn't
    # configured, so a misconfigured deploy doesn't burn the user's link.
    try:
        ensure_admin_auth_configured()
    except AdminAuthNotConfigured:
        raise HTTPException(status_code=500, detail="Admin auth is not configured (ADMIN_JWT_SECRET unset or unsafe)")

    token_hash = _hash_token(body.token)
    now = datetime.now(timezone.utc)

    claim = await db.execute(
        update(AdminMagicLink)
        .where(
            AdminMagicLink.token_hash == token_hash,
            AdminMagicLink.used_at.is_(None),
            AdminMagicLink.expires_at >= now,
        )
        .values(used_at=now)
        .returning(AdminMagicLink.email)
    )
    row = claim.first()
    await db.commit()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired link")
    email = row[0]

    user_result = await db.execute(select(User).where(User.email == email))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_admin or not user.is_active:
        raise HTTPException(status_code=403, detail="Admin access revoked")

    access_token = create_admin_token(user_id=str(user.id), email=user.email)
    return MagicLinkVerifyResponse(access_token=access_token)


# ─── User directory ─────────────────────────────────────────────────────────

class AdminUserRow(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    is_active: bool
    is_admin: bool
    is_superadmin: bool
    tier: str
    subscription_status: str | None
    billing_cycle: str | None = None
    current_period_end: datetime | None = None
    created_at: datetime
    last_login_at: datetime | None

    model_config = {"from_attributes": True}


class AdminMeResponse(BaseModel):
    id: uuid.UUID
    email: str
    is_admin: bool
    is_superadmin: bool


@router.get("/me", response_model=AdminMeResponse)
async def get_admin_me(admin: User = Depends(require_admin)):
    return AdminMeResponse(
        id=admin.id, email=admin.email, is_admin=admin.is_admin, is_superadmin=admin.is_superadmin
    )


class AdminUserListResponse(BaseModel):
    items: list[AdminUserRow]
    total: int
    page: int
    per_page: int


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    page: int = 1,
    per_page: int = 25,
    search: str | None = None,
    sort_by: str = "created_at",
    order: str = "desc",
    subscription_status: str | None = None,
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    per_page = min(max(per_page, 1), 100)
    page = max(page, 1)

    query = (
        select(
            User,
            Subscription.status.label("subscription_status"),
            Subscription.billing_cycle.label("billing_cycle"),
            Subscription.current_period_end.label("current_period_end"),
            Plan.name.label("plan_name"),
        )
        .outerjoin(Subscription, Subscription.tenant_id == User.tenant_id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
    )
    if search:
        like = f"%{search.strip().lower()}%"
        query = query.where(
            func.lower(User.email).like(like) | func.lower(func.coalesce(User.full_name, "")).like(like)
        )
    if subscription_status:
        # Filter server-side so pagination/total stay correct — filtering
        # only the already-fetched page client-side (as the Payments tab
        # used to do) silently drops rows from view while "total" and page
        # count still reflect the unfiltered set.
        query = query.where(Subscription.status == subscription_status)

    sort_column = {
        "created_at": User.created_at,
        "email": User.email,
        "last_login_at": User.last_login_at,
    }.get(sort_by, User.created_at)
    query = query.order_by(sort_column.desc() if order == "desc" else sort_column.asc())

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    rows_result = await db.execute(query.offset((page - 1) * per_page).limit(per_page))
    items = [
        AdminUserRow(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_active=user.is_active,
            is_admin=user.is_admin,
            is_superadmin=user.is_superadmin,
            tier=plan_name or "free",
            subscription_status=subscription_status,
            billing_cycle=billing_cycle,
            current_period_end=current_period_end,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
        )
        for user, subscription_status, billing_cycle, current_period_end, plan_name in rows_result.all()
    ]
    return AdminUserListResponse(items=items, total=total, page=page, per_page=per_page)


class AdminUserStats(BaseModel):
    total_users: int
    active_users: int
    paid_users: int
    by_tier: dict[str, int]


@router.get("/users/stats", response_model=AdminUserStats)
async def user_stats(
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    active_users = (
        await db.execute(select(func.count()).select_from(User).where(User.is_active.is_(True)))
    ).scalar_one()

    tier_query = (
        select(func.coalesce(Plan.name, "free").label("tier"), func.count(User.id))
        .select_from(User)
        .outerjoin(Subscription, Subscription.tenant_id == User.tenant_id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
        .group_by("tier")
    )
    by_tier = {tier: 0 for tier in PLAN_TIERS}
    for tier, count in (await db.execute(tier_query)).all():
        by_tier[tier] = count

    paid_users = (
        await db.execute(
            select(func.count())
            .select_from(User)
            .join(Subscription, Subscription.tenant_id == User.tenant_id)
            .join(Plan, Plan.id == Subscription.plan_id)
            .where(Plan.name != "free", Subscription.status == "active")
        )
    ).scalar_one()

    return AdminUserStats(
        total_users=total_users,
        active_users=active_users,
        paid_users=paid_users,
        by_tier=by_tier,
    )


class SignupTrendPoint(BaseModel):
    date: str
    count: int


class SignupTrendResponse(BaseModel):
    points: list[SignupTrendPoint]


@router.get("/dashboard/signups", response_model=SignupTrendResponse)
async def signup_trend(
    days: int = 30,
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    days = min(max(days, 1), 365)
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    day_col = cast(User.created_at, Date)
    query = (
        select(day_col.label("day"), func.count(User.id))
        .where(User.created_at >= since)
        .group_by("day")
        .order_by("day")
    )
    counts = {str(day): count for day, count in (await db.execute(query)).all()}

    points = []
    for i in range(days):
        d = (since + timedelta(days=i)).date()
        points.append(SignupTrendPoint(date=str(d), count=counts.get(str(d), 0)))
    return SignupTrendResponse(points=points)


# ─── User detail (drill-down) ───────────────────────────────────────────────

class UserDetailProfile(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    tenant_id: uuid.UUID | None
    is_active: bool
    is_admin: bool
    is_superadmin: bool
    created_at: datetime
    last_login_at: datetime | None
    tier: str
    subscription_status: str | None
    billing_cycle: str | None
    current_period_end: datetime | None


class VideoSummary(BaseModel):
    id: uuid.UUID
    title: str | None
    status: str
    created_at: datetime


class SocialAccountSummary(BaseModel):
    platform: str
    platform_username: str | None
    is_active: bool
    connected_at: datetime


class ScheduledPostBreakdownRow(BaseModel):
    platform: str
    status: str
    count: int


class UserDetailResponse(BaseModel):
    profile: UserDetailProfile
    videos_count: int
    videos: list[VideoSummary]
    clips_count: int
    storage_bytes_used: int | None
    social_accounts: list[SocialAccountSummary]
    scheduled_posts_by_platform: list[ScheduledPostBreakdownRow]
    has_active_api_key: bool


@router.get("/users/{user_id}/detail", response_model=UserDetailResponse)
async def get_user_detail(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    row = (
        await db.execute(
            select(User, Subscription, Plan.name.label("plan_name"))
            .outerjoin(Subscription, Subscription.tenant_id == User.tenant_id)
            .outerjoin(Plan, Plan.id == Subscription.plan_id)
            .where(User.id == user_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    user, subscription, plan_name = row

    tenant_id = user.tenant_id
    videos: list[VideoSummary] = []
    videos_count = 0
    clips_count = 0
    storage_bytes_used: int | None = None
    social_accounts: list[SocialAccountSummary] = []
    scheduled_breakdown: list[ScheduledPostBreakdownRow] = []
    has_active_api_key = False

    if tenant_id:
        videos_count = (
            await db.execute(
                select(func.count()).select_from(AdminVideoView).where(AdminVideoView.tenant_id == tenant_id)
            )
        ).scalar_one()

        video_rows = (
            await db.execute(
                select(AdminVideoView)
                .where(AdminVideoView.tenant_id == tenant_id)
                .order_by(AdminVideoView.created_at.desc())
                .limit(50)
            )
        ).scalars().all()
        videos = [
            VideoSummary(id=v.id, title=v.title, status=v.status, created_at=v.created_at) for v in video_rows
        ]

        clips_count = (
            await db.execute(
                select(func.count()).select_from(AdminClipView).where(AdminClipView.tenant_id == tenant_id)
            )
        ).scalar_one()

        quota = (
            await db.execute(select(UsageQuota).where(UsageQuota.tenant_id == tenant_id))
        ).scalar_one_or_none()
        storage_bytes_used = quota.storage_bytes_used if quota else None

        sa_rows = (
            await db.execute(
                select(AdminSocialAccountView).where(AdminSocialAccountView.tenant_id == tenant_id)
            )
        ).scalars().all()
        social_accounts = [
            SocialAccountSummary(
                platform=sa.platform,
                platform_username=sa.platform_username,
                is_active=sa.is_active,
                connected_at=sa.created_at,
            )
            for sa in sa_rows
        ]

        sp_query = (
            select(AdminScheduledPostView.platform, AdminScheduledPostView.status, func.count())
            .where(AdminScheduledPostView.tenant_id == tenant_id)
            .group_by(AdminScheduledPostView.platform, AdminScheduledPostView.status)
        )
        scheduled_breakdown = [
            ScheduledPostBreakdownRow(platform=platform, status=status_, count=count)
            for platform, status_, count in (await db.execute(sp_query)).all()
        ]

        # TenantApiKey has no active/revoked flag (see shared/models/public/api_key.py) —
        # existence of any key row is the closest available proxy for "uses MCP".
        has_active_api_key = (
            await db.execute(
                select(func.count()).select_from(TenantApiKey).where(TenantApiKey.tenant_id == tenant_id)
            )
        ).scalar_one() > 0

    profile = UserDetailProfile(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        tenant_id=user.tenant_id,
        is_active=user.is_active,
        is_admin=user.is_admin,
        is_superadmin=user.is_superadmin,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        tier=plan_name or "free",
        subscription_status=subscription.status if subscription else None,
        billing_cycle=subscription.billing_cycle if subscription else None,
        current_period_end=subscription.current_period_end if subscription else None,
    )

    return UserDetailResponse(
        profile=profile,
        videos_count=videos_count,
        videos=videos,
        clips_count=clips_count,
        storage_bytes_used=storage_bytes_used,
        social_accounts=social_accounts,
        scheduled_posts_by_platform=scheduled_breakdown,
        has_active_api_key=has_active_api_key,
    )


# ─── Revenue ─────────────────────────────────────────────────────────────────

class RevenueByTierRow(BaseModel):
    tier: str
    mrr: float
    subscriber_count: int


class RevenueSummaryResponse(BaseModel):
    mrr: float
    by_tier: list[RevenueByTierRow]
    upgrades_last_30d: int
    downgrades_last_30d: int
    cancellations_last_30d: int
    change_tracking_note: str


@router.get("/revenue/summary", response_model=RevenueSummaryResponse)
async def revenue_summary(
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    rows = (
        await db.execute(
            select(Plan.name, Subscription.billing_cycle, Plan.price_monthly, Plan.price_yearly)
            .join(Plan, Plan.id == Subscription.plan_id)
            .where(Subscription.status.in_(["active", "trialing"]))
        )
    ).all()

    mrr_by_tier: dict[str, Decimal] = {tier: Decimal("0") for tier in PLAN_TIERS}
    count_by_tier: dict[str, int] = {tier: 0 for tier in PLAN_TIERS}
    total_mrr = Decimal("0")
    for tier, billing_cycle, price_monthly, price_yearly in rows:
        monthly_value = price_yearly / Decimal("12") if billing_cycle == "yearly" else price_monthly
        mrr_by_tier.setdefault(tier, Decimal("0"))
        count_by_tier.setdefault(tier, 0)
        mrr_by_tier[tier] += monthly_value
        count_by_tier[tier] += 1
        total_mrr += monthly_value

    by_tier = [
        RevenueByTierRow(tier=tier, mrr=float(mrr_by_tier[tier]), subscriber_count=count_by_tier[tier])
        for tier in PLAN_TIERS
    ]

    since = datetime.now(timezone.utc) - timedelta(days=30)

    total_events = (await db.execute(select(func.count()).select_from(SubscriptionEvent))).scalar_one()

    event_counts_rows = (
        await db.execute(
            select(SubscriptionEvent.event_type, func.count())
            .where(SubscriptionEvent.created_at >= since)
            .group_by(SubscriptionEvent.event_type)
        )
    ).all()
    event_counts = {event_type: count for event_type, count in event_counts_rows}

    if total_events == 0:
        change_tracking_note = (
            "subscription_events audit log has no rows yet — data collection just "
            "started (see migration 20260819_0001). Counts below are real (0), not "
            "yet-populated history, not a fabricated estimate."
        )
    else:
        change_tracking_note = (
            "Upgrade/downgrade counts are sourced from the subscription_events "
            "audit log (last 30 days). Cancellation count is always 0: there is "
            "no cancellation endpoint or Stripe webhook handler for "
            "customer.subscription.deleted/updated in this codebase yet, so "
            "cancellations are never logged as an event, not because none occurred. "
            "Implementing real cancellation tracking needs that handler added first."
        )

    return RevenueSummaryResponse(
        mrr=float(total_mrr),
        by_tier=by_tier,
        upgrades_last_30d=event_counts.get("upgraded", 0),
        downgrades_last_30d=event_counts.get("downgraded", 0),
        cancellations_last_30d=event_counts.get("cancelled", 0),
        change_tracking_note=change_tracking_note,
    )


# ─── Tier upgrade / downgrade ───────────────────────────────────────────────

class TierChangeRequest(BaseModel):
    plan_name: str


@router.post("/users/{user_id}/tier", response_model=AdminUserRow)
async def change_user_tier(
    user_id: uuid.UUID,
    body: TierChangeRequest,
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    """MANUAL OPS OVERRIDE — NOT a Stripe sync. This only writes plan_id and
    status locally; it never reads or writes stripe_subscription_id /
    stripe_customer_id, so it can't crash on missing Stripe fields, but it
    also grants access without payment and a later Stripe webhook (e.g. a
    renewal or cancellation event) can silently overwrite this back to
    whatever Stripe believes the plan is. Idempotent: re-running with the
    same plan_name is a no-op change. Use only for support/ops corrections,
    never as a substitute for real billing changes (see billing.py)."""
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="User has no workspace/tenant yet — cannot assign a plan")

    plan_result = await db.execute(select(Plan).where(Plan.name == body.plan_name))
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {body.plan_name}")

    sub_result = await db.execute(select(Subscription).where(Subscription.tenant_id == user.tenant_id))
    subscription = sub_result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    from_plan_name: str | None = None
    is_new_subscription = subscription is None
    if subscription:
        old_plan_result = await db.execute(select(Plan.name).where(Plan.id == subscription.plan_id))
        from_plan_name = old_plan_result.scalar_one_or_none()
        subscription.plan_id = plan.id
        subscription.status = "active"
    else:
        subscription = Subscription(
            tenant_id=user.tenant_id,
            plan_id=plan.id,
            status="active",
            billing_cycle="monthly",
            current_period_start=now,
        )
        db.add(subscription)
    await db.commit()
    await db.refresh(subscription)

    # Audit-log this ops override in its own step, after the plan change
    # above is already committed — log_subscription_event never raises, so
    # a logging failure here can't undo or block the tier change that just
    # succeeded.
    try:
        if is_new_subscription:
            event_type = "created"
        elif from_plan_name != plan.name and from_plan_name:
            event_type = (
                "upgraded"
                if PLAN_TIERS.index(plan.name) > PLAN_TIERS.index(from_plan_name)
                else "downgraded"
            )
        else:
            event_type = "renewed"
        await log_subscription_event(
            db,
            tenant_id=user.tenant_id,
            subscription_id=subscription.id,
            event_type=event_type,
            from_plan_name=from_plan_name,
            to_plan_name=plan.name,
        )
    except Exception:
        logger.exception("Failed to log subscription_event for tier change user_id=%s", user_id)

    return AdminUserRow(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        is_admin=user.is_admin,
        is_superadmin=user.is_superadmin,
        tier=plan.name,
        subscription_status=subscription.status,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


# ─── Admin role grant/revoke (superadmin only) ──────────────────────────────

class AdminRoleChangeRequest(BaseModel):
    is_admin: bool


@router.post("/users/{user_id}/admin-role", response_model=AdminUserRow)
async def change_admin_role(
    user_id: uuid.UUID,
    body: AdminRoleChangeRequest,
    db: AsyncSession = Depends(get_db_no_rls),
    superadmin: User = Depends(require_superadmin),
):
    """Grants or revokes is_admin on a target user. Restricted to
    superadmins — regular admins cannot mint or demote other admins.
    Self-modification is blocked to prevent locking out the only
    superadmin/admin session in flight."""
    if user_id == superadmin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own admin role")

    user_result = await db.execute(
        select(User, Subscription.status.label("subscription_status"), Plan.name.label("plan_name"))
        .outerjoin(Subscription, Subscription.tenant_id == User.tenant_id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
        .where(User.id == user_id)
    )
    row = user_result.first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    user, subscription_status, plan_name = row

    user.is_admin = body.is_admin
    if not body.is_admin:
        user.is_superadmin = False
    await db.commit()

    return AdminUserRow(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        is_admin=user.is_admin,
        is_superadmin=user.is_superadmin,
        tier=plan_name or "free",
        subscription_status=subscription_status,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


# ─── Admin notifications ────────────────────────────────────────────────────

class AdminNotificationRow(BaseModel):
    id: uuid.UUID
    type: str
    title: str
    body: str
    related_user_id: uuid.UUID | None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminNotificationListResponse(BaseModel):
    items: list[AdminNotificationRow]
    total: int
    page: int
    per_page: int


@router.get("/notifications", response_model=AdminNotificationListResponse)
async def list_notifications(
    page: int = 1,
    per_page: int = 25,
    type: str | None = None,
    is_read: bool | None = None,
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    per_page = min(max(per_page, 1), 100)
    page = max(page, 1)

    query = select(AdminNotification)
    if type:
        query = query.where(AdminNotification.type == type)
    if is_read is not None:
        query = query.where(AdminNotification.is_read == is_read)

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    rows_result = await db.execute(
        query.order_by(AdminNotification.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    )
    items = [AdminNotificationRow.model_validate(row) for row in rows_result.scalars().all()]
    return AdminNotificationListResponse(items=items, total=total, page=page, per_page=per_page)


class UnreadCountResponse(BaseModel):
    count: int


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
async def unread_notification_count(
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    count = (
        await db.execute(
            select(func.count()).select_from(AdminNotification).where(AdminNotification.is_read.is_(False))
        )
    ).scalar_one()
    return UnreadCountResponse(count=count)


@router.post("/notifications/{notification_id}/read", response_model=AdminNotificationRow)
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(AdminNotification).where(AdminNotification.id == notification_id))
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    notification.is_read = True
    await db.commit()
    await db.refresh(notification)
    return AdminNotificationRow.model_validate(notification)
