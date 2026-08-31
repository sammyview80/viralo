import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.middleware.tenant import TenantMiddleware
from platform_svc.crypto import validate_encryption_key_at_startup
from platform_svc.routers import social_accounts, scheduling, notifications, analytics, push, websub

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
).split(",") if o.strip()]

app = FastAPI(title="Viralo Platform Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.add_middleware(TenantMiddleware)

app.include_router(social_accounts.router, prefix="/api/v1/platform")
app.include_router(scheduling.router, prefix="/api/v1/platform")
app.include_router(notifications.router, prefix="/api/v1/platform")
app.include_router(analytics.router, prefix="/api/v1/platform")
app.include_router(push.router, prefix="/api/v1/platform")
app.include_router(websub.router, prefix="/api/v1/platform")


@app.on_event("startup")
async def _check_encryption_key() -> None:
    # Fail fast at boot rather than 500ing the first oauth-token endpoint hit
    # (e.g. TikTok connect) when ENCRYPTION_KEY is unset/blank in the env.
    validate_encryption_key_at_startup()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "platform"}
