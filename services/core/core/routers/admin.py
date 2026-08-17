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
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.routers.auth import _client_ip
from shared.auth import AdminAuthNotConfigured, create_admin_token, decode_admin_token, ensure_admin_auth_configured
from shared.config import settings
from shared.deps import get_db_no_rls, get_redis
from shared.email import send_email
from shared.models.public.admin_magic_link import AdminMagicLink
from shared.models.public.plan import Plan
from shared.models.public.subscription import Subscription
from shared.models.public.user import User

router = APIRouter(prefix="/admin", tags=["admin"])

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
    db: AsyncSession = Depends(get_db_no_rls),
    _admin: User = Depends(require_admin),
):
    per_page = min(max(per_page, 1), 100)
    page = max(page, 1)

    query = (
        select(
            User,
            Subscription.status.label("subscription_status"),
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
            created_at=user.created_at,
            last_login_at=user.last_login_at,
        )
        for user, subscription_status, plan_name in rows_result.all()
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
    by_tier = {tier: count for tier, count in (await db.execute(tier_query)).all()}

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
    if subscription:
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
