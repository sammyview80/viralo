"""
End-to-end tests for PATCH/GET /clips/{clip_id}/editor endpoints.

These tests exercise the schema validation and business logic without
hitting a live database — they mock the DB session and token dependency.
"""
import os
import uuid
from unittest.mock import AsyncMock, MagicMock

# Provide required settings before any shared imports resolve config
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost/")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-only")

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from shared.deps import get_current_user, get_tenant_db
from video.routers.videos import router
from video.schemas import EditorDataRequest, EditorCaption, EditorMarker


# ── Minimal FastAPI app wired to the router ──────────────────────────────────

app = FastAPI()
app.include_router(router)


# ── Fixtures ─────────────────────────────────────────────────────────────────

CLIP_ID = uuid.uuid4()
TENANT_ID = str(uuid.uuid4())

FAKE_TOKEN = MagicMock()
FAKE_TOKEN.tenant_id = TENANT_ID
FAKE_TOKEN.user_id = str(uuid.uuid4())


def make_clip(editor_meta: dict | None = None) -> MagicMock:
    clip = MagicMock()
    clip.id = CLIP_ID
    clip.tenant_id = uuid.UUID(TENANT_ID)
    clip.status = "ready"
    clip.clip_metadata = {"editor": editor_meta} if editor_meta else {}
    return clip


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── Helpers ──────────────────────────────────────────────────────────────────

SAMPLE_EDITOR_PAYLOAD = {
    "trim_start_sec": 5.0,
    "trim_end_sec": 30.0,
    "captions": [
        {
            "id": "c1",
            "text": "Hello world",
            "start_sec": 5.0,
            "end_sec": 10.0,
            "position": "bottom",
            "color": "#ffffff",
            "font_size": 24,
        }
    ],
    "markers": [
        {
            "id": "m1",
            "time_ms": 7000.0,
            "sound": "quack",
            "emoji": "🦆",
            "label": "Quack",
        }
    ],
}


def _mock_db(clip: MagicMock):
    """Return a mock AsyncSession that returns `clip` on scalar_one_or_none."""
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = clip
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return db


# ── Schema unit tests ─────────────────────────────────────────────────────────

class TestEditorDataRequest:
    def test_defaults(self):
        req = EditorDataRequest()
        assert req.trim_start_sec == 0
        assert req.trim_end_sec is None
        assert req.captions == []
        assert req.markers == []

    def test_caption_validation(self):
        cap = EditorCaption(
            id="x",
            text="hi",
            start_sec=0,
            end_sec=5,
            position="top",
            color="#ff0000",
            font_size=32,
        )
        assert cap.font_size == 32
        assert cap.position == "top"

    def test_caption_font_size_bounds(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            EditorCaption(id="x", text="t", start_sec=0, end_sec=1, position="top", color="#fff", font_size=100)

    def test_marker_validation(self):
        m = EditorMarker(id="m1", time_ms=5000, sound="ding", emoji="🔔", label="Ding")
        assert m.time_ms == 5000

    def test_trim_negative_start_rejected(self):
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            EditorDataRequest(trim_start_sec=-1)

    def test_full_round_trip(self):
        req = EditorDataRequest(**SAMPLE_EDITOR_PAYLOAD)
        dumped = req.model_dump()
        assert dumped["trim_start_sec"] == 5.0
        assert len(dumped["captions"]) == 1
        assert len(dumped["markers"]) == 1
        restored = EditorDataRequest(**dumped)
        assert restored.captions[0].text == "Hello world"


# ── Endpoint integration tests ────────────────────────────────────────────────

def _set_deps(db):
    """Override FastAPI DI for auth + DB. Returns cleanup callable."""
    async def fake_token():
        return FAKE_TOKEN

    async def fake_db():
        yield db

    app.dependency_overrides[get_current_user] = fake_token
    app.dependency_overrides[get_tenant_db] = fake_db

    def cleanup():
        app.dependency_overrides.clear()

    return cleanup


class TestSaveEditorData:
    @pytest.mark.asyncio
    async def test_save_persists_editor_data(self, client):
        clip = make_clip()
        db = _mock_db(clip)
        cleanup = _set_deps(db)
        try:
            resp = await client.patch(
                f"/clips/{CLIP_ID}/editor",
                json=SAMPLE_EDITOR_PAYLOAD,
            )
        finally:
            cleanup()

        assert resp.status_code == 200
        body = resp.json()
        assert body["clip_id"] == str(CLIP_ID)
        assert body["editor"]["trim_start_sec"] == 5.0
        assert body["editor"]["trim_end_sec"] == 30.0
        assert len(body["editor"]["captions"]) == 1
        assert body["editor"]["captions"][0]["text"] == "Hello world"
        assert len(body["editor"]["markers"]) == 1
        assert body["editor"]["markers"][0]["sound"] == "quack"
        db.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_save_returns_404_when_clip_missing(self, client):
        db = _mock_db(None)
        cleanup = _set_deps(db)
        try:
            resp = await client.patch(
                f"/clips/{CLIP_ID}/editor",
                json=SAMPLE_EDITOR_PAYLOAD,
            )
        finally:
            cleanup()

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_save_rejects_negative_trim_start(self, client):
        db = _mock_db(make_clip())
        cleanup = _set_deps(db)
        try:
            resp = await client.patch(
                f"/clips/{CLIP_ID}/editor",
                json={**SAMPLE_EDITOR_PAYLOAD, "trim_start_sec": -5},
            )
        finally:
            cleanup()

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_save_empty_payload_uses_defaults(self, client):
        clip = make_clip()
        db = _mock_db(clip)
        cleanup = _set_deps(db)
        try:
            resp = await client.patch(
                f"/clips/{CLIP_ID}/editor",
                json={},
            )
        finally:
            cleanup()

        assert resp.status_code == 200
        body = resp.json()
        assert body["editor"]["trim_start_sec"] == 0
        assert body["editor"]["captions"] == []
        assert body["editor"]["markers"] == []


class TestGetEditorData:
    @pytest.mark.asyncio
    async def test_get_returns_saved_editor(self, client):
        clip = make_clip(editor_meta=SAMPLE_EDITOR_PAYLOAD)
        db = _mock_db(clip)
        cleanup = _set_deps(db)
        try:
            resp = await client.get(f"/clips/{CLIP_ID}/editor")
        finally:
            cleanup()

        assert resp.status_code == 200
        body = resp.json()
        assert body["editor"]["trim_start_sec"] == 5.0
        assert body["editor"]["captions"][0]["text"] == "Hello world"

    @pytest.mark.asyncio
    async def test_get_returns_defaults_when_no_editor_saved(self, client):
        clip = make_clip()
        db = _mock_db(clip)
        cleanup = _set_deps(db)
        try:
            resp = await client.get(f"/clips/{CLIP_ID}/editor")
        finally:
            cleanup()

        assert resp.status_code == 200
        body = resp.json()
        assert body["editor"]["trim_start_sec"] == 0
        assert body["editor"]["captions"] == []

    @pytest.mark.asyncio
    async def test_get_returns_404_when_clip_missing(self, client):
        db = _mock_db(None)
        cleanup = _set_deps(db)
        try:
            resp = await client.get(f"/clips/{CLIP_ID}/editor")
        finally:
            cleanup()

        assert resp.status_code == 404
