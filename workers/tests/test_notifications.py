"""Unit tests for send_notification task and event_consumer dispatch."""
import importlib
import json
import sys
import uuid
from unittest.mock import MagicMock, patch

# ── stub heavy deps once at collection time ───────────────────────────────────
for _mod in ["aio_pika", "aiosmtplib", "pywebpush"]:
    sys.modules.setdefault(_mod, MagicMock())


def _passthrough_task(**_kw):
    """Makes @celery_app.task(...) a no-op decorator so we test the real function."""
    def decorator(fn):
        return fn
    return decorator


def _load_notif():
    """Return the notification module with mocked infra and real function bodies."""
    mock_engine = MagicMock()
    mock_redis = MagicMock()
    mock_celery_app = MagicMock()
    mock_celery_app.task.side_effect = _passthrough_task

    mock_celery_module = MagicMock()
    mock_celery_module.celery_app = mock_celery_app

    for key in list(sys.modules):
        if "workers.tasks.notification" in key:
            del sys.modules[key]

    with patch.dict(sys.modules, {"workers.celery_app": mock_celery_module}), \
         patch("sqlalchemy.create_engine", return_value=mock_engine), \
         patch("redis.from_url", return_value=mock_redis):
        import workers.tasks.notification as notif
        importlib.reload(notif)

    notif.engine = mock_engine
    notif.redis_client = mock_redis
    notif.SMTP_HOST = ""
    notif.VAPID_PRIVATE_KEY = ""
    return notif, mock_engine, mock_redis


def _session_ctx(mock_session=None):
    """Return a context manager that yields mock_session."""
    s = mock_session or MagicMock()
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=s)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx, s


def _conn_ctx(fetchone=None, fetchall=None):
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = fetchone
    conn.execute.return_value.fetchall.return_value = fetchall or []
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=conn)
    ctx.__exit__ = MagicMock(return_value=False)
    return ctx, conn


# ── send_notification: DB insert ──────────────────────────────────────────────

def test_inserts_to_db():
    notif, mock_engine, mock_redis = _load_notif()
    session_ctx, mock_session = _session_ctx()

    # engine.connect() → tenant prefs (email off, push off)
    conn_ctx, _ = _conn_ctx(fetchone=(False, False, []))
    mock_engine.connect.return_value = conn_ctx

    with patch.object(notif, "Session", return_value=session_ctx):
        notif.send_notification(
            str(uuid.uuid4()), None,
            type="video_ready", title="Ready", body="3 clips.",
        )

    # execute called twice: SET LOCAL tenant + INSERT INTO notifications
    assert mock_session.execute.call_count == 2
    # The INSERT is the second call — verify params contain expected fields
    insert_params = mock_session.execute.call_args_list[1][0][1]
    assert insert_params["type"] == "video_ready"
    assert insert_params["title"] == "Ready"


def test_db_insert_contains_correct_fields():
    notif, mock_engine, _ = _load_notif()
    session_ctx, mock_session = _session_ctx()
    conn_ctx, _ = _conn_ctx(fetchone=(False, False, []))
    mock_engine.connect.return_value = conn_ctx

    tid = str(uuid.uuid4())
    uid = str(uuid.uuid4())

    with patch.object(notif, "Session", return_value=session_ctx):
        notif.send_notification(
            tid, uid,
            type="post_published",
            title="Post is live!",
            body="Your TikTok post is live.",
            action_url="/scheduler?post=123",
            metadata={"post_id": "123"},
        )

    call_params = mock_session.execute.call_args[0][1]
    assert call_params["tenant_id"] == tid
    assert call_params["user_id"] == uid
    assert call_params["type"] == "post_published"
    assert call_params["title"] == "Post is live!"


# ── send_notification: Redis publish ─────────────────────────────────────────

def test_publishes_to_redis():
    notif, mock_engine, mock_redis = _load_notif()
    session_ctx, _ = _session_ctx()
    conn_ctx, _ = _conn_ctx(fetchone=(False, False, []))
    mock_engine.connect.return_value = conn_ctx
    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    with patch.object(notif, "Session", return_value=session_ctx):
        notif.send_notification(tenant_id, user_id, type="video_ready", title="Ready", body="Done.")

    mock_redis.publish.assert_called_once()
    channel, payload_str = mock_redis.publish.call_args[0]
    assert channel == f"notifications:{tenant_id}:{user_id}"
    payload = json.loads(payload_str)
    assert payload["user_id"] == user_id
    assert payload["type"] == "video_ready"
    assert payload["title"] == "Ready"


def test_redis_failure_does_not_propagate():
    notif, mock_engine, mock_redis = _load_notif()
    session_ctx, _ = _session_ctx()
    conn_ctx, _ = _conn_ctx(fetchone=(False, False, []))
    mock_engine.connect.return_value = conn_ctx
    mock_redis.publish.side_effect = ConnectionError("redis down")

    with patch.object(notif, "Session", return_value=session_ctx):
        # must not raise
        notif.send_notification(str(uuid.uuid4()), None, type="video_ready", title="T", body="B")


# ── send_notification: email ──────────────────────────────────────────────────

def test_email_sent_when_enabled():
    notif, mock_engine, _ = _load_notif()
    notif.SMTP_HOST = "smtp.example.com"
    session_ctx, _ = _session_ctx()

    tenant_ctx, _ = _conn_ctx(fetchone=(True, False, []))
    user_ctx, _ = _conn_ctx(fetchone=("user@example.com",))
    call_n = {"n": 0}
    def _connect():
        c = tenant_ctx if call_n["n"] == 0 else user_ctx
        call_n["n"] += 1
        return c
    mock_engine.connect.side_effect = _connect

    sent = {}
    async def fake_email(to, title, body, action_url):
        sent["to"] = to

    with patch.object(notif, "Session", return_value=session_ctx), \
         patch.object(notif, "_send_email", fake_email):
        notif.send_notification(
            str(uuid.uuid4()), str(uuid.uuid4()),
            type="post_published", title="Live!", body="Post is live.",
        )

    assert sent.get("to") == "user@example.com"


def test_email_skipped_when_type_disabled():
    notif, mock_engine, _ = _load_notif()
    notif.SMTP_HOST = "smtp.example.com"
    session_ctx, _ = _session_ctx()
    conn_ctx, _ = _conn_ctx(fetchone=(True, False, ["post_published"]))
    mock_engine.connect.return_value = conn_ctx

    sent = {}
    async def fake_email(*a, **kw):
        sent["called"] = True

    with patch.object(notif, "Session", return_value=session_ctx), \
         patch.object(notif, "_send_email", fake_email):
        notif.send_notification(
            str(uuid.uuid4()), str(uuid.uuid4()),
            type="post_published", title="Live!", body="Post is live.",
        )

    assert "called" not in sent


def test_email_skipped_when_no_smtp_host():
    """_send_email bails out early if SMTP_HOST is empty."""
    notif, _, _ = _load_notif()
    notif.SMTP_HOST = ""
    # Directly call _send_email — it should return without using aiosmtplib
    import asyncio
    import sys
    smtp_mock = MagicMock()
    sys.modules["aiosmtplib"] = smtp_mock
    asyncio.run(notif._send_email("u@x.com", "T", "B", None))
    smtp_mock.send.assert_not_called()


# ── send_notification: push ───────────────────────────────────────────────────

def test_stale_push_subscription_deleted():
    notif, mock_engine, _ = _load_notif()
    notif.VAPID_PRIVATE_KEY = "fake-key"
    session_ctx, _ = _session_ctx()

    sub_id = str(uuid.uuid4())
    tenant_ctx, _ = _conn_ctx(fetchone=(False, True, []))
    subs_ctx, _ = _conn_ctx(fetchall=[(sub_id, "https://push.example.com", "p256dh", "auth")])
    delete_ctx, delete_conn = _conn_ctx()

    call_n = {"n": 0}
    ctxs = [tenant_ctx, subs_ctx, delete_ctx]
    def _connect():
        c = ctxs[min(call_n["n"], 2)]
        call_n["n"] += 1
        return c
    mock_engine.connect.side_effect = _connect

    with patch.object(notif, "Session", return_value=session_ctx), \
         patch.object(notif, "_send_web_push", return_value=False):  # 410 Gone
        notif.send_notification(
            str(uuid.uuid4()), str(uuid.uuid4()),
            type="video_ready", title="T", body="B",
        )

    # Stale subscription should trigger a DELETE execute call
    delete_conn.execute.assert_called_once()


def test_push_skipped_without_vapid_key():
    notif, mock_engine, _ = _load_notif()
    notif.VAPID_PRIVATE_KEY = ""
    session_ctx, _ = _session_ctx()
    conn_ctx, _ = _conn_ctx(fetchone=(False, True, []))
    mock_engine.connect.return_value = conn_ctx

    push_called = {}
    with patch.object(notif, "Session", return_value=session_ctx), \
         patch.object(notif, "_send_web_push", side_effect=lambda *a, **kw: push_called.update({"yes": True})):
        notif.send_notification(str(uuid.uuid4()), None, type="video_ready", title="T", body="B")

    assert "yes" not in push_called


# ── event_consumer dispatch ───────────────────────────────────────────────────

def _load_ec():
    sys.modules.setdefault("aio_pika", MagicMock())
    for key in list(sys.modules):
        if "workers.tasks.event_consumer" in key:
            del sys.modules[key]
    import workers.tasks.event_consumer as ec
    return ec


def _ec_notif_type(call_args):
    """Extract notification type from delay() call regardless of positional vs keyword."""
    if call_args[1].get("type"):
        return call_args[1]["type"]
    # positional: (tenant_id, user_id, type, title, body, ...)
    return call_args[0][2]


def test_ec_video_ready():
    ec = _load_ec()
    mock_sn = MagicMock()
    ec.send_notification = mock_sn
    ec._dispatch("video.ready", {"tenant_id": str(uuid.uuid4()), "video_id": "v1", "title": "T"})
    mock_sn.delay.assert_called_once()
    assert _ec_notif_type(mock_sn.delay.call_args) == "video_ready"


def test_ec_video_failed():
    ec = _load_ec()
    mock_sn = MagicMock()
    ec.send_notification = mock_sn
    ec._dispatch("video.failed", {"tenant_id": str(uuid.uuid4()), "video_id": "v1", "error": "Boom"})
    mock_sn.delay.assert_called_once()
    assert _ec_notif_type(mock_sn.delay.call_args) == "video_failed"


def test_ec_workflow_failed_type_is_not_workflow_complete():
    ec = _load_ec()
    mock_sn = MagicMock()
    ec.send_notification = mock_sn
    ec._dispatch("workflow.run.failed", {
        "tenant_id": str(uuid.uuid4()), "name": "Daily", "workflow_id": "w1", "run_id": "r1",
    })
    mock_sn.delay.assert_called_once()
    notif_type = _ec_notif_type(mock_sn.delay.call_args)
    assert notif_type == "workflow_failed", f"got '{notif_type}', expected 'workflow_failed'"


def test_ec_quota_exceeded():
    ec = _load_ec()
    mock_sn = MagicMock()
    ec.send_notification = mock_sn
    ec._dispatch("quota.exceeded", {"tenant_id": str(uuid.uuid4())})
    mock_sn.delay.assert_called_once()
    assert _ec_notif_type(mock_sn.delay.call_args) == "quota_warning"


def test_ec_missing_tenant_skips():
    ec = _load_ec()
    mock_sn = MagicMock()
    ec.send_notification = mock_sn
    ec._dispatch("video.ready", {"video_id": "v1"})  # no tenant_id
    mock_sn.delay.assert_not_called()


def test_ec_unknown_event_skips():
    ec = _load_ec()
    mock_sn = MagicMock()
    ec.send_notification = mock_sn
    ec._dispatch("some.unknown.event", {"tenant_id": str(uuid.uuid4())})
    mock_sn.delay.assert_not_called()
