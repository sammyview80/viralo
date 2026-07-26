"""
Smoke test: verifies new pipeline stages don't crash on synthetic word data.
Does NOT require real video files or LLM calls.
"""
from datetime import UTC, datetime
from unittest.mock import MagicMock

from workers.tasks.video._core import ClipResult, SpeakerSegment, TopicBlock, WordTimestamp
from workers.tasks.video.ai import _hook_score, _topic_coherence_score
from workers.tasks.video.diarize import _assign_speakers_to_words
from workers.tasks.video.feedback import get_score_weight_adjustments
from workers.tasks.video.pipeline import _build_auto_publish_schedule
from workers.tasks.video.repair import _repair_all_clips
from workers.tasks.video.segment import _segment_topics


def _make_transcript(n_words=100):
    topic_a = "artificial intelligence machine learning model training data neural".split()
    topic_b = "cooking recipe pasta ingredients boil sauce olive garlic".split()
    words = []
    t = 0.0
    for i in range(n_words):
        pool = topic_a if i < n_words // 2 else topic_b
        w = pool[i % len(pool)]
        words.append(WordTimestamp(word=w, start=t, end=t + 0.4))
        t += 0.5
    return words


def test_auto_publish_schedule_honors_start_interval_and_day_rollover():
    now = datetime(2026, 7, 25, 10, tzinfo=UTC)
    schedule = _build_auto_publish_schedule(
        4,
        {
            "publish_per_day": 2,
            "publish_interval_hours": 6,
            "publish_start_at": "2026-07-26T09:00:00Z",
        },
        now,
    )

    assert schedule == [
        datetime(2026, 7, 26, 9, tzinfo=UTC),
        datetime(2026, 7, 26, 15, tzinfo=UTC),
        datetime(2026, 7, 27, 9, tzinfo=UTC),
        datetime(2026, 7, 27, 15, tzinfo=UTC),
    ]


def test_auto_publish_schedule_never_starts_in_past_and_supports_legacy_config():
    now = datetime(2026, 7, 25, 10, tzinfo=UTC)

    past = _build_auto_publish_schedule(
        2,
        {
            "publish_per_day": 2,
            "publish_interval_hours": 4,
            "publish_start_at": "2026-07-24T09:00:00Z",
        },
        now,
    )
    legacy = _build_auto_publish_schedule(1, {}, now)

    assert past == [now, datetime(2026, 7, 25, 14, tzinfo=UTC)]
    assert legacy == [now]


def test_auto_publish_schedule_clamps_legacy_interval_to_avoid_duplicate_slots():
    now = datetime(2026, 7, 25, 10, tzinfo=UTC)
    schedule = _build_auto_publish_schedule(
        4,
        {"publish_per_day": 3, "publish_interval_hours": 12},
        now,
    )

    assert schedule == [
        now,
        datetime(2026, 7, 25, 18, tzinfo=UTC),
        datetime(2026, 7, 26, 2, tzinfo=UTC),
        datetime(2026, 7, 26, 10, tzinfo=UTC),
    ]


def test_diarize_assign_full_pipeline():
    words = _make_transcript(50)
    segments = [SpeakerSegment(0.0, 12.5, "SPEAKER_00"), SpeakerSegment(12.5, 25.0, "SPEAKER_01")]
    labeled = _assign_speakers_to_words(words, segments)
    assert len(labeled) == 50
    assert labeled[0][1] == "SPEAKER_00"
    assert labeled[-1][1] == "SPEAKER_01"


def test_segment_topics_full_pipeline():
    words = _make_transcript(100)
    mock_llm = MagicMock(return_value={"topics": [
        {"block_index": 0, "topic": "AI", "keywords": ["ai"]},
        {"block_index": 1, "topic": "Cooking", "keywords": ["pasta"]},
    ]})
    blocks = _segment_topics(words, llm_fn=mock_llm, max_topics=4)
    assert len(blocks) >= 1


def test_repair_pipeline():
    words = _make_transcript(80)
    clips = [ClipResult(start=0.0, end=20.0, score=0.9, title="t", reason="r")]
    blocks = [TopicBlock(0, 40, "AI", [], start_sec=0.0, end_sec=20.0)]
    repaired = _repair_all_clips(clips, words, blocks)
    assert len(repaired) == 1
    assert repaired[0].end <= 20.5


def test_scoring_signals():
    words = _make_transcript(30)
    s = _hook_score(words, start=0.0, window=3.0)
    assert 0.0 <= s <= 1.0

    clip = ClipResult(start=0.0, end=5.0, score=0.8, title="t", reason="r")
    blocks = [TopicBlock(0, 50, "AI", [], start_sec=0.0, end_sec=10.0)]
    coh = _topic_coherence_score(clip, blocks)
    assert 0.0 <= coh <= 1.0


def test_feedback_weights_default():
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = []
    mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

    weights = get_score_weight_adjustments("tid", mock_engine)
    assert set(weights.keys()) >= {"hook_score", "audio_energy"}
