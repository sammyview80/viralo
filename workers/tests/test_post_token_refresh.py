"""Token refresh must fail fast — no publish with stale token."""
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

_post_mod = None


def _load_publish_post():
    global _post_mod
    if _post_mod is not None:
        return _post_mod
    mock_celery = MagicMock()
    mock_celery.task.side_effect = lambda *a, **kw: (lambda f: f)
    with patch.dict("sys.modules", {"workers.celery_app": MagicMock(celery_app=mock_celery)}):
        import importlib
        import workers.tasks.post as post_mod
        importlib.reload(post_mod)
        _post_mod = post_mod
        return post_mod


def test_refresh_failure_does_not_publish():
    post_mod = _load_publish_post()
    expires = datetime.now(timezone.utc) + timedelta(minutes=1)
    row = (
        "pid", "youtube", "cap", [], {}, 0, "clip", "enc", "renc",
        expires, "uid", None, "s3://clip.mp4",
    )

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = row
    session_cm = MagicMock()
    session_cm.__enter__ = MagicMock(return_value=session)
    session_cm.__exit__ = MagicMock(return_value=False)

    with patch.object(post_mod, "_get_session", return_value=session_cm), \
         patch.object(post_mod, "_decrypt_token", side_effect=lambda x: "plain"), \
         patch.object(post_mod, "_handle_publish_failure") as mock_fail, \
         patch("workers.publishers.registry.get_publisher") as mock_get_pub, \
         patch.object(post_mod, "asyncio"):
        mock_get_pub.return_value.refresh_token.side_effect = RuntimeError("revoked")

        post_mod.publish_post(MagicMock(request=MagicMock(retries=0)), "tenant", "pid")

        mock_fail.assert_called_once()
        assert "refresh" in mock_fail.call_args.kwargs["error"].lower()
        mock_get_pub.return_value.publish.assert_not_called()


def test_malformed_refresh_response_does_not_publish():
    post_mod = _load_publish_post()
    expires = datetime.now(timezone.utc) + timedelta(minutes=1)
    row = (
        "pid", "youtube", "cap", [], {}, 0, "clip", "enc", "renc",
        expires, "uid", None, "s3://clip.mp4",
    )

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = row
    session_cm = MagicMock()
    session_cm.__enter__ = MagicMock(return_value=session)
    session_cm.__exit__ = MagicMock(return_value=False)

    with patch.object(post_mod, "_get_session", return_value=session_cm), \
         patch.object(post_mod, "_decrypt_token", side_effect=lambda x: "plain"), \
         patch.object(post_mod, "_handle_publish_failure") as mock_fail, \
         patch("workers.publishers.registry.get_publisher") as mock_get_pub, \
         patch.object(post_mod, "asyncio"):
        mock_get_pub.return_value.refresh_token.return_value = {"expires_in": 3600}

        post_mod.publish_post(MagicMock(request=MagicMock(retries=0)), "tenant", "pid")

        mock_fail.assert_called_once()
        assert "access_token" in mock_fail.call_args.kwargs["error"].lower()
        mock_get_pub.return_value.publish.assert_not_called()


def test_static_token_empty_refresh_continues_publish():
    post_mod = _load_publish_post()
    expires = datetime.now(timezone.utc) + timedelta(minutes=1)
    row = (
        "pid", "twitter", "cap", [], {}, 0, "clip", "enc", "renc",
        expires, "uid", "oauth-secret", "s3://clip.mp4",
    )

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = row
    session_cm = MagicMock()
    session_cm.__enter__ = MagicMock(return_value=session)
    session_cm.__exit__ = MagicMock(return_value=False)

    publish_result = MagicMock(success=True, platform_post_id="tw123", retry_after_seconds=None)
    fake_storage_base = MagicMock()
    fake_storage_base.get_storage.return_value.download = MagicMock()

    with patch.object(post_mod, "_get_session", return_value=session_cm), \
         patch.object(post_mod, "_decrypt_token", side_effect=lambda x: "plain"), \
         patch.object(post_mod, "_handle_publish_failure") as mock_fail, \
         patch.object(post_mod, "_try_insert_notification"), \
         patch("workers.publishers.registry.get_publisher") as mock_get_pub, \
         patch.dict("sys.modules", {"shared.storage.base": fake_storage_base}), \
         patch.object(post_mod, "tempfile") as mock_tmp, \
         patch.object(post_mod, "asyncio") as mock_asyncio, \
         patch.object(post_mod.os, "close"):
        mock_pub = mock_get_pub.return_value
        mock_pub.refresh_token.return_value = {}
        mock_pub.publish.return_value = publish_result
        mock_tmp.mkstemp.return_value = (1, "/tmp/x.mp4")
        mock_asyncio.run = MagicMock()

        post_mod.publish_post(MagicMock(request=MagicMock(retries=0)), "tenant", "pid")

        mock_fail.assert_not_called()
        mock_pub.refresh_token.assert_called_once()
        mock_pub.publish.assert_called_once()
        assert mock_pub.publish.call_args.kwargs["access_token"] == "plain"


class _BlankStrError(Exception):
    def __str__(self):
        return ""


def test_refresh_blank_exception_preserves_type():
    post_mod = _load_publish_post()
    expires = datetime.now(timezone.utc) + timedelta(minutes=1)
    row = (
        "pid", "youtube", "cap", [], {}, 0, "clip", "enc", "renc",
        expires, "uid", None, "s3://clip.mp4",
    )

    session = MagicMock()
    session.execute.return_value.fetchone.return_value = row
    session_cm = MagicMock()
    session_cm.__enter__ = MagicMock(return_value=session)
    session_cm.__exit__ = MagicMock(return_value=False)

    with patch.object(post_mod, "_get_session", return_value=session_cm), \
         patch.object(post_mod, "_decrypt_token", side_effect=lambda x: "plain"), \
         patch.object(post_mod, "_handle_publish_failure") as mock_fail, \
         patch("workers.publishers.registry.get_publisher") as mock_get_pub, \
         patch.object(post_mod, "asyncio"):
        mock_get_pub.return_value.refresh_token.side_effect = _BlankStrError()

        post_mod.publish_post(MagicMock(request=MagicMock(retries=0)), "tenant", "pid")

        mock_fail.assert_called_once()
        assert "_BlankStrError" in mock_fail.call_args.kwargs["error"]
        mock_get_pub.return_value.publish.assert_not_called()
