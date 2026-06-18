import pytest

from shared.storage.local import _safe_local_path, LOCAL_STORAGE_DIR
from video.routers.videos import _validate_youtube_url


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
