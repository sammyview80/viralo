"""Token refresh must fail fast — no publish with stale token."""
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch


def _load_publish_post():
    mock_celery = MagicMock()
    mock_celery.task.side_effect = lambda *a, **kw: (lambda f: f)
    with patch.dict("sys.modules", {"workers.celery_app": MagicMock(celery_app=mock_celery)}):
        import importlib
        import workers.tasks.post as post_mod
        importlib.reload(post_mod)
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
