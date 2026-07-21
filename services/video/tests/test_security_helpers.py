import time

import pytest

from shared.storage.local import _safe_local_path, sign_local_url, verify_local_url
from video.routers.videos import _validate_youtube_url
from video.schemas import ClipResponse


def test_validate_youtube_url_rejects_non_youtube_hosts():
    with pytest.raises(ValueError):
        _validate_youtube_url("http://127.0.0.1:8000/internal")


def test_validate_youtube_url_accepts_youtube_watch_urls():
    assert _validate_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_safe_local_path_rejects_path_traversal():
    with pytest.raises(ValueError):
        _safe_local_path("../../etc/passwd")


def test_safe_local_path_allows_relative_storage_paths():
    path = _safe_local_path("clips/tenant/video.mp4")
    assert str(path).startswith(str(_safe_local_path(".")))
    assert path.name == "video.mp4"


def test_local_storage_urls_are_signed_and_expire():
    now = int(time.time())
    url = sign_local_url("clips/tenant/video.mp4", expires_in=60, now=now)
    expires = int(url.split("expires=", 1)[1].split("&", 1)[0])
    signature = url.split("sig=", 1)[1]
    assert verify_local_url("clips/tenant/video.mp4", expires, signature, now=now)
    assert not verify_local_url("clips/tenant/video.mp4", expires, signature, now=now + 61)


def test_unsigned_local_storage_url_is_not_valid():
    assert not verify_local_url("clips/tenant/video.mp4", int(time.time()) + 60, "")


def test_clip_response_signs_local_url_without_changing_stored_value():
    raw_url = "/storage/clips/tenant/video.mp4"
    response = ClipResponse.model_validate({
        "id": "00000000-0000-0000-0000-000000000001",
        "video_id": "00000000-0000-0000-0000-000000000002",
        "title": None,
        "start_ms": None,
        "end_ms": None,
        "duration_ms": None,
        "platform": None,
        "score": None,
        "status": "ready",
        "storage_url": raw_url,
        "thumbnail_url": None,
        "caption_srt": None,
        "created_at": "2026-07-20T00:00:00Z",
    })
    assert response.storage_url.startswith(raw_url + "?expires=")
