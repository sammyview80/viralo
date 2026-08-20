import hashlib
import os
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_db_no_rls
from shared.models.public.api_key import TenantApiKey
from shared.models.public.tenant import Tenant
from shared.schemas.auth import TokenPayload

router = APIRouter(prefix="/settings", tags=["settings"])


# ── Brand kit ────────────────────────────────────────────────────────────────

DEFAULT_BRAND_KIT = {
    "primary_color": "#ff3d6a",
    "secondary_color": "#1e2a3a",
    "font": "Inter",
    "watermark_url": None,
}

DEFAULT_NOTIFICATION_PREFS = {
    "uploads_complete": True,
    "clip_ready": True,
    "team_activity": False,
    "weekly_digest": True,
    "billing_alerts": True,
    "product_updates": False,
}


class BrandKitUpdate(BaseModel):
    primary_color: str | None = None
    secondary_color: str | None = None
    font: str | None = None
    watermark_url: str | None = None


class NotificationPrefsUpdate(BaseModel):
    uploads_complete: bool | None = None
    clip_ready: bool | None = None
    team_activity: bool | None = None
    weekly_digest: bool | None = None
    billing_alerts: bool | None = None
    product_updates: bool | None = None


@router.get("/brand-kit")
async def get_brand_kit(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {**DEFAULT_BRAND_KIT, **(tenant.brand_kit or {})}


@router.patch("/brand-kit")
async def update_brand_kit(
    body: BrandKitUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    current = {**DEFAULT_BRAND_KIT, **(tenant.brand_kit or {})}
    updates = body.model_dump(exclude_none=True)
    tenant.brand_kit = {**current, **updates}
    await db.commit()
    return tenant.brand_kit


# ── Notification preferences ─────────────────────────────────────────────────

@router.get("/notification-prefs")
async def get_notification_prefs(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {**DEFAULT_NOTIFICATION_PREFS, **(tenant.notification_prefs or {})}


@router.patch("/notification-prefs")
async def update_notification_prefs(
    body: NotificationPrefsUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    current = {**DEFAULT_NOTIFICATION_PREFS, **(tenant.notification_prefs or {})}
    updates = body.model_dump(exclude_none=True)
    tenant.notification_prefs = {**current, **updates}
    await db.commit()
    return tenant.notification_prefs


# ── Webhooks ──────────────────────────────────────────────────────────────────

DEFAULT_WEBHOOK_CONFIG = {
    "url": None,
    "enabled": False,
}


class WebhookConfigUpdate(BaseModel):
    url: str | None = None
    enabled: bool | None = None


@router.get("/webhook")
async def get_webhook_config(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    current = {**DEFAULT_WEBHOOK_CONFIG, **(tenant.webhook_config or {})}
    current.pop("secret", None)  # never echo the signing secret back
    current["secret_set"] = bool((tenant.webhook_config or {}).get("secret"))
    return current


@router.patch("/webhook")
async def update_webhook_config(
    body: WebhookConfigUpdate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    if body.url is not None and body.url and not (body.url.startswith("https://") or body.url.startswith("http://")):
        raise HTTPException(status_code=400, detail="webhook url must be http(s)")

    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    current = {**DEFAULT_WEBHOOK_CONFIG, **(tenant.webhook_config or {})}
    updates = body.model_dump(exclude_none=True)
    current.update(updates)
    tenant.webhook_config = current
    await db.commit()

    out = {**current}
    out.pop("secret", None)
    out["secret_set"] = bool(current.get("secret"))
    return out


@router.post("/webhook/rotate-secret")
async def rotate_webhook_secret(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(Tenant).where(Tenant.id == uuid.UUID(token.tenant_id)))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    new_secret = f"whsec_{secrets.token_hex(24)}"
    current = {**DEFAULT_WEBHOOK_CONFIG, **(tenant.webhook_config or {})}
    current["secret"] = new_secret
    tenant.webhook_config = current
    await db.commit()

    return {"secret": new_secret}  # shown once only


# ── API keys ─────────────────────────────────────────────────────────────────

class ApiKeyCreate(BaseModel):
    name: str


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    created_at: str
    last_used_at: str | None


@router.get("/api-keys", response_model=list[ApiKeyResponse])
async def list_api_keys(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(
        select(TenantApiKey)
        .where(TenantApiKey.tenant_id == uuid.UUID(token.tenant_id))
        .order_by(TenantApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return [
        ApiKeyResponse(
            id=str(k.id),
            name=k.name,
            key_prefix=k.key_prefix,
            created_at=k.created_at.isoformat(),
            last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
        )
        for k in keys
    ]


@router.post("/api-keys")
async def create_api_key(
    body: ApiKeyCreate,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    raw_key = f"vk_live_{secrets.token_hex(16)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8] + "…" + raw_key[-4:]  # e.g. vk_live_…2b52 (16 chars max)

    api_key = TenantApiKey(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(token.tenant_id),
        name=body.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        created_at=datetime.now(timezone.utc),
    )
    db.add(api_key)
    await db.commit()

    return {
        "id": str(api_key.id),
        "name": api_key.name,
        "key_prefix": key_prefix,
        "key": raw_key,  # shown once only
        "created_at": api_key.created_at.isoformat(),
    }


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: str,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(
        select(TenantApiKey).where(
            TenantApiKey.id == uuid.UUID(key_id),
            TenantApiKey.tenant_id == uuid.UUID(token.tenant_id),
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    await db.delete(key)
    await db.commit()
