import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from shared.config import settings

ALGORITHM = "HS256"


class AdminAuthNotConfigured(RuntimeError):
    """Raised when admin JWT operations are attempted without ADMIN_JWT_SECRET
    set. There is no silent fallback — a derived-from-secret_key value gives
    no real isolation from normal user tokens, which defeats the point."""


def ensure_admin_auth_configured() -> None:
    """Raises AdminAuthNotConfigured unless ADMIN_JWT_SECRET is set to a real
    value distinct from SECRET_KEY. Callable from any endpoint that's about
    to hand out or rely on an admin session — e.g. checked before emailing a
    magic link, so we never send a link guaranteed to fail on verify."""
    if not settings.admin_jwt_secret:
        raise AdminAuthNotConfigured(
            "ADMIN_JWT_SECRET is not set. Admin login is disabled until it is "
            "configured — generate one with: "
            "python -c \"import secrets; print(secrets.token_hex(32))\" "
            "and set ADMIN_JWT_SECRET in the environment. It must be a distinct "
            "value from SECRET_KEY."
        )
    if settings.admin_jwt_secret == settings.secret_key:
        raise AdminAuthNotConfigured(
            "ADMIN_JWT_SECRET is set to the same value as SECRET_KEY. This "
            "defeats the purpose of a separate signing key — anything that can "
            "mint a normal user token could then mint an admin token. Generate "
            "a distinct value with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )


def _admin_secret() -> str:
    ensure_admin_auth_configured()
    return settings.admin_jwt_secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(
    user_id: str,
    tenant_id: str,
    email: str,
    plan: str,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "email": email,
        "plan": plan,
        "type": "access",
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> tuple[str, str]:
    """Returns (token, jti)"""
    jti = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.refresh_token_expire_days)
    payload = {
        "sub": user_id,
        "jti": jti,
        "type": "refresh",
        "iat": now,
        "exp": expire,
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    return token, jti


def decode_token(token: str) -> dict[str, Any]:
    """Raises JWTError on invalid/expired."""
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def create_admin_token(user_id: str, email: str) -> str:
    """Separate token type AND separate signing secret from create_access_token
    — admin sessions have no tenant_id/plan, a longer independently configured
    expiry, and are not forgeable via a secret_key that also signs normal
    user tokens."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.admin_token_expire_minutes)
    payload = {
        "sub": user_id,
        "email": email,
        "type": "admin",
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, _admin_secret(), algorithm=ALGORITHM)


def decode_admin_token(token: str) -> dict[str, Any]:
    """Raises JWTError on invalid/expired. Only accepts tokens signed with
    the admin secret — a normal-user token can never pass this check."""
    return jwt.decode(token, _admin_secret(), algorithms=[ALGORITHM])
