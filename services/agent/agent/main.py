from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.middleware.tenant import TenantMiddleware
import shared.models.public.tenant  # register Tenant table in SQLAlchemy metadata
from agent.routers import sessions, ws

app = FastAPI(title="Viralo Agent Service", version="0.1.0")

app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/api/v1")
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "agent"}
