from workers.tasks.video._core import SpeakerSegment, TopicBlock, SceneFrame, ClipResult


def test_speaker_segment_fields():
    s = SpeakerSegment(start=0.0, end=5.0, speaker_id="SPEAKER_00")
    assert s.start == 0.0
    assert s.speaker_id == "SPEAKER_00"


def test_topic_block_fields():
    t = TopicBlock(start_word_idx=0, end_word_idx=50, topic="AI trends", keywords=["ai", "llm"])
    assert t.topic == "AI trends"


def test_clip_result_has_hook_score():
    c = ClipResult(start=0.0, end=30.0, score=0.8, title="test", reason="test")
    assert c.hook_score == 0.0
    assert c.speaker_id is None
    assert c.topic_id is None
