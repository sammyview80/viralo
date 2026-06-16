"""
Tests for WebSub subscription flow.

Covers:
- HMAC signature verification (valid / tampered / missing)
- subscribe_channel task (insert + upsert)
- process_websub_notification (dedup, pipeline trigger, no-sub guard)
- renew_websub_subscriptions (updates lease, hub failure)
"""
import hashlib
import hmac
import sys
import uuid
from unittest.mock import MagicMock, patch

import pytest

# Make celery task decorator a pass-through so the real function body is callable
_celery_mock = MagicMock()
_celery_mock.task = lambda **_kw: (lambda f: f)
_celery_mock.task.__call__ = lambda **_kw: (lambda f: f)
sys.modules["workers.celery_app"] = MagicMock(celery_app=_celery_mock)

# Ensure sqlalchemy.orm.Session is importable as a real context manager base
import sqlalchemy.orm as _orm  # noqa: E402  (imported after sys.modules patch)


WEBSUB_SECRET = "test-secret"


def _sig(body: bytes, secret: str = WEBSUB_SECRET) -> str:
    return "sha1=" + hmac.new(secret.encode(), body, hashlib.sha1).hexdigest()


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------

def test_verify_valid_signature():
    from workers.tasks.websub import verify_websub_signature
    body = b"<feed>hello</feed>"
    with patch("workers.tasks.websub.WEBSUB_SECRET", WEBSUB_SECRET):
        assert verify_websub_signature(body, _sig(body)) is True


def test_verify_tampered_body():
    from workers.tasks.websub import verify_websub_signature
    body = b"<feed>hello</feed>"
    with patch("workers.tasks.websub.WEBSUB_SECRET", WEBSUB_SECRET):
        assert verify_websub_signature(b"<feed>tampered</feed>", _sig(body)) is False


def test_verify_missing_header():
    from workers.tasks.websub import verify_websub_signature
    assert verify_websub_signature(b"body", "") is False


def test_verify_malformed_header():
    from workers.tasks.websub import verify_websub_signature
    assert verify_websub_signature(b"body", "noseparator") is False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _session_cm(fetchone_return=None, fetchall_return=None):
    """Return (context_manager, session_mock) for `with Session(engine) as db`."""
    session = MagicMock()
    session.execute.return_value.fetchone.return_value = fetchone_return
    session.execute.return_value.fetchall.return_value = fetchall_return or []

    # Session(engine) returns a context manager
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=session)
    cm.__exit__ = MagicMock(return_value=False)
    return cm, session


# ---------------------------------------------------------------------------
# subscribe_channel
# ---------------------------------------------------------------------------

@patch("workers.tasks.websub._subscribe", return_value=True)
@patch("workers.tasks.websub.Session")
def test_subscribe_channel_insert(mock_session_cls, mock_sub):
    """New channel inserts a row."""
    cm, db = _session_cm(fetchone_return=None)
    mock_session_cls.return_value = cm

    from workers.tasks.websub import subscribe_channel
    result = subscribe_channel("UCtest123456789012345678", str(uuid.uuid4()), "Test Channel")

    assert result["subscribed"] is True
    assert result["channel_id"] == "UCtest123456789012345678"
    mock_sub.assert_called_once_with("UCtest123456789012345678")
    db.commit.assert_called()


@patch("workers.tasks.websub._subscribe", return_value=True)
@patch("workers.tasks.websub.Session")
def test_subscribe_channel_upsert(mock_session_cls, mock_sub):
    """Existing channel is updated, not re-inserted."""
    cm, db = _session_cm(fetchone_return=(uuid.uuid4(),))
    mock_session_cls.return_value = cm

    from workers.tasks.websub import subscribe_channel
    result = subscribe_channel("UCtest123456789012345678", str(uuid.uuid4()))

    assert result["subscribed"] is True
    db.commit.assert_called()


# ---------------------------------------------------------------------------
# process_websub_notification
# ---------------------------------------------------------------------------

@patch("workers.tasks.websub.Session")
def test_process_notification_already_processed(mock_session_cls):
    """Already-processed video is skipped."""
    cm, _ = _session_cm(fetchone_return=(uuid.uuid4(), True))
    mock_session_cls.return_value = cm

    from workers.tasks.websub import process_websub_notification
    result = process_websub_notification("UCtest123456789012345678", "vid123", "https://youtube.com/watch?v=vid123")

    assert result == {"skipped": True, "reason": "already processed"}


@patch("workers.tasks.websub.Session")
def test_process_notification_no_subscriptions(mock_session_cls):
    """No active subscriptions → pipeline not triggered."""
    session = MagicMock()
    # Calls in order: dedup SELECT, INSERT delivery, SELECT subs, UPDATE last_video
    fetch_results = [
        MagicMock(fetchone=MagicMock(return_value=None)),   # dedup: not processed
        MagicMock(),                                          # INSERT
        MagicMock(fetchall=MagicMock(return_value=[])),     # subs: empty
        MagicMock(),                                          # UPDATE last_video
    ]
    session.execute.side_effect = fetch_results
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=session)
    cm.__exit__ = MagicMock(return_value=False)
    mock_session_cls.return_value = cm

    from workers.tasks.websub import process_websub_notification
    result = process_websub_notification("UCtest123456789012345678", "vid456", "https://youtube.com/watch?v=vid456")

    assert result["skipped"] is True
    assert result["reason"] == "no active subscriptions"


@patch("workers.tasks.websub.Session")
def test_process_notification_triggers_pipeline(mock_session_cls):
    """Active subscription triggers video pipeline job."""
    tenant_id = uuid.uuid4()
    sub_row = (uuid.uuid4(), tenant_id, False, {})

    session = MagicMock()
    fetch_results = [
        MagicMock(fetchone=MagicMock(return_value=None)),              # dedup
        MagicMock(),                                                     # INSERT delivery
        MagicMock(fetchall=MagicMock(return_value=[sub_row])),         # SELECT subs
        MagicMock(),                                                     # UPDATE last_video
        MagicMock(),                                                     # UPDATE delivery job_id (2nd Session block)
    ]
    session.execute.side_effect = fetch_results
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=session)
    cm.__exit__ = MagicMock(return_value=False)
    mock_session_cls.return_value = cm

    mock_task = MagicMock()
    # video.py uses Python 3.10+ syntax; stub the module before the local import fires
    mock_video_mod = MagicMock()
    mock_video_mod.process_youtube_video = mock_task
    with patch.dict(sys.modules, {"workers.tasks.video": mock_video_mod}):
        from workers.tasks.websub import process_websub_notification
        result = process_websub_notification(
            "UCtest123456789012345678", "vid789", "https://youtube.com/watch?v=vid789"
        )

    assert result["triggered"] == 1
    assert result["jobs"][0]["tenant_id"] == str(tenant_id)
    mock_task.apply_async.assert_called_once()


# ---------------------------------------------------------------------------
# renew_websub_subscriptions
# ---------------------------------------------------------------------------

@patch("workers.tasks.websub._subscribe", return_value=True)
@patch("workers.tasks.websub.Session")
def test_renew_subscriptions(mock_session_cls, mock_sub):
    """Renew updates lease for all active channels."""
    channel_ids = ["UCaaa1111111111111111111", "UCbbb2222222222222222222"]
    rows = [(cid,) for cid in channel_ids]
    cm, _ = _session_cm(fetchall_return=rows)
    mock_session_cls.return_value = cm

    from workers.tasks.websub import renew_websub_subscriptions
    result = renew_websub_subscriptions()

    assert result["total"] == 2
    assert result["renewed"] == 2
    assert mock_sub.call_count == 2


@patch("workers.tasks.websub._subscribe", return_value=False)
@patch("workers.tasks.websub.Session")
def test_renew_subscriptions_hub_failure(mock_session_cls, mock_sub):
    """Hub failure → not counted as renewed."""
    cm, _ = _session_cm(fetchall_return=[("UCaaa1111111111111111111",)])
    mock_session_cls.return_value = cm

    from workers.tasks.websub import renew_websub_subscriptions
    result = renew_websub_subscriptions()

    assert result["renewed"] == 0
    assert result["total"] == 1
