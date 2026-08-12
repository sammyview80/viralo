"""TikTok publisher — real public video ID resolution vs internal publish_id."""
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest


def _mk_video(size=1024):
    fd, path = tempfile.mkstemp(suffix=".mp4")
    os.write(fd, b"0" * size)
    os.close(fd)
    return path


def _patch_common(status_data):
    """Patch init/upload/status-fetch/creator_info for a full publish() run."""
    init_resp = MagicMock(status_code=200)
    init_resp.json.return_value = {"data": {"publish_id": "v_pub_file~v2-123", "upload_url": "https://upload.example/x"}}
    init_resp.raise_for_status.return_value = None

    creator_resp = MagicMock(status_code=200)
    creator_resp.json.return_value = {"data": {"privacy_level_options": ["PUBLIC_TO_EVERYONE"]}}
    creator_resp.raise_for_status.return_value = None

    status_resp = MagicMock(status_code=200)
    status_resp.json.return_value = {"data": status_data}
    status_resp.raise_for_status.return_value = None

    upload_resp = MagicMock(status_code=201, ok=True)

    return init_resp, creator_resp, status_resp, upload_resp


def test_publish_complete_with_public_id_uses_real_id_not_publish_id():
    from workers.publishers.tiktok import TikTokPublisher

    init_resp, creator_resp, status_resp, upload_resp = _patch_common(
        {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": ["7123456789012345678"]}
    )
    path = _mk_video()
    try:
        with patch("workers.publishers.tiktok.requests.post", side_effect=[creator_resp, init_resp, status_resp]), \
             patch("workers.publishers.tiktok.requests.put", return_value=upload_resp):
            result = TikTokPublisher().publish(path, "caption", [], "token")
    finally:
        os.unlink(path)

    assert result.success is True
    assert result.platform_post_id == "7123456789012345678"
    assert result.platform_post_id != "v_pub_file~v2-123"


def test_publish_complete_without_public_id_returns_none_not_publish_id():
    """SELF_ONLY/draft posts: no publicaly_available_post_id — must not fabricate a broken URL."""
    from workers.publishers.tiktok import TikTokPublisher

    init_resp, creator_resp, status_resp, upload_resp = _patch_common(
        {"status": "PUBLISH_COMPLETE"}
    )
    path = _mk_video()
    try:
        with patch("workers.publishers.tiktok.requests.post", side_effect=[creator_resp, init_resp, status_resp]), \
             patch("workers.publishers.tiktok.requests.put", return_value=upload_resp):
            result = TikTokPublisher().publish(path, "caption", [], "token")
    finally:
        os.unlink(path)

    assert result.success is True
    assert result.platform_post_id is None


def test_poll_publish_status_returns_public_ids_on_complete():
    from workers.publishers.tiktok import TikTokPublisher

    status_resp = MagicMock(status_code=200)
    status_resp.json.return_value = {
        "data": {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": ["999"]}
    }
    status_resp.raise_for_status.return_value = None

    with patch("workers.publishers.tiktok.requests.post", return_value=status_resp):
        status, err, public_ids = TikTokPublisher()._poll_publish_status("token", "pub_id")

    assert status == "PUBLISH_COMPLETE"
    assert err is None
    assert public_ids == ["999"]


def test_publish_timeout_fallback_with_public_id_uses_real_id():
    """All poll attempts exhausted still processing, but a public ID already surfaced — use it."""
    from workers.publishers.tiktok import STATUS_POLL_ATTEMPTS, TikTokPublisher

    init_resp, creator_resp, _, upload_resp = _patch_common({})
    timeout_status_resp = MagicMock(status_code=200)
    timeout_status_resp.json.return_value = {
        "data": {"status": "PROCESSING_UPLOAD", "publicaly_available_post_id": ["555"]}
    }
    timeout_status_resp.raise_for_status.return_value = None

    path = _mk_video()
    try:
        post_side_effects = [creator_resp, init_resp] + [timeout_status_resp] * STATUS_POLL_ATTEMPTS
        with patch("workers.publishers.tiktok.requests.post", side_effect=post_side_effects), \
             patch("workers.publishers.tiktok.requests.put", return_value=upload_resp), \
             patch("workers.publishers.tiktok.time.sleep"):
            result = TikTokPublisher().publish(path, "caption", [], "token")
    finally:
        os.unlink(path)

    assert result.success is True
    assert result.platform_post_id == "555"


def test_publish_timeout_fallback_without_public_id_returns_none_not_publish_id():
    """All poll attempts exhausted still processing, never got a public ID — must not fall back to publish_id."""
    from workers.publishers.tiktok import STATUS_POLL_ATTEMPTS, TikTokPublisher

    init_resp, creator_resp, _, upload_resp = _patch_common({})
    timeout_status_resp = MagicMock(status_code=200)
    timeout_status_resp.json.return_value = {"data": {"status": "PROCESSING_UPLOAD"}}
    timeout_status_resp.raise_for_status.return_value = None

    path = _mk_video()
    try:
        post_side_effects = [creator_resp, init_resp] + [timeout_status_resp] * STATUS_POLL_ATTEMPTS
        with patch("workers.publishers.tiktok.requests.post", side_effect=post_side_effects), \
             patch("workers.publishers.tiktok.requests.put", return_value=upload_resp), \
             patch("workers.publishers.tiktok.time.sleep"):
            result = TikTokPublisher().publish(path, "caption", [], "token")
    finally:
        os.unlink(path)

    assert result.success is True
    assert result.platform_post_id is None
    assert result.platform_post_id != "v_pub_file~v2-123"


def test_poll_publish_status_timeout_returns_last_seen_public_ids():
    from workers.publishers.tiktok import STATUS_POLL_ATTEMPTS, TikTokPublisher

    status_resp = MagicMock(status_code=200)
    status_resp.json.return_value = {
        "data": {"status": "PROCESSING_UPLOAD", "publicaly_available_post_id": ["777"]}
    }
    status_resp.raise_for_status.return_value = None

    with patch("workers.publishers.tiktok.requests.post", return_value=status_resp), \
         patch("workers.publishers.tiktok.time.sleep"):
        status, err, public_ids = TikTokPublisher()._poll_publish_status("token", "pub_id")

    assert status == "PROCESSING_UPLOAD"
    assert err is None
    assert public_ids == ["777"]


def test_poll_publish_status_timeout_without_public_id_returns_none():
    from workers.publishers.tiktok import TikTokPublisher

    status_resp = MagicMock(status_code=200)
    status_resp.json.return_value = {"data": {"status": "PROCESSING_UPLOAD"}}
    status_resp.raise_for_status.return_value = None

    with patch("workers.publishers.tiktok.requests.post", return_value=status_resp), \
         patch("workers.publishers.tiktok.time.sleep"):
        status, err, public_ids = TikTokPublisher()._poll_publish_status("token", "pub_id")

    assert status == "PROCESSING_UPLOAD"
    assert public_ids is None


def test_poll_publish_status_failed_returns_none_public_ids():
    from workers.publishers.tiktok import TikTokPublisher

    status_resp = MagicMock(status_code=200)
    status_resp.json.return_value = {"data": {"status": "FAILED", "fail_reason": "video_too_short"}}
    status_resp.raise_for_status.return_value = None

    with patch("workers.publishers.tiktok.requests.post", return_value=status_resp):
        status, err, public_ids = TikTokPublisher()._poll_publish_status("token", "pub_id")

    assert status == "FAILED"
    assert "video_too_short" in err
    assert public_ids is None
