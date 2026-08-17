import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from shared.db import engine
from shared.middleware.tenant import TenantMiddleware
from core.routers import auth, tenants, onboarding, billing, mcp, settings, device_auth, admin

logger = logging.getLogger(__name__)

# Fixed, arbitrary 64-bit key identifying "core service migration lock" in
# pg_locks. Any int works as long as it's unique among advisory-lock users on
# this DB — no meaning beyond that.
_MIGRATION_LOCK_KEY = 7825190041294

# Max time to wait for the migration lock before giving up (another worker
# holding it for longer than this means something is actually stuck, not
# just slow — better to fail loudly than hang the deploy forever).
_MIGRATION_LOCK_TIMEOUT_S = 120
# Max time to let the alembic subprocess itself run before killing it, so a
# hung migration can't hold the lock (and therefore block every other
# worker) indefinitely.
_MIGRATION_SUBPROCESS_TIMEOUT_S = 300

# TODO(follow-up, out of scope for this PR): running `alembic upgrade head`
# from app startup is a workaround, not the correct long-term fix. Production
# runs `uvicorn --workers 2`, so every worker independently races to run this
# migration on boot; the advisory lock below only serializes that race, it
# doesn't remove it. The correct fix is to move `alembic upgrade head` out of
# the app entirely into a one-time deploy step (init container, pre-deploy
# CI/CD job, or entrypoint script run once before uvicorn starts) so app
# processes never touch schema migrations at all. Needs a deploy-pipeline
# change, tracked separately in TODO.md.


@asynccontextmanager
async def lifespan(app: FastAPI):
    import sys

    # Serialize `alembic upgrade head` across concurrent uvicorn workers with
    # a Postgres session-level advisory lock, so only one worker actually
    # runs the migration; the loser(s) wait, then find head already applied
    # (no-op) once they get the lock.
    #
    # Uses pg_try_advisory_lock in a poll loop, NOT the blocking
    # pg_advisory_lock. A blocking pg_advisory_lock call holds its own
    # in-flight transaction/snapshot open for as long as it's waiting — and
    # this codebase has a migration that runs `CREATE INDEX CONCURRENTLY`,
    # which must wait for every open transaction in the DB before it can
    # proceed. A worker blocked inside pg_advisory_lock becomes exactly such
    # a transaction, so it and the winner's CONCURRENTLY index build wait on
    # each other forever — verified this deadlocks with a real Postgres
    # instance. Polling with the non-blocking try-lock avoids it: each poll
    # is a fast, self-contained statement, so the connection is genuinely
    # idle between attempts and never blocks CONCURRENTLY.
    #
    # AUTOCOMMIT also matters here: without it, engine.connect() opens an
    # implicit transaction that persists across statements on the same
    # connection, which reintroduces the same problem for the lock holder's
    # own alembic run.
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")

        deadline = asyncio.get_event_loop().time() + _MIGRATION_LOCK_TIMEOUT_S
        while True:
            got_lock = (
                await conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _MIGRATION_LOCK_KEY})
            ).scalar()
            if got_lock is True:
                break
            if got_lock is not False:
                # pg_try_advisory_lock only ever returns true/false for a
                # non-null bigint key. Anything else (including None) means
                # something is badly wrong (bad connection, unexpected
                # driver behavior) — fail loudly rather than retry forever.
                raise RuntimeError(f"Unexpected pg_try_advisory_lock result: {got_lock!r}")
            if asyncio.get_event_loop().time() >= deadline:
                raise RuntimeError(
                    f"Timed out after {_MIGRATION_LOCK_TIMEOUT_S}s waiting for migration lock "
                    "— another worker may be stuck running migrations"
                )
            await asyncio.sleep(0.5)

        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "alembic", "upgrade", "head",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=_MIGRATION_SUBPROCESS_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                raise RuntimeError(
                    f"Alembic migration did not finish within {_MIGRATION_SUBPROCESS_TIMEOUT_S}s — killed"
                )
            if proc.returncode != 0:
                logger.error("Migration failed:\n%s", stderr.decode())
                raise RuntimeError("Alembic migration failed — aborting startup")
            logger.info("Migrations applied:\n%s", stdout.decode() or "(already up to date)")
        finally:
            try:
                await conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK_KEY})
            except Exception:
                # Best-effort: if unlock itself fails, don't return this
                # connection to the pool still holding the session-level
                # lock. conn.close() only returns it to SQLAlchemy's pool —
                # it does NOT reliably terminate the actual Postgres
                # session, so the lock could persist. invalidate() forces
                # the underlying DBAPI connection to be discarded instead
                # of pooled, which does drop the Postgres session (and with
                # it, every advisory lock that session held).
                logger.exception("Failed to release migration advisory lock; invalidating connection")
                await conn.invalidate()
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
app.include_router(device_auth.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "core"}
