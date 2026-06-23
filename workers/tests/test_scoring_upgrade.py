from workers.tasks.video._core import WordTimestamp, ClipResult, TopicBlock
from workers.tasks.video.ai import _hook_score, _topic_coherence_score


def _w(word, start, end):
    return WordTimestamp(word=word, start=start, end=end)


def test_hook_score_detects_power_words():
    words = [
        _w("Why", 0.0, 0.3), _w("does", 0.3, 0.5), _w("nobody", 0.5, 0.8),
        _w("talk", 0.8, 1.0), _w("about", 1.0, 1.3), _w("this", 1.3, 1.5),
    ]
    score = _hook_score(words, start=0.0, window=3.0)
    assert 0.0 <= score <= 1.0
    assert score > 0.3  # "Why" + "nobody" are power words


def test_hook_score_low_for_filler():
    words = [_w(w, i * 0.5, i * 0.5 + 0.4)
             for i, w in enumerate(["and", "then", "so", "we", "just", "said"])]
    score = _hook_score(words, start=0.0, window=3.0)
    assert score < 0.3


def test_topic_coherence_full_inside():
    clip = ClipResult(start=1.0, end=4.0, score=0.8, title="t", reason="r")
    blocks = [TopicBlock(0, 100, "AI", [], start_sec=0.0, end_sec=10.0)]
    score = _topic_coherence_score(clip, blocks)
    assert score == 1.0


def test_topic_coherence_crosses_boundary():
    clip = ClipResult(start=3.0, end=7.0, score=0.8, title="t", reason="r")
    blocks = [
        TopicBlock(0, 50, "Topic A", [], start_sec=0.0, end_sec=5.0),
        TopicBlock(50, 100, "Topic B", [], start_sec=5.0, end_sec=10.0),
    ]
    score = _topic_coherence_score(clip, blocks)
    assert score < 1.0
