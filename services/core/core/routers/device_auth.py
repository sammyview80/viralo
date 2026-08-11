"""OAuth-style device authorization flow for the Viralo CLI (RFC 8628-inspired).

Flow:
1. CLI: POST /device/code (no auth) -> {device_code, user_code, verification_uri, ...}
2. CLI: opens verification_uri_complete in the user's browser, starts polling /device/token
3. Browser: user is already logged in to Viralo; POSTs /device/approve {user_code} with their session
4. CLI: next poll of /device/token returns the minted API key (once, then it's consumed)

State lives in Redis with a short TTL — this is a short-lived handshake, not persistent data.
"""
import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_db_no_rls, get_redis
from shared.models.public.api_key import TenantApiKey
from shared.schemas.auth import TokenPayload

router = APIRouter(prefix="/device", tags=["device-auth"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
DEVICE_CODE_TTL_SECONDS = 600  # 10 min to complete the flow
APPROVED_KEY_TTL_SECONDS = 120  # once approved, CLI has 2 min to collect the key
POLL_INTERVAL_SECONDS = 5

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars (0/O, 1/I/L)


def _generate_user_code() -> str:
    return "-".join("".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(2))


def _device_key(device_code: str) -> str:
    return f"device_auth:{device_code}"


def _user_code_key(user_code: str) -> str:
    return f"device_auth_code:{user_code}"


class DeviceCodeResponse(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


class DeviceTokenRequest(BaseModel):
    device_code: str


class DeviceApproveRequest(BaseModel):
    user_code: str


@router.post("/code", response_model=DeviceCodeResponse)
async def create_device_code(redis: aioredis.Redis = Depends(get_redis)):
    device_code = secrets.token_urlsafe(32)
    user_code = _generate_user_code()

    state = {"status": "pending", "user_code": user_code}
    await redis.set(_device_key(device_code), json.dumps(state), ex=DEVICE_CODE_TTL_SECONDS)
    await redis.set(_user_code_key(user_code), device_code, ex=DEVICE_CODE_TTL_SECONDS)

    return DeviceCodeResponse(
        device_code=device_code,
        user_code=user_code,
        verification_uri=f"{FRONTEND_URL}/cli-auth",
        verification_uri_complete=f"{FRONTEND_URL}/cli-auth?code={user_code}",
        expires_in=DEVICE_CODE_TTL_SECONDS,
        interval=POLL_INTERVAL_SECONDS,
    )


@router.post("/approve", status_code=204)
async def approve_device_code(
    body: DeviceApproveRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Called by the logged-in web app once the user confirms the code shown by the CLI."""
    user_code = body.user_code.strip().upper()
    device_code = await redis.get(_user_code_key(user_code))
    if not device_code:
        raise HTTPException(status_code=404, detail="Code not found or expired")

    raw_key = f"vk_live_{secrets.token_hex(16)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8] + "…" + raw_key[-4:]

    db.add(TenantApiKey(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(token.tenant_id),
        name="CLI",
        key_prefix=key_prefix,
        key_hash=key_hash,
        created_at=datetime.now(timezone.utc),
    ))
    await db.commit()

    state = {"status": "approved", "user_code": user_code, "api_key": raw_key}
    await redis.set(_device_key(device_code), json.dumps(state), ex=APPROVED_KEY_TTL_SECONDS)
    await redis.delete(_user_code_key(user_code))


@router.post("/token")
async def poll_device_token(
    body: DeviceTokenRequest,
    redis: aioredis.Redis = Depends(get_redis),
):
    """CLI polls this until the user approves. Single-use: the key is returned once."""
    raw_state = await redis.get(_device_key(body.device_code))
    if not raw_state:
        raise HTTPException(status_code=400, detail="expired_token")

    state = json.loads(raw_state)
    if state["status"] == "pending":
        return {"status": "pending"}

    await redis.delete(_device_key(body.device_code))
    return {"status": "approved", "api_key": state["api_key"]}
