import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.middleware.tenant import TenantMiddleware
from core.routers import auth, tenants, onboarding, billing, mcp, settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import sys
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "alembic", "upgrade", "head",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        logger.error("Migration failed:\n%s", stderr.decode())
        raise RuntimeError("Alembic migration failed — aborting startup")
    logger.info("Migrations applied:\n%s", stdout.decode() or "(already up to date)")
    yield


app = FastAPI(title="Viralo Core Service", version="0.1.0", lifespan=lifespan)

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
).split(",") if o.strip()]

app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(tenants.router, prefix="/api/v1")
app.include_router(onboarding.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(settings.router, prefix="/api/v1")
app.include_router(mcp.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "core"}
