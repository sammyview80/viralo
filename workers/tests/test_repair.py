from workers.tasks.video._core import ClipResult, WordTimestamp, TopicBlock
from workers.tasks.video.repair import _repair_clip_boundaries


def _w(word, start, end):
    return WordTimestamp(word=word, start=start, end=end)


def test_snaps_end_to_sentence_boundary():
    words = [
        _w("Hello", 0.0, 0.5), _w("world", 0.5, 1.0), _w(".", 1.0, 1.1),
        _w("This", 2.0, 2.4), _w("is", 2.4, 2.6), _w("great", 2.6, 3.0), _w(".", 3.0, 3.1),
        _w("Okay", 5.0, 5.4), _w("bye", 5.4, 5.8), _w(".", 5.8, 5.9),
    ]
    clip = ClipResult(start=0.0, end=2.8, score=0.9, title="t", reason="r")
    repaired = _repair_clip_boundaries(clip, words, topic_blocks=[])
    # Should extend end to 3.1 (end of sentence "This is great.")
    assert repaired.end >= 3.0


def test_no_topic_boundary_crossing():
    words = [_w(f"w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(20)]
    clip = ClipResult(start=0.0, end=6.0, score=0.9, title="t", reason="r")
    topic_blocks = [
        TopicBlock(0, 10, "Topic A", [], start_sec=0.0, end_sec=4.5),
        TopicBlock(10, 20, "Topic B", [], start_sec=5.0, end_sec=10.0),
    ]
    repaired = _repair_clip_boundaries(clip, words, topic_blocks)
    # Clip crosses topic boundary — should not extend past topic A end
    assert repaired.end <= 4.5 + 0.5  # small tolerance


def test_minimum_duration_preserved():
    words = [_w("Hi", 0.0, 0.5), _w("ok", 0.5, 1.0)]
    clip = ClipResult(start=0.0, end=0.8, score=0.9, title="t", reason="r")
    repaired = _repair_clip_boundaries(clip, words, topic_blocks=[], min_duration=15.0)
    # Can't reach min duration but shouldn't crash
    assert repaired.end >= clip.end
