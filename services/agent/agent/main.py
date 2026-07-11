import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from shared.middleware.tenant import TenantMiddleware
import shared.models.public.tenant  # register Tenant table in SQLAlchemy metadata
from agent.routers import lyric_videos, sessions, tags, trends, ws

app = FastAPI(title="Viralo Agent Service", version="0.1.0")

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.add_middleware(TenantMiddleware)

app.include_router(sessions.router, prefix="/api/v1/agent")
app.include_router(tags.router, prefix="/api/v1/agent")
app.include_router(trends.router, prefix="/api/v1/agent")
app.include_router(lyric_videos.router, prefix="/api/v1/agent")
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "agent"}
