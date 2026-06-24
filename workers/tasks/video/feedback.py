"""
Stage 17: Feedback loop — record user actions on clips, derive scoring weight adjustments.
"""
import json
import logging
import uuid

from sqlalchemy import text

__all__ = ['record_clip_feedback', 'get_score_weight_adjustments']

log = logging.getLogger(__name__)

_DEFAULT_WEIGHTS = {
    "hook_score": 1.0,
    "audio_energy": 0.8,
    "speech_rate": 0.5,
    "topic_coherence": 0.7,
    "ai_score": 1.0,
}

_ACTION_MULTIPLIERS = {
    "approve": 1.0,
    "export": 1.2,
    "reject": -1.0,
    "edit_boundary": 0.3,  # weak positive signal — user kept the clip but tweaked it
}


def record_clip_feedback(
    tenant_id: str,
    clip_id: str,
    video_id: str,
    action: str,
    original_start: float | None,
    original_end: float | None,
    edited_start: float | None,
    edited_end: float | None,
    original_score: float | None,
    clip_signals: dict | None,
    engine,
) -> None:
    """Persist a feedback event for a clip action."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO clip_score_feedback
                    (id, tenant_id, clip_id, video_id, action,
                     original_start, original_end, edited_start, edited_end,
                     original_score, clip_signals)
                    VALUES
                    (CAST(:id AS uuid), CAST(:tenant_id AS uuid), CAST(:clip_id AS uuid),
                     CAST(:video_id AS uuid), :action,
                     :original_start, :original_end, :edited_start, :edited_end,
                     :original_score, CAST(:clip_signals AS jsonb))
                """),
                {
                    "id": str(uuid.uuid4()),
                    "tenant_id": tenant_id,
                    "clip_id": clip_id,
                    "video_id": video_id,
                    "action": action,
                    "original_start": original_start,
                    "original_end": original_end,
                    "edited_start": edited_start,
                    "edited_end": edited_end,
                    "original_score": original_score,
                    "clip_signals": json.dumps(clip_signals or {}),
                },
            )
    except Exception as e:
        log.warning("record_clip_feedback failed: %s", e)


def get_score_weight_adjustments(tenant_id: str, engine) -> dict:
    """
    Derive per-signal weight multipliers from feedback history.
    Approved/exported clips with high signal X → increase X weight.
    Rejected clips with high signal X → decrease X weight.
    Returns dict of signal_name → weight_multiplier (float, typically 0.5–2.0).
    """
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT action, clip_signals
                    FROM clip_score_feedback
                    WHERE tenant_id = CAST(:t AS uuid)
                    ORDER BY created_at DESC
                    LIMIT 200
                """),
                {"t": tenant_id},
            ).fetchall()
    except Exception as e:
        log.warning("get_score_weight_adjustments DB read failed: %s", e)
        return dict(_DEFAULT_WEIGHTS)

    if not rows:
        return dict(_DEFAULT_WEIGHTS)

    signal_sums: dict[str, float] = {k: 0.0 for k in _DEFAULT_WEIGHTS}
    signal_counts: dict[str, int] = {k: 0 for k in _DEFAULT_WEIGHTS}

    for row in rows:
        action = row[0]
        signals = row[1] if isinstance(row[1], dict) else (json.loads(row[1]) if row[1] else {})
        multiplier = _ACTION_MULTIPLIERS.get(action, 0.0)
        for sig in _DEFAULT_WEIGHTS:
            val = signals.get(sig)
            if val is not None:
                signal_sums[sig] += float(val) * multiplier
                signal_counts[sig] += 1

    weights: dict[str, float] = {}
    for sig, default_w in _DEFAULT_WEIGHTS.items():
        count = signal_counts[sig]
        if count == 0:
            weights[sig] = default_w
        else:
            avg = signal_sums[sig] / count
            adjusted = default_w * (1.0 + avg * 0.2)
            weights[sig] = round(max(0.1, min(3.0, adjusted)), 3)

    return weights
