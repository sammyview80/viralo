import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from shared.middleware.tenant import TenantMiddleware
from video.routers import series, videos, viral
from video.routers.render import router as render_router

LOCAL_STORAGE_DIR = os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage")
_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
).split(",") if o.strip()]

app = FastAPI(title="Viralo Video Service", version="0.1.0")

app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(videos.router, prefix="/api/v1/video")
app.include_router(viral.router, prefix="/api/v1/video")
app.include_router(render_router, prefix="/api/v1/video")
app.include_router(series.router, prefix="/api/v1/video")

# Serve local storage files at /storage — created on startup if missing
storage_path = Path(LOCAL_STORAGE_DIR)
storage_path.mkdir(parents=True, exist_ok=True)
app.mount("/storage", StaticFiles(directory=str(storage_path)), name="storage")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "video"}
