from unittest.mock import patch, MagicMock
from workers.tasks.video.scene import _extract_scene_frames


def test_extract_returns_scene_frames():
    # av is imported inside the function — patch at the av module level
    with patch("av.open") as mock_open:
        mock_container = MagicMock()
        mock_container.__enter__ = lambda s: s
        mock_container.__exit__ = MagicMock(return_value=False)
        mock_container.streams.__iter__ = MagicMock(return_value=iter([]))
        mock_open.return_value = mock_container
        frames = _extract_scene_frames("/fake/path.mp4", duration=60.0, n_frames=6, tmp_dir="/tmp")
    assert isinstance(frames, list)


def test_extract_empty_on_error():
    frames = _extract_scene_frames("/nonexistent/path.mp4", duration=60.0, n_frames=6, tmp_dir="/tmp")
    assert frames == []
