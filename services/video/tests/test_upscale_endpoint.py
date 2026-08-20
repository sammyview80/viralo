"""
Real (mocked-IO) test for POST /clips/{clip_id}/upscale.

Exercises the actual FastAPI route end-to-end via ASGITransport: DB lookup,
local-file resolution, ffmpeg subprocess invocation, and storage upload —
only the subprocess and filesystem/storage calls are mocked, everything
else (routing, auth override, response model validation) is real.
"""
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost/")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-only")

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from shared.deps import get_current_user, get_tenant_db
from video.routers import videos
from video.routers.videos import router

app = FastAPI()
app.include_router(router)

CLIP_ID = uuid.uuid4()
TENANT_ID = str(uuid.uuid4())

FAKE_TOKEN = MagicMock()
FAKE_TOKEN.tenant_id = TENANT_ID
FAKE_TOKEN.user_id = str(uuid.uuid4())


def make_clip(storage_url: str | None = "/storage/clips/tenant/source.mp4") -> MagicMock:
    clip = MagicMock()
    clip.id = CLIP_ID
    clip.video_id = uuid.uuid4()
    clip.tenant_id = uuid.UUID(TENANT_ID)
    clip.title = "Test Clip"
    clip.start_ms = 0
    clip.end_ms = 1000
    clip.duration_ms = 1000
    clip.platform = None
    clip.score = None
    clip.status = "ready"
    clip.storage_url = storage_url
    clip.thumbnail_url = None
    clip.caption_srt = None
    clip.clip_metadata = None
    clip.upload_attempts = None
    clip.upload_error = None
    clip.upscaled_storage_url = None
    clip.created_at = "2026-01-01T00:00:00Z"
    clip.scheduled_posts = []
    return clip


def _mock_db(clip: MagicMock):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = clip
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return db


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_upscale_clip_success_runs_ffmpeg_and_uploads(client, tmp_path, monkeypatch):
    """Full happy path: local source resolves, ffmpeg 'succeeds', result uploads."""
    clip = make_clip()
    db = _mock_db(clip)

    # Local storage resolves under LOCAL_STORAGE_DIR/clips/tenant/source.mp4
    storage_root = tmp_path / "storage"
    src_dir = storage_root / "clips" / "tenant"
    src_dir.mkdir(parents=True)
    (src_dir / "source.mp4").write_bytes(b"fake-mp4-bytes")
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(storage_root))
    monkeypatch.setenv("STORAGE_PROVIDER", "local")

    fake_proc = AsyncMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", b""))
    fake_proc.returncode = 0

    fake_storage = AsyncMock()
    fake_storage.upload = AsyncMock(return_value="https://cdn.example.com/upscaled.mp4")

    app.dependency_overrides[get_current_user] = lambda: FAKE_TOKEN
    app.dependency_overrides[get_tenant_db] = lambda: db
    try:
        with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)) as mock_exec, \
             patch("shared.storage.base.get_storage", return_value=fake_storage) as mock_get_storage:
            # ffmpeg writes the "output" file itself in reality; since it's mocked,
            # create the expected out_path so the upload-read step has a real file.
            async def _fake_exec(*args, **kwargs):
                # args[0] is "ffmpeg"; find the output path (last positional arg)
                out_path = args[-1]
                with open(out_path, "wb") as f:
                    f.write(b"fake-upscaled-bytes")
                return fake_proc
            mock_exec.side_effect = _fake_exec

            resp = await client.post(f"/clips/{CLIP_ID}/upscale", params={"target_resolution": "1080p"})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(CLIP_ID)

    # ffmpeg was actually invoked with lanczos scale + expected resolution
    mock_exec.assert_awaited_once()
    ffmpeg_args = mock_exec.call_args.args
    assert ffmpeg_args[0] == "ffmpeg"
    assert "scale=1920:1080:flags=lanczos" in ffmpeg_args

    # storage upload was hit and clip persisted
    fake_storage.upload.assert_awaited_once()
    db.commit.assert_awaited_once()
    assert clip.upscaled_storage_url == "https://cdn.example.com/upscaled.mp4"


@pytest.mark.asyncio
async def test_upscale_clip_404_when_not_found(client):
    db = _mock_db(None)
    app.dependency_overrides[get_current_user] = lambda: FAKE_TOKEN
    app.dependency_overrides[get_tenant_db] = lambda: db
    try:
        resp = await client.post(f"/clips/{CLIP_ID}/upscale")
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_upscale_clip_422_when_no_storage_url(client):
    clip = make_clip(storage_url=None)
    db = _mock_db(clip)
    app.dependency_overrides[get_current_user] = lambda: FAKE_TOKEN
    app.dependency_overrides[get_tenant_db] = lambda: db
    try:
        resp = await client.post(f"/clips/{CLIP_ID}/upscale")
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upscale_clip_500_when_ffmpeg_fails(client, tmp_path, monkeypatch):
    clip = make_clip()
    db = _mock_db(clip)

    storage_root = tmp_path / "storage"
    src_dir = storage_root / "clips" / "tenant"
    src_dir.mkdir(parents=True)
    (src_dir / "source.mp4").write_bytes(b"fake-mp4-bytes")
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(storage_root))
    monkeypatch.setenv("STORAGE_PROVIDER", "local")

    fake_proc = AsyncMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", b"ffmpeg: invalid codec"))
    fake_proc.returncode = 1

    app.dependency_overrides[get_current_user] = lambda: FAKE_TOKEN
    app.dependency_overrides[get_tenant_db] = lambda: db
    try:
        with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)):
            resp = await client.post(f"/clips/{CLIP_ID}/upscale", params={"target_resolution": "4K"})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 500
    assert "ffmpeg" in resp.text.lower()


@pytest.mark.asyncio
async def test_upscale_clip_422_when_local_source_file_missing(client, tmp_path, monkeypatch):
    """clip.storage_url points at local storage but the file isn't actually on disk."""
    clip = make_clip()
    db = _mock_db(clip)

    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path / "empty-storage"))
    monkeypatch.setenv("STORAGE_PROVIDER", "local")

    app.dependency_overrides[get_current_user] = lambda: FAKE_TOKEN
    app.dependency_overrides[get_tenant_db] = lambda: db
    try:
        resp = await client.post(f"/clips/{CLIP_ID}/upscale")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 422
