"""
Stage 7: Topic segmentation.
Uses TextTiling-inspired window-based lexical cohesion to find topic boundaries,
then LLM to name each segment.
"""
import json
import logging
import math
import re
from collections import Counter

from workers.tasks.video._core import TopicBlock, WordTimestamp

__all__ = ['_segment_topics', '_text_tile_boundaries', '_save_topic_blocks']

log = logging.getLogger(__name__)


def _tokenize(word: str) -> str:
    return re.sub(r"[^a-z]", "", word.lower())


def _text_tile_boundaries(
    words: list[WordTimestamp],
    window: int = 20,
    k: int = 3,
) -> list[int]:
    """
    TextTiling: return word indices where topic shift is detected.
    window: words per pseudo-sentence; k: gap size for depth scoring.
    Returns sorted list of boundary word indices.
    """
    if len(words) < window * 2:
        return []

    # Build pseudo-sentences of `window` words each
    ps: list[Counter] = []
    for i in range(0, len(words), window):
        chunk = words[i: i + window]
        ps.append(Counter(_tokenize(w.word) for w in chunk if _tokenize(w.word)))

    if len(ps) < 2:
        return []

    # Lexical cohesion scores between adjacent blocks
    def cosine(a: Counter, b: Counter) -> float:
        keys = set(a) | set(b)
        dot = sum(a.get(k, 0) * b.get(k, 0) for k in keys)
        na = math.sqrt(sum(v ** 2 for v in a.values())) or 1
        nb = math.sqrt(sum(v ** 2 for v in b.values())) or 1
        return dot / (na * nb)

    scores = [cosine(ps[i], ps[i + 1]) for i in range(len(ps) - 1)]

    # Depth scoring: local minima
    depth: list[float] = []
    for i in range(len(scores)):
        left = max(scores[:i + 1]) if i > 0 else scores[i]
        right = max(scores[i:]) if i < len(scores) - 1 else scores[i]
        depth.append((left - scores[i]) + (right - scores[i]))

    if not depth:
        return []

    avg_d = sum(depth) / len(depth)
    std_d = math.sqrt(sum((d - avg_d) ** 2 for d in depth) / len(depth)) or 0.01
    threshold = avg_d - 0.5 * std_d

    # Convert pseudo-sentence boundaries back to word indices
    boundaries: list[int] = []
    for i, d in enumerate(depth):
        if d >= threshold:
            word_idx = (i + 1) * window
            if word_idx < len(words):
                boundaries.append(word_idx)

    return sorted(set(boundaries))


def _segment_topics(
    words: list[WordTimestamp],
    llm_fn,
    max_topics: int = 8,
) -> list[TopicBlock]:
    """
    Detect topic boundaries, then use LLM to name each block.
    Returns list of TopicBlock sorted by start_word_idx.
    """
    if not words:
        return []

    boundaries = _text_tile_boundaries(words)

    # Build segment word ranges
    indices = [0] + boundaries + [len(words)]
    blocks_raw: list[dict] = []
    for i in range(len(indices) - 1):
        s, e = indices[i], indices[i + 1]
        if e - s < 5:
            continue
        text_sample = " ".join(w.word for w in words[s:min(s + 60, e)])
        blocks_raw.append({
            "block_index": len(blocks_raw),
            "start_word_idx": s,
            "end_word_idx": e,
            "sample": text_sample,
        })

    if not blocks_raw:
        # fallback: single block
        blocks_raw = [{"block_index": 0, "start_word_idx": 0, "end_word_idx": len(words),
                       "sample": " ".join(w.word for w in words[:80])}]

    # Cap at max_topics by merging smallest adjacent blocks
    while len(blocks_raw) > max_topics:
        sizes = [b["end_word_idx"] - b["start_word_idx"] for b in blocks_raw]
        min_i = sizes.index(min(sizes))
        if min_i == 0:
            merge_i = 0
        elif min_i == len(blocks_raw) - 1:
            merge_i = len(blocks_raw) - 2
        else:
            merge_i = min_i if sizes[min_i - 1] > sizes[min_i + 1] else min_i - 1
        a, b_ = blocks_raw[merge_i], blocks_raw[merge_i + 1]
        blocks_raw[merge_i] = {
            "block_index": a["block_index"],
            "start_word_idx": a["start_word_idx"],
            "end_word_idx": b_["end_word_idx"],
            "sample": a["sample"][:200],
        }
        blocks_raw.pop(merge_i + 1)

    # LLM naming
    prompt = f"""You are analyzing a video transcript. Name each topic segment.

Segments (block_index, 60-word sample):
{chr(10).join(f'[{b["block_index"]}] {b["sample"][:200]}' for b in blocks_raw)}

Return JSON:
{{
  "topics": [
    {{"block_index": 0, "topic": "<concise topic name, 3-6 words>", "keywords": ["kw1", "kw2", "kw3"]}}
  ]
}}"""
    try:
        result = llm_fn(prompt, temperature=0.2)
        topic_map = {t["block_index"]: t for t in (result or {}).get("topics", [])}
    except Exception as e:
        log.warning("topic LLM failed: %s", e)
        topic_map = {}

    output: list[TopicBlock] = []
    for b in blocks_raw:
        t_info = topic_map.get(b["block_index"], {})
        start_sec = words[b["start_word_idx"]].start if b["start_word_idx"] < len(words) else 0.0
        end_sec = words[min(b["end_word_idx"] - 1, len(words) - 1)].end
        output.append(TopicBlock(
            start_word_idx=b["start_word_idx"],
            end_word_idx=b["end_word_idx"],
            topic=t_info.get("topic", f"Segment {b['block_index']}"),
            keywords=t_info.get("keywords", []),
            start_sec=round(start_sec, 2),
            end_sec=round(end_sec, 2),
        ))
    return output


def _save_topic_blocks(
    tenant_id: str,
    video_id: str,
    blocks: list[TopicBlock],
    engine,
) -> None:
    if not blocks:
        return
    from sqlalchemy import text
    import uuid as _uuid
    rows = [
        {"id": str(_uuid.uuid4()), "tenant_id": tenant_id, "video_id": video_id,
         "block_index": i, "topic": b.topic, "keywords": json.dumps(b.keywords),
         "start_sec": b.start_sec, "end_sec": b.end_sec}
        for i, b in enumerate(blocks)
    ]
    try:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM topic_blocks WHERE video_id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                {"v": video_id, "t": tenant_id},
            )
            conn.execute(
                text("""
                    INSERT INTO topic_blocks (id, tenant_id, video_id, block_index, topic, keywords, start_sec, end_sec)
                    VALUES (:id, CAST(:tenant_id AS uuid), CAST(:video_id AS uuid), :block_index,
                            :topic, CAST(:keywords AS jsonb), :start_sec, :end_sec)
                """),
                rows,
            )
    except Exception as e:
        log.warning("_save_topic_blocks DB write failed: %s", e)
