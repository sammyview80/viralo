"""
Smoke test: verifies new pipeline stages don't crash on synthetic word data.
Does NOT require real video files or LLM calls.
"""
import json
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from workers.tasks.video._core import ClipResult, SpeakerSegment, TopicBlock, WordTimestamp
from workers.tasks.video.ai import _hook_score, _topic_coherence_score
from workers.tasks.video.diarize import _assign_speakers_to_words
from workers.tasks.video.feedback import get_score_weight_adjustments
from workers.tasks.video.pipeline import (
    _auto_publish_content,
    _auto_schedule_clips,
    _build_auto_publish_schedule,
)
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


def test_auto_publish_content_reuses_ai_copy_and_youtube_fields():
    metadata = {
        "ai_title": "AI-generated title",
        "platforms": {
            "shorts": {
                "description": "AI hook based on this clip.",
                "tags": ["Viral", "#Topic", "#Topic"],
            },
        },
        "trending_hashtags": ["#fallback"],
    }

    caption, tags, kwargs = _auto_publish_content(
        "Original title", metadata, "youtube"
    )

    assert caption == "AI hook based on this clip."
    assert tags == ["viral", "topic"]
    assert kwargs == {
        "title": "AI-generated title",
        "description": "AI hook based on this clip.",
        "tags": ["viral", "topic"],
    }


def test_auto_publish_content_preserves_caption_override_for_youtube():
    caption, tags, kwargs = _auto_publish_content(
        "Original title",
        {
            "social": {
                "shorts": {
                    "description": "AI description",
                    "tags": ["#Shorts"],
                },
            },
        },
        "youtube",
        "Channel caption template",
    )

    assert caption == "Channel caption template"
    assert tags == ["shorts"]
    assert kwargs["description"] == caption


def test_auto_schedule_clips_binds_ai_content_to_scheduled_post():
    account_id = uuid.uuid4()
    clip_id = uuid.uuid4()
    account_rows = MagicMock()
    account_rows.fetchall.return_value = [(account_id, "youtube")]
    clip_rows = MagicMock()
    clip_rows.fetchall.return_value = [(
        clip_id,
        "AI title",
        {
            "platforms": {
                "shorts": {
                    "description": "AI description",
                    "tags": ["#Viral", "Topic"],
                },
            },
        },
    )]
    session = MagicMock()
    session.execute.side_effect = [account_rows, clip_rows, MagicMock()]

    @contextmanager
    def fake_session(_tenant_id):
        yield session

    with patch("workers.tasks.video.pipeline._get_session", fake_session):
        _auto_schedule_clips(
            str(uuid.uuid4()),
            [clip_id],
            {"social_account_ids": [str(account_id)]},
        )

    insert_params = session.execute.call_args_list[2].args[1]
    assert insert_params["caption"] == "AI description"
    assert json.loads(insert_params["hashtags"]) == ["viral", "topic"]
    assert json.loads(insert_params["platform_kwargs"]) == {
        "title": "AI title",
        "description": "AI description",
        "tags": ["viral", "topic"],
    }


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
