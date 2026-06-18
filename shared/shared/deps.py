from typing import AsyncGenerator
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import redis.asyncio as aioredis

from shared.auth import decode_token
from shared.config import settings
from shared.db import AsyncSessionLocal
from shared.schemas.auth import TokenPayload

bearer_scheme = HTTPBearer()

_redis_pool: aioredis.Redis | None = None


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(settings.redis_url, decode_responses=True)
    yield _redis_pool


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> TokenPayload:
    token = credentials.credentials
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return TokenPayload(**payload)


async def get_tenant_db(
    token: TokenPayload = Depends(get_current_user),
) -> AsyncGenerator[AsyncSession, None]:
    from fastapi import HTTPException as _HTTPException
    if not token.tenant_id:
        raise _HTTPException(status_code=403, detail="Onboarding incomplete — no workspace associated with this account")
    async with AsyncSessionLocal() as session:
        try:
            # PostgreSQL SET doesn't support bind params — UUID is safe to embed directly
            tid = str(token.tenant_id)
            await session.execute(text("SELECT set_config('app.current_tenant', :tid, true)"), {"tid": tid})
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db_no_rls() -> AsyncGenerator[AsyncSession, None]:
    """Unauthenticated DB access for auth endpoints (register/login). No RLS set."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
