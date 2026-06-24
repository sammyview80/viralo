"""
Stage 6: Speaker diarization.
When SPEAKER_DIARIZATION_ENABLED=true + HF_TOKEN set: uses pyannote-audio 3.x.
Otherwise: single-speaker fallback (SPEAKER_00 for full video duration).
"""
import logging
import os

from workers.tasks.video._core import SpeakerSegment, WordTimestamp

__all__ = ['_diarize_audio', '_assign_speakers_to_words', '_save_speaker_segments']

log = logging.getLogger(__name__)


def _diarize_pyannote(audio_path: str, hf_token: str) -> list[SpeakerSegment]:
    """Run pyannote speaker diarization. Raises on import error or auth failure."""
    from pyannote.audio import Pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token,
    )
    diarization = pipeline(audio_path)
    segments: list[SpeakerSegment] = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(SpeakerSegment(
            start=round(turn.start, 3),
            end=round(turn.end, 3),
            speaker_id=speaker,
        ))
    return segments


def _diarize_audio(audio_path: str, duration: float) -> list[SpeakerSegment]:
    """
    Returns speaker segments for the audio.
    Falls back to single-speaker if pyannote disabled or unavailable.
    Reads SPEAKER_DIARIZATION_ENABLED and HF_TOKEN at call time.
    """
    enabled = os.getenv("SPEAKER_DIARIZATION_ENABLED", "false").lower() == "true"
    hf_token = os.getenv("HF_TOKEN", "")
    if not enabled or not hf_token:
        return [SpeakerSegment(start=0.0, end=duration, speaker_id="SPEAKER_00")]
    try:
        return _diarize_pyannote(audio_path, hf_token)
    except ImportError:
        log.warning("pyannote not installed — falling back to single speaker")
        return [SpeakerSegment(start=0.0, end=duration, speaker_id="SPEAKER_00")]
    except Exception as e:
        log.warning("diarization failed (%s) — falling back to single speaker", e)
        return [SpeakerSegment(start=0.0, end=duration, speaker_id="SPEAKER_00")]


def _assign_speakers_to_words(
    words: list[WordTimestamp],
    segments: list[SpeakerSegment],
) -> list[tuple[WordTimestamp, str]]:
    """
    Returns list of (word, speaker_id) pairs.
    Each word assigned to the segment whose midpoint contains it.
    Falls back to nearest segment.
    """
    if not segments:
        return [(w, "SPEAKER_00") for w in words]

    result: list[tuple[WordTimestamp, str]] = []
    for w in words:
        mid = (w.start + w.end) / 2
        assigned = None
        for seg in segments:
            if seg.start <= mid <= seg.end:
                assigned = seg.speaker_id
                break
        if assigned is None:
            nearest = min(segments, key=lambda s: abs((s.start + s.end) / 2 - mid))
            assigned = nearest.speaker_id
        result.append((w, assigned))
    return result


def _save_speaker_segments(
    tenant_id: str,
    video_id: str,
    segments: list[SpeakerSegment],
    engine,
) -> None:
    if not segments:
        return
    from sqlalchemy import text
    import uuid as _uuid
    rows = [
        {"id": str(_uuid.uuid4()), "tenant_id": tenant_id, "video_id": video_id,
         "speaker_id": s.speaker_id, "start_sec": s.start, "end_sec": s.end}
        for s in segments
    ]
    try:
        with engine.begin() as conn:
            conn.execute(
                text("""
                    DELETE FROM speaker_segments
                    WHERE video_id = CAST(:video_id AS uuid) AND tenant_id = CAST(:tenant_id AS uuid)
                """),
                {"video_id": video_id, "tenant_id": tenant_id},
            )
            conn.execute(
                text("""
                    INSERT INTO speaker_segments (id, tenant_id, video_id, speaker_id, start_sec, end_sec)
                    VALUES (:id, CAST(:tenant_id AS uuid), CAST(:video_id AS uuid), :speaker_id, :start_sec, :end_sec)
                """),
                rows,
            )
    except Exception as e:
        log.warning("_save_speaker_segments DB write failed: %s", e)
