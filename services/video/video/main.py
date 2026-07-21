import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from shared.middleware.tenant import TenantMiddleware
from shared.storage.local import _safe_local_path, verify_local_url
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

storage_path = Path(LOCAL_STORAGE_DIR)
storage_path.mkdir(parents=True, exist_ok=True)


@app.get("/storage/{path:path}", include_in_schema=False)
async def local_storage_file(path: str, expires: int = Query(...), sig: str = Query(...)):
    if not verify_local_url(path, expires, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired media URL")
    file_path = _safe_local_path(path)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(file_path)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "video"}
