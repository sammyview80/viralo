from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis
import uuid

from shared.auth import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
)
from shared.deps import get_current_user, get_db_no_rls, get_redis
from shared.schemas.auth import (
    LoginRequest, RegisterRequest, TokenResponse, TokenPayload, UserResponse,
)
from shared.models.public.user import User
from shared.models.public.tenant import Tenant

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "viralo_refresh"
REFRESH_TOKEN_DAYS = 30
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 900  # 15 minutes


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=False,  # True in production
        samesite="lax",
        max_age=REFRESH_TOKEN_DAYS * 86400,
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path="/api/v1/auth")


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    # Check email unique
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user only — tenant provisioned at onboarding finalize
    user = User(
        tenant_id=None,
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        is_active=True,
        is_verified=False,
        onboarding_step=0,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Issue tokens with empty tenant_id until onboarding complete
    access_token = create_access_token(
        user_id=str(user.id),
        tenant_id="",
        email=user.email,
        plan="free",
    )
    refresh_token, _ = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
):
    # Rate limiting
    ip = request.client.host if request.client else "unknown"
    rate_key = f"login_attempts:{ip}"
    attempts = await redis.incr(rate_key)
    if attempts == 1:
        await redis.expire(rate_key, RATE_LIMIT_WINDOW)
    if attempts > RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in 15 minutes.")

    # Validate credentials
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    # Get plan info
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    # Update last login
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    # Clear rate limit on success
    await redis.delete(rate_key)

    plan = "free"  # resolve from tenant.plan_id in phase 8 (billing)

    access_token = create_access_token(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id) if user.tenant_id else "",
        email=user.email,
        plan=plan,
    )
    refresh_token, _ = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    response: Response,
    db: AsyncSession = Depends(get_db_no_rls),
    redis: aioredis.Redis = Depends(get_redis),
    viralo_refresh: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
):
    if not viralo_refresh:
        raise HTTPException(status_code=401, detail="No refresh token")

    from jose import JWTError
    try:
        payload = decode_token(viralo_refresh)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload["sub"]
    jti = payload["jti"]

    # Check if blacklisted
    blacklisted = await redis.get(f"blacklist:{jti}")
    if blacklisted:
        # Grace window: concurrent tabs/requests often fire simultaneous refreshes.
        # If we issued a new access token for this user within the last 30 s,
        # return it instead of treating this as malicious token reuse.
        cached = await redis.get(f"refresh_grace:{user_id}")
        if cached:
            return TokenResponse(access_token=cached.decode())
        # Second use outside grace window — genuine reuse attack
        await redis.setex(
            f"user:{user_id}:tokens_revoked_at",
            REFRESH_TOKEN_DAYS * 86400,
            datetime.now(timezone.utc).isoformat(),
        )
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Token reuse detected. Please log in again.")

    # Blacklist old jti
    await redis.setex(f"blacklist:{jti}", REFRESH_TOKEN_DAYS * 86400, "1")

    # Get user
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Issue new tokens
    access_token = create_access_token(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id) if user.tenant_id else "",
        email=user.email,
        plan="free",
    )
    new_refresh, _ = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, new_refresh)
    # Cache new access token for 30 s to serve concurrent duplicate refresh requests
    await redis.setex(f"refresh_grace:{user_id}", 30, access_token)
    return TokenResponse(access_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    redis: aioredis.Redis = Depends(get_redis),
    viralo_refresh: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
):
    if viralo_refresh:
        from jose import JWTError
        try:
            payload = decode_token(viralo_refresh)
            jti = payload.get("jti")
            if jti:
                await redis.setex(f"blacklist:{jti}", REFRESH_TOKEN_DAYS * 86400, "1")
        except JWTError:
            pass
    _clear_refresh_cookie(response)


@router.get("/me", response_model=UserResponse)
async def get_me(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_no_rls),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(token.sub)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
