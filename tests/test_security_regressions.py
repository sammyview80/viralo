import sys
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

ROOT = Path(__file__).resolve().parents[1]
for path in (
    ROOT,
    ROOT / "shared",
    ROOT / "services" / "agent",
    ROOT / "services" / "core",
    ROOT / "services" / "platform",
    ROOT / "services" / "video",
):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def _request(client: str, forwarded: str = "") -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers,
                    "client": (client, 1234), "scheme": "http", "server": ("test", 80)})


def test_trusted_proxy_chain_uses_nearest_untrusted_hop(monkeypatch):
    from core.routers import auth

    monkeypatch.setattr(auth.settings, "trusted_proxy_ips", "10.0.0.2,10.0.0.3")
    assert auth._client_ip(_request("10.0.0.2", "198.51.100.9, 203.0.113.4, 10.0.0.3")) == "203.0.113.4"
    assert auth._client_ip(_request("192.0.2.2", "198.51.100.9")) == "192.0.2.2"


def test_access_and_refresh_tokens_include_issued_at():
    from shared.auth import create_access_token, create_refresh_token, decode_token

    user_id = str(uuid.uuid4())
    assert decode_token(create_access_token(user_id, "", "u@example.com", "free"))["iat"] > 0
    refresh, _ = create_refresh_token(user_id)
    assert decode_token(refresh)["iat"] > 0


@pytest.mark.asyncio
async def test_registration_has_aggregate_ip_limit():
    from core.routers import auth
    from shared.schemas.auth import RegisterRequest

    redis = AsyncMock()
    redis.incr.side_effect = [1, 101]
    db = AsyncMock()
    body = RegisterRequest(email="new@example.com", password="strong-pass", full_name="New User")
    with pytest.raises(HTTPException) as exc:
        await auth.register(body, _request("192.0.2.5"), Response(), db, redis)
    assert exc.value.status_code == 429
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_refresh_uses_atomic_claim_and_string_grace_token():
    from core.routers import auth

    user_id = str(uuid.uuid4())
    redis = AsyncMock()
    redis.get.side_effect = [None, "cached-access-token"]
    redis.set.return_value = False
    payload = {"type": "refresh", "sub": user_id, "jti": "old-jti", "iat": 100}
    with patch.object(auth, "decode_token", return_value=payload):
        result = await auth.refresh_tokens(Response(), AsyncMock(), redis, "refresh-token")
    assert result.access_token == "cached-access-token"
    redis.set.assert_awaited_once_with(
        "blacklist:old-jti", "1", nx=True, ex=auth.REFRESH_TOKEN_DAYS * 86400
    )


@pytest.mark.asyncio
async def test_access_dependency_rejects_family_revocation():
    from shared import deps

    payload = {"sub": str(uuid.uuid4()), "tenant_id": "", "email": "u@example.com",
               "plan": "free", "type": "access", "iat": 100}
    redis = AsyncMock()
    redis.get.return_value = "101"
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")
    with patch.object(deps, "decode_token", return_value=payload), pytest.raises(HTTPException) as exc:
        await deps.get_current_user(credentials, redis)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_progress_ticket_is_scoped_and_single_use():
    from shared.schemas.auth import TokenPayload
    from video.routers import videos

    job_id = "job-123"
    result = MagicMock()
    result.scalar_one_or_none.return_value = uuid.uuid4()
    db = AsyncMock()
    db.execute.return_value = result
    redis = AsyncMock()
    token = TokenPayload(sub=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()),
                         email="u@example.com", plan="free", type="access")
    created = await videos.create_progress_ticket(job_id, token, redis, db)
    ticket = created["ticket"]
    redis.setex.assert_awaited_once_with(f"progress_ticket:{ticket}", 60, job_id)

    redis.getdel.side_effect = [job_id, None]
    await videos.video_progress(job_id, ticket, redis)
    with pytest.raises(HTTPException) as exc:
        await videos.video_progress(job_id, ticket, redis)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_websocket_ticket_is_tenant_scoped_and_short_lived():
    from agent.routers import ws
    from shared.schemas.auth import TokenPayload

    session_id = str(uuid.uuid4())
    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = uuid.UUID(session_id)
    db = AsyncMock()
    db.execute.return_value = query_result

    class DbContext:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *_args):
            return False

    redis = AsyncMock()
    token = TokenPayload(sub=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()),
                         email="u@example.com", plan="free", type="access")
    with patch.object(ws, "AsyncSessionLocal", return_value=DbContext()), \
         patch.object(ws.aioredis, "from_url", return_value=redis):
        result = await ws.websocket_ticket(session_id, token)
    ticket = result["ticket"]
    redis.setex.assert_awaited_once_with(f"ws_ticket:{ticket}", 60, session_id)
    redis.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_websub_rejects_declared_oversized_payload():
    import os
    os.environ.setdefault("WEBSUB_SECRET", "test-websub-secret-at-least-32-bytes")
    from platform_svc.routers.websub import MAX_WEBSUB_BODY_BYTES, _read_websub_body

    request = Request({"type": "http", "method": "POST", "path": "/",
                       "headers": [(b"content-length", str(MAX_WEBSUB_BODY_BYTES + 1).encode())]})
    with pytest.raises(HTTPException) as exc:
        await _read_websub_body(request)
    assert exc.value.status_code == 413


@pytest.mark.asyncio
async def test_local_media_endpoint_requires_valid_signature(tmp_path, monkeypatch):
    from urllib.parse import parse_qs, urlsplit

    from shared.storage import local
    from video import main

    monkeypatch.setattr(local, "LOCAL_STORAGE_DIR", str(tmp_path))
    media = tmp_path / "tenant" / "clip.mp4"
    media.parent.mkdir()
    media.write_bytes(b"video")
    signed = urlsplit(local.sign_local_url("tenant/clip.mp4", expires_in=60))
    query = parse_qs(signed.query)
    response = await main.local_storage_file(
        "tenant/clip.mp4", int(query["expires"][0]), query["sig"][0]
    )
    assert Path(response.path) == media
    with pytest.raises(HTTPException) as exc:
        await main.local_storage_file("tenant/clip.mp4", 0, "bad")
    assert exc.value.status_code == 403


def test_production_token_encryption_requires_independent_key(monkeypatch):
    from platform_svc import crypto
    from shared.config import settings

    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(settings, "environment", "production")
    with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
        crypto._get_fernet()


@pytest.mark.asyncio
async def test_scheduled_post_uses_verified_account_platform():
    from platform_svc.routers.scheduling import create_scheduled_post
    from platform_svc.schemas import ScheduledPostCreate
    from shared.schemas.auth import TokenPayload

    account = SimpleNamespace(platform="youtube")
    account_result = MagicMock()
    account_result.scalar_one_or_none.return_value = account
    clip_result = MagicMock()
    clip_result.fetchone.return_value = ("/storage/clip.mp4",)
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [account_result, clip_result]
    db.refresh.side_effect = lambda post: (
        setattr(post, "created_at", None), setattr(post, "updated_at", None),
        setattr(post, "retry_count", 0)
    )
    body = ScheduledPostCreate(clip_id=uuid.uuid4(), social_account_id=uuid.uuid4(),
                               scheduled_at="2026-07-21T10:00:00Z")
    token = TokenPayload(sub=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()),
                         email="u@example.com", plan="free", type="access")
    await create_scheduled_post(body, token, db)
    assert db.add.call_args.args[0].platform == "youtube"


def test_auto_schedule_rejects_injected_account_id_before_sql():
    from workers.tasks.video import pipeline

    with patch.object(pipeline, "_get_session") as session:
        pipeline._auto_schedule_clips(str(uuid.uuid4()), [uuid.uuid4()], {
            "social_account_ids": ["x') OR TRUE --"],
        })
    session.return_value.__enter__.return_value.execute.assert_not_called()


def test_auto_schedule_binds_valid_account_ids_as_uuid_array():
    from workers.tasks.video import pipeline

    account_id = uuid.uuid4()
    session = MagicMock()
    session.execute.return_value.fetchall.return_value = []

    @contextmanager
    def fake_session(_tenant_id):
        yield session

    with patch.object(pipeline, "_get_session", fake_session):
        pipeline._auto_schedule_clips(str(uuid.uuid4()), [], {
            "social_account_ids": [str(account_id)],
        })
    sql = str(session.execute.call_args.args[0])
    params = session.execute.call_args.args[1]
    assert "ANY(CAST(:account_ids AS uuid[]))" in sql
    assert params["account_ids"] == [str(account_id)]


def test_unlimited_email_bypass_checks_all_tenant_users():
    from workers.tasks.video import _core

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = (["other@example.com", "aman@viralo.com"], "free")
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False
    with patch.object(_core, "Session", return_value=session_cm):
        assert _core._is_unlimited(str(uuid.uuid4())) is True


def test_publish_exception_after_external_call_fails_closed(tmp_path, monkeypatch):
    from workers.publishers.base import PublishResult
    from workers.tasks import post

    row = (uuid.uuid4(), "youtube", "caption", [], {}, 0, uuid.uuid4(),
           None, None, None, None, None, "/storage/clip.mp4")
    claim = MagicMock()
    claim.execute.return_value.fetchone.return_value = row
    posted = MagicMock()
    posted.execute.side_effect = RuntimeError("database unavailable after publish")
    failed = MagicMock()
    sessions = iter([claim, posted, failed])

    @contextmanager
    def fake_session(_tenant_id):
        yield next(sessions)

    storage = MagicMock()
    storage.download = AsyncMock()
    publisher = MagicMock()
    publisher.publish.return_value = PublishResult(success=True, platform_post_id="remote-1")
    task = MagicMock()
    monkeypatch.setenv("STORAGE_PROVIDER", "local")
    with patch.object(post, "_get_session", fake_session), \
         patch("shared.storage.base.get_storage", return_value=storage), \
         patch("workers.publishers.registry.get_publisher", return_value=publisher):
        fn = getattr(post.publish_post, "run", post.publish_post)
        if hasattr(post.publish_post, "run"):
            fn(str(uuid.uuid4()), str(uuid.uuid4()))
        else:
            fn(task, str(uuid.uuid4()), str(uuid.uuid4()))

    failure_sql = str(failed.execute.call_args.args[0])
    assert "status = 'failed'" in failure_sql
    task.retry.assert_not_called()


def test_series_reconciler_requeues_interrupted_run():
    from workers.tasks.video import tasks

    row = (uuid.uuid4(), uuid.uuid4(), None, {}, "processing", 0, "series",
           {"series_id": str(uuid.uuid4()), "publish_at": "2026-07-21T10:00:00+00:00"})
    rows = MagicMock()
    rows.fetchall.return_value = [row]
    session = MagicMock()
    session.execute.side_effect = [rows, MagicMock()]
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False
    with patch.object(tasks, "Session", return_value=session_cm), \
         patch.object(tasks.celery_app, "send_task") as send:
        result = getattr(tasks.reconcile_stuck_videos, "run", tasks.reconcile_stuck_videos)()
    assert result == {"requeued": 1, "failed": 0}
    send.assert_called_once_with("workers.tasks.series.generate_series_video",
                                 args=[row[7]["series_id"], row[7]["publish_at"]])


def test_pending_series_dispatch_is_retried_without_advancing_schedule():
    from workers.tasks import series

    pending = datetime.now(UTC) + timedelta(hours=2)
    row = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4(), cadence="daily",
                          publish_time="18:00", next_run_at=pending + timedelta(days=1),
                          dispatch_pending_at=pending)
    selected = MagicMock()
    selected.fetchall.return_value = [row]
    session = MagicMock()
    session.execute.side_effect = [selected, MagicMock()]
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False
    delayed = MagicMock()
    with patch.object(series, "Session", return_value=session_cm), \
         patch.object(series, "generate_series_video", delayed):
        result = getattr(series.process_due_series, "run", series.process_due_series)()
    assert result == {"launched": 1}
    assert len(session.execute.call_args_list) == 2
    assert delayed.apply_async.call_args.kwargs["args"][1] == pending.isoformat()


def test_failed_series_run_is_reclaimed_and_partial_outputs_are_cleaned(tmp_path, monkeypatch):
    from workers.tasks import series

    series_id = str(uuid.uuid4())
    lookup = MagicMock()
    lookup.execute.return_value.mappings.return_value.first.return_value = {
        "id": uuid.UUID(series_id), "tenant_id": uuid.uuid4(), "name": "Facts",
        "niche": "history", "voice": "voice", "art_style": "comic",
    }
    lookup_cm = MagicMock()
    lookup_cm.__enter__.return_value = lookup
    lookup_cm.__exit__.return_value = False

    insert_result = MagicMock()
    insert_result.scalar_one_or_none.return_value = None
    reclaim_result = MagicMock()
    reclaim_result.scalar_one_or_none.return_value = uuid.uuid4()
    claim = MagicMock()
    claim.execute.side_effect = [insert_result, reclaim_result, MagicMock(), MagicMock()]
    status = MagicMock()
    sessions = iter([claim, status])

    @contextmanager
    def fake_tenant_session(_tenant_id):
        yield next(sessions)

    monkeypatch.setenv("VIDEO_TEMP_DIR", str(tmp_path))
    script = {"title": "Title", "scenes": [{"narration": "hello", "image_prompt": "image"}]}
    with patch.object(series, "Session", return_value=lookup_cm), \
         patch.object(series, "_generate_script", return_value=script), \
         patch.object(series, "_tts_scene", side_effect=RuntimeError("worker interrupted")), \
         patch("workers.tasks.video._core._get_session", fake_tenant_session):
        fn = getattr(series.generate_series_video, "run", series.generate_series_video)
        with pytest.raises(RuntimeError, match="worker interrupted"):
            if hasattr(series.generate_series_video, "run"):
                fn(series_id, "2026-07-21T10:00:00+00:00")
            else:
                fn(MagicMock(), series_id, "2026-07-21T10:00:00+00:00")

    sql = [str(call.args[0]) for call in claim.execute.call_args_list]
    assert any("status = 'failed'" in statement for statement in sql)
    assert any("DELETE FROM scheduled_posts" in statement for statement in sql)
    assert any("DELETE FROM clips" in statement for statement in sql)


def test_migrations_fail_safe_and_add_dispatch_guards():
    first = (ROOT / "migrations/versions/20260720_0001_subscription_tenant_unique.py").read_text()
    second = (ROOT / "migrations/versions/20260720_0002_series_dispatch_guards.py").read_text()
    assert "RAISE EXCEPTION" in first and "DELETE FROM subscriptions" not in first
    assert "dispatch_pending_at" in second and "series_run_key" in second


def test_cookie_secret_is_untracked_and_not_baked_into_video_image():
    import subprocess

    tracked = subprocess.run(["git", "ls-files", "--", "yt-cookies.txt"], cwd=ROOT,
                             check=True, capture_output=True, text=True)
    assert tracked.stdout == ""
    dockerfile = (ROOT / "services/video/Dockerfile").read_text()
    assert "COPY yt-cookies.txt" not in dockerfile
