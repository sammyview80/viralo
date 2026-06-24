from unittest.mock import MagicMock
from workers.tasks.video.feedback import record_clip_feedback, get_score_weight_adjustments


def test_record_feedback_calls_db():
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_engine.begin.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_engine.begin.return_value.__exit__ = MagicMock(return_value=False)

    record_clip_feedback(
        tenant_id="tid", clip_id="cid", video_id="vid",
        action="approve",
        original_start=0.0, original_end=30.0,
        edited_start=None, edited_end=None,
        original_score=0.75,
        clip_signals={"hook_score": 0.8, "audio_energy": 0.6},
        engine=mock_engine,
    )
    assert mock_conn.execute.called


def test_get_weight_adjustments_returns_defaults_on_empty():
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = []
    mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

    weights = get_score_weight_adjustments("tid", mock_engine)
    assert "hook_score" in weights
    assert "audio_energy" in weights
    assert all(isinstance(v, float) for v in weights.values())
