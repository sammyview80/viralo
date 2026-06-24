"""
Stage 10: Clip boundary repair.
Snaps clip start/end to natural sentence boundaries, respects topic block edges.
"""
import logging
import re
from dataclasses import replace as dataclass_replace

from workers.tasks.video._core import ClipResult, TopicBlock, WordTimestamp

__all__ = ['_repair_clip_boundaries', '_repair_all_clips']

log = logging.getLogger(__name__)

_SENTENCE_ENDERS = re.compile(r"[.!?]$")
_MIN_CLIP_SEC = 15.0
_MAX_CLIP_SEC = 120.0
_SNAP_WINDOW_SEC = 3.0  # max seconds to search for better boundary


def _find_sentence_end(words: list[WordTimestamp], after_sec: float, window: float = _SNAP_WINDOW_SEC) -> float:
    """Return the end time of the nearest sentence-ending word after `after_sec`."""
    candidates = [
        w.end for w in words
        if w.start >= after_sec and w.end <= after_sec + window
        and _SENTENCE_ENDERS.search(w.word.strip())
    ]
    return min(candidates) if candidates else after_sec


def _find_sentence_start(words: list[WordTimestamp], before_sec: float, window: float = _SNAP_WINDOW_SEC) -> float:
    """Return the start time of the word just after the nearest sentence end before `before_sec`."""
    ends_before = [
        (i, w) for i, w in enumerate(words)
        if w.end <= before_sec and w.start >= before_sec - window
        and _SENTENCE_ENDERS.search(w.word.strip())
    ]
    if not ends_before:
        return before_sec
    last_sent_idx = ends_before[-1][0]
    if last_sent_idx + 1 < len(words):
        return words[last_sent_idx + 1].start
    return before_sec


def _topic_block_for(sec: float, topic_blocks: list[TopicBlock]) -> TopicBlock | None:
    for tb in topic_blocks:
        if tb.start_sec <= sec <= tb.end_sec:
            return tb
    return None


def _repair_clip_boundaries(
    clip: ClipResult,
    words: list[WordTimestamp],
    topic_blocks: list[TopicBlock],
    min_duration: float = _MIN_CLIP_SEC,
    max_duration: float = _MAX_CLIP_SEC,
) -> ClipResult:
    """
    Snap clip start/end to sentence boundaries.
    Never cross a topic block boundary. Enforce min/max duration.
    Returns a new ClipResult (dataclass_replace — original unchanged).
    """
    new_start = clip.start
    new_end = clip.end

    snapped_start = _find_sentence_start(words, clip.start)
    if snapped_start < clip.start:
        new_start = snapped_start

    snapped_end = _find_sentence_end(words, clip.end)
    if snapped_end > clip.end:
        new_end = snapped_end

    topic_cap: float | None = None
    if topic_blocks:
        start_block = _topic_block_for(new_start, topic_blocks)
        if start_block:
            topic_cap = start_block.end_sec
            new_end = min(new_end, topic_cap)

    if new_end - new_start > max_duration:
        new_end = new_start + max_duration

    # Only extend for min_duration if it won't cross the topic boundary
    if new_end - new_start < min_duration:
        candidate = max(new_end, clip.end)
        if topic_cap is None or candidate <= topic_cap:
            new_end = candidate

    return dataclass_replace(clip, start=round(new_start, 3), end=round(new_end, 3))


def _repair_all_clips(
    clips: list[ClipResult],
    words: list[WordTimestamp],
    topic_blocks: list[TopicBlock],
) -> list[ClipResult]:
    return [_repair_clip_boundaries(c, words, topic_blocks) for c in clips]
