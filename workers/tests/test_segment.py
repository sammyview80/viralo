from unittest.mock import MagicMock
from workers.tasks.video._core import WordTimestamp, TopicBlock
from workers.tasks.video.segment import _segment_topics, _text_tile_boundaries


def _make_words(sentences: list[str]) -> list[WordTimestamp]:
    words = []
    t = 0.0
    for sent in sentences:
        for w in sent.split():
            words.append(WordTimestamp(word=w, start=t, end=t + 0.5))
            t += 0.5
        t += 1.0  # pause between sentences
    return words


def test_text_tile_returns_boundary_indices():
    # 3 distinct topics, 10 words each
    topic_a = ["ai machine learning deep neural networks transform industry today forever"] * 1
    topic_b = ["cooking recipe pasta ingredients boil water salt olive garlic sauce"] * 1
    sentences = topic_a + topic_b
    words = _make_words(sentences)
    boundaries = _text_tile_boundaries(words, window=5, k=1)
    assert isinstance(boundaries, list)
    assert all(isinstance(b, int) for b in boundaries)


def test_segment_topics_returns_topic_blocks():
    words = _make_words([
        "artificial intelligence transforming healthcare diagnosis treatment",
        "cooking recipes pasta ingredients preparation techniques",
    ])
    mock_llm = MagicMock(return_value={"topics": [
        {"block_index": 0, "topic": "AI in Healthcare", "keywords": ["ai", "healthcare"]},
        {"block_index": 1, "topic": "Cooking", "keywords": ["pasta", "recipes"]},
    ]})
    blocks = _segment_topics(words, llm_fn=mock_llm, max_topics=4)
    assert len(blocks) >= 1
    assert all(isinstance(b, TopicBlock) for b in blocks)


def test_segment_empty_words():
    blocks = _segment_topics([], llm_fn=MagicMock(), max_topics=4)
    assert blocks == []
