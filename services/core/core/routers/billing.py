import hmac
import os
import uuid
from datetime import datetime, timezone

from typing import Literal

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_db_no_rls
from shared.models.public.plan import Plan
from shared.models.public.subscription import Subscription
from shared.models.public.usage_quota import UsageQuota
from shared.schemas.auth import TokenPayload
from shared.subscription_events import log_subscription_event

router = APIRouter(prefix="/billing", tags=["billing"])

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
ESEWA_MERCHANT_ID = os.getenv("ESEWA_MERCHANT_ID", "EPAYTEST")
ESEWA_QR_URL = os.getenv("ESEWA_QR_URL", "https://esewa.com.np/epay/main")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
USD_TO_NPR = 133

PLAN_ORDER = ["free", "starter", "pro", "creator", "unlimited"]


class CheckoutRequest(BaseModel):
    plan_name: str
    billing_cycle: Literal["monthly", "yearly"] = "monthly"


class EsewaVerifyRequest(BaseModel):
    tenant_id: str | None = None
    plan_name: str
    reference: str


async def _upsert_subscription(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    plan_id: uuid.UUID,
    billing_cycle: str,
    *,
    stripe_subscription_id: str | None = None,
    stripe_customer_id: str | None = None,
) -> None:
    # Snapshot the prior plan/subscription (for the subscription_events audit
    # log) before the upsert overwrites it — this must be read first, there's
    # no way to recover the "from" plan after the UPDATE lands.
    existing_result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    existing_sub = existing_result.scalar_one_or_none()
    from_plan_name: str | None = None
    if existing_sub:
        old_plan_result = await db.execute(select(Plan.name).where(Plan.id == existing_sub.plan_id))
        from_plan_name = old_plan_result.scalar_one_or_none()

    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "tenant_id": tenant_id,
        "plan_id": plan_id,
        "status": "active",
        "billing_cycle": billing_cycle,
        "current_period_start": datetime.now(timezone.utc),
    }
    if stripe_subscription_id is not None:
        values["stripe_subscription_id"] = stripe_subscription_id
    if stripe_customer_id is not None:
        values["stripe_customer_id"] = stripe_customer_id

    updates = {key: value for key, value in values.items() if key not in {"id", "tenant_id"}}
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.execute(
        pg_insert(Subscription)
        .values(**values)
        .on_conflict_do_update(index_elements=[Subscription.tenant_id], set_=updates)
    )
    await db.commit()

    # Audit-log the change in its own commit, after the subscription change
    # is already durably committed above — a failure here (or inside
    # log_subscription_event, which never raises) can't roll back or block
    # the subscription mutation that just succeeded.
    try:
        to_plan_result = await db.execute(select(Plan.name).where(Plan.id == plan_id))
        to_plan_name = to_plan_result.scalar_one_or_none()

        sub_id_result = await db.execute(select(Subscription.id).where(Subscription.tenant_id == tenant_id))
        subscription_id = sub_id_result.scalar_one_or_none()
        if subscription_id is None:
            return

        if not existing_sub:
            event_type = "created"
        elif from_plan_name != to_plan_name and from_plan_name and to_plan_name:
            event_type = (
                "upgraded"
                if PLAN_ORDER.index(to_plan_name) > PLAN_ORDER.index(from_plan_name)
                else "downgraded"
            )
        else:
            event_type = "renewed"

        await log_subscription_event(
            db,
            tenant_id=tenant_id,
            subscription_id=subscription_id,
            event_type=event_type,
            from_plan_name=from_plan_name,
            to_plan_name=to_plan_name,
        )
    except Exception:
        pass


@router.get("/plans")
async def list_plans(db: AsyncSession = Depends(get_db_no_rls)):
    result = await db.execute(select(Plan))
    plans = result.scalars().all()
    plans_sorted = sorted(plans, key=lambda p: PLAN_ORDER.index(p.name) if p.name in PLAN_ORDER else 99)
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "price_monthly": float(p.price_monthly),
            "price_yearly": float(p.price_yearly),
            "videos_per_month": p.videos_per_month,
            "storage_gb": p.storage_gb,
            "platforms_allowed": p.platforms_allowed,
            "brainstorm_sessions": p.brainstorm_sessions,
            "workflows_allowed": p.workflows_allowed,
            "voice_clone": p.voice_clone,
            "custom_llm_key": p.custom_llm_key,
            "team_members": p.team_members,
        }
        for p in plans_sorted
    ]


@router.get("/subscription")
async def get_subscription(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    if not token.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant associated with account")

    tenant_id = uuid.UUID(str(token.tenant_id))
    sub_result = await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id).limit(1)
    )
    sub = sub_result.scalar_one_or_none()

    quota_result = await db.execute(
        select(UsageQuota).where(UsageQuota.tenant_id == tenant_id)
    )
    quota = quota_result.scalar_one_or_none()
    videos_used = quota.videos_used if quota else 0
    storage_bytes_used = quota.storage_bytes_used if quota else 0
    brainstorm_used = quota.brainstorm_used if quota else 0

    if not sub:
        plan_result = await db.execute(select(Plan).where(Plan.name == "free"))
        plan = plan_result.scalar_one_or_none()
        return {
            "plan_name": plan.name if plan else "free",
            "status": "active",
            "billing_cycle": "monthly",
            "current_period_end": None,
            "cancel_at_period_end": False,
            "videos_used": videos_used,
            "storage_bytes_used": storage_bytes_used,
            "brainstorm_used": brainstorm_used,
        }

    plan_result = await db.execute(select(Plan).where(Plan.id == sub.plan_id))
    plan = plan_result.scalar_one_or_none()

    return {
        "plan_name": plan.name if plan else "free",
        "status": sub.status,
        "billing_cycle": sub.billing_cycle,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "cancel_at_period_end": sub.cancel_at_period_end,
        "videos_used": videos_used,
        "storage_bytes_used": storage_bytes_used,
        "brainstorm_used": brainstorm_used,
    }


@router.post("/checkout")
async def create_checkout(
    body: CheckoutRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    if not token.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant associated with account")

    plan_result = await db.execute(select(Plan).where(Plan.name == body.plan_name))
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    stripe.api_key = STRIPE_SECRET_KEY
    price_id = plan.stripe_price_id_mo if body.billing_cycle == "monthly" else plan.stripe_price_id_yr
    amount_cents = int(float(plan.price_monthly if body.billing_cycle == "monthly" else plan.price_yearly) * 100)

    if price_id:
        line_items = [{"price": price_id, "quantity": 1}]
    else:
        line_items = [{
            "price_data": {
                "currency": "usd",
                "unit_amount": amount_cents,
                "recurring": {"interval": "month" if body.billing_cycle == "monthly" else "year"},
                "product_data": {"name": f"Viralo {plan.name.capitalize()} Plan"},
            },
            "quantity": 1,
        }]

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=line_items,
        success_url=f"{FRONTEND_URL}/billing?success=1&plan={body.plan_name}&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{FRONTEND_URL}/billing?cancelled=1",
        metadata={
            "tenant_id": str(token.tenant_id),
            "plan_id": str(plan.id),
            "billing_cycle": body.billing_cycle,
        },
    )
    return {"checkout_url": session.url, "session_id": session.id}


@router.post("/confirm")
async def confirm_checkout(
    request: Request,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    """Verify a Stripe checkout session and update the subscription.
    Called by frontend on success redirect when webhook may not have fired yet."""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id or not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=400, detail="session_id required")

    stripe.api_key = STRIPE_SECRET_KEY
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if session.get("payment_status") not in ("paid", "no_payment_required"):
        raise HTTPException(status_code=402, detail="Payment not completed")

    metadata = session.get("metadata", {})
    tenant_id_str = metadata.get("tenant_id")
    plan_id_str = metadata.get("plan_id")
    billing_cycle = metadata.get("billing_cycle", "monthly")

    # Verify session belongs to requesting tenant
    if not tenant_id_str or str(token.tenant_id) != tenant_id_str:
        raise HTTPException(status_code=403, detail="Session does not belong to your account")
    if not plan_id_str:
        raise HTTPException(status_code=400, detail="Invalid checkout session: missing plan")

    try:
        tenant_id = uuid.UUID(tenant_id_str)
        plan_id = uuid.UUID(plan_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid checkout session metadata")
    stripe_sub_id = session.get("subscription")
    stripe_customer_id = session.get("customer")

    await _upsert_subscription(
        db, tenant_id, plan_id, billing_cycle,
        stripe_subscription_id=stripe_sub_id,
        stripe_customer_id=stripe_customer_id,
    )
    await db.commit()

    plan_result = await db.execute(select(Plan).where(Plan.id == plan_id))
    plan = plan_result.scalar_one_or_none()
    return {"status": "ok", "plan": plan.name if plan else "unknown"}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db_no_rls)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    stripe.api_key = STRIPE_SECRET_KEY
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        tenant_id_str = metadata.get("tenant_id")
        plan_id_str = metadata.get("plan_id")
        billing_cycle = metadata.get("billing_cycle", "monthly")

        if not tenant_id_str or not plan_id_str:
            return {"status": "ignored"}

        try:
            tenant_id = uuid.UUID(tenant_id_str)
            plan_id = uuid.UUID(plan_id_str)
        except ValueError:
            return {"status": "ignored"}
        stripe_sub_id = session.get("subscription")
        stripe_customer_id = session.get("customer")

        await _upsert_subscription(
            db, tenant_id, plan_id, billing_cycle,
            stripe_subscription_id=stripe_sub_id,
            stripe_customer_id=stripe_customer_id,
        )
        await db.commit()

    return {"status": "ok"}


@router.get("/esewa-qr")
async def esewa_qr(
    plan_name: str,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    if not token.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant associated with account")

    plan_result = await db.execute(select(Plan).where(Plan.name == plan_name))
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    amount_npr = int(float(plan.price_monthly) * USD_TO_NPR)
    tenant_short = str(token.tenant_id).replace("-", "")[:8]
    product_id = f"{plan.name}_{tenant_short}"

    return {
        "merchant_id": ESEWA_MERCHANT_ID,
        "amount": amount_npr,
        "product_id": product_id,
        "qr_url": ESEWA_QR_URL,
        "instructions": "Scan QR or use merchant ID to pay via eSewa. Send screenshot to support for verification.",
    }


@router.post("/esewa-verify")
async def esewa_verify(
    body: EsewaVerifyRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    x_esewa_verify_secret: str | None = Header(default=None, alias="X-Esewa-Verify-Secret"),
):
    if not token.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant associated with account")

    tenant_id = uuid.UUID(str(token.tenant_id))
    if body.tenant_id and str(tenant_id) != str(uuid.UUID(body.tenant_id)):
        raise HTTPException(status_code=403, detail="Cannot verify payment for another tenant")

    manual_secret = os.getenv("ESEWA_MANUAL_VERIFY_SECRET")
    if not manual_secret or not x_esewa_verify_secret or not hmac.compare_digest(x_esewa_verify_secret, manual_secret):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="eSewa payments require server-side verification before activation.",
        )

    plan_result = await db.execute(select(Plan).where(Plan.name == body.plan_name))
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    await _upsert_subscription(db, tenant_id, plan.id, "monthly")
    await db.commit()
    return {"status": "ok", "plan": plan.name, "reference": body.reference}
