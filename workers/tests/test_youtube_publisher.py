"""YouTube publisher error classification + upload MIME."""
import json
from unittest.mock import MagicMock, patch

import pytest


def _http_error(status: int, reason: str = "", message: str = "err"):
    from googleapiclient.errors import HttpError

    content = json.dumps({"error": {"errors": [{"reason": reason, "message": message}]}}).encode()
    resp = MagicMock(status=status)
    return HttpError(resp, content)


def test_publish_uses_mp4_mimetype():
    from workers.publishers.youtube import YouTubePublisher

    pub = YouTubePublisher()
    with patch("googleapiclient.discovery.build") as mock_build, \
         patch("googleapiclient.http.MediaFileUpload") as mock_media:
        youtube = MagicMock()
        req = MagicMock()
        req.next_chunk.side_effect = [(None, {"id": "vid123"})]
        youtube.videos.return_value.insert.return_value = req
        mock_build.return_value = youtube

        result = pub.publish("/tmp/x.mp4", "cap", [], "tok")

        assert result.success is True
        assert mock_media.call_args.kwargs["mimetype"] == "video/mp4"


@pytest.mark.parametrize("exc,expect_error,retry", [
    (_http_error(401, "authError"), "auth failed", None),
    (_http_error(403, "quotaExceeded"), "quota exceeded", 3600),
    (_http_error(503, "backendError"), "temporary", 120),
    (Exception(""), "YouTube upload failed", None),
])
def test_publish_classifies_errors(exc, expect_error, retry):
    from workers.publishers.youtube import YouTubePublisher

    pub = YouTubePublisher()
    with patch("googleapiclient.discovery.build") as mock_build, \
         patch("googleapiclient.http.MediaFileUpload"):
        youtube = MagicMock()
        youtube.videos.return_value.insert.return_value.next_chunk.side_effect = exc
        mock_build.return_value = youtube

        result = pub.publish("/tmp/x.mp4", "cap", [], "tok")

        assert result.success is False
        assert result.error
        assert expect_error.lower() in result.error.lower()
        assert result.retry_after_seconds == retry
