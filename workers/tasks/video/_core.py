"""
Video processing pipeline — ClipForge-based.
PyAV for video I/O (no ffmpeg needed for clip export/audio).
Groq Whisper (word timestamps) + Groq LLaMA for AI scoring.
Pillow for caption burn-in.
ffmpeg still used for YouTube download + metadata probe fallback.
"""
import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field, replace as dataclass_replace
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Optional

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app


__all__ = [
    '_get_video_title_from_db',
    '_notify_video',
    'REDIS_URL',
    'DATABASE_URL',
    'SYNC_DATABASE_URL',
    'VIDEO_TEMP_DIR',
    'GROQ_WHISPER_MODEL',
    'GROQ_LLM_MODEL',
    'GROQ_MAX_AUDIO_MB',
    'VIDEO_CRF',
    'AUDIO_BITRATE',
    'CAPTION_BURN_MAX_SECONDS',
    'CAPTION_LEAD_SEC',
    'MAX_VIDEO_DURATION_SEC',
    'MIN_VIDEO_DURATION_SEC',
    '_UNLIMITED_EMAILS',
    'REFRAME_PRESETS',
    'QUALITY_CAP',
    'CAPTION_STYLE_CFG',
    'CAPCUT_STYLES',
    'FONT_PATHS',
    'redis_client',
    'engine',
    '_atexit',
    'WordTimestamp',
    'CaptionSegment',
    'ClipResult',
    'VideoMeta',
    'SpeakerSegment',
    'TopicBlock',
    'SceneFrame',
    '_is_unlimited',
    '_get_session',
    '_publish_progress',
    '_publish_clip_event',
    '_update_video',
    '_check_cancelled',
    '_save_step_artifact',
    '_save_transcript',
    'LLM_PROVIDERS',
    '_shared_call_llm_json',
    'probe_all_providers',
    '_call_llm_json',
    '_generate_srt',
    '_srt_to_plain',
]

def _get_video_title_from_db(tenant_id: str, video_id: str) -> str:
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT title FROM videos WHERE id = CAST(:vid AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
                {"vid": video_id, "tid": tenant_id},
            ).fetchone()
        return (row[0] or "") if row else ""
    except Exception:
        return ""


def _notify_video(tenant_id: str, video_id: str, notif_type: str, title: str, body: str) -> None:
    """Best-effort notification — never raises, never blocks the pipeline."""
    try:
        from workers.tasks.notification import send_notification
        send_notification.delay(
            tenant_id,
            user_id=None,
            type=notif_type,
            title=title,
            body=body,
            action_url=f"/projects/{video_id}",
            metadata={"video_id": video_id},
        )
    except Exception:
        logging.warning("_notify_video: failed to enqueue notification for video %s", video_id)

# ── Config ────────────────────────────────────────────────────────────────────

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
VIDEO_TEMP_DIR = os.getenv("VIDEO_TEMP_DIR", "/tmp/viralo-video")

GROQ_WHISPER_MODEL = "whisper-large-v3-turbo"
GROQ_LLM_MODEL = "llama-3.3-70b-versatile"
GROQ_MAX_AUDIO_MB = 24
VIDEO_CRF = 23          # visually good quality; 16 was near-lossless but 10x slower
AUDIO_BITRATE = 256_000  # 256kbps — high fidelity AAC
CAPTION_BURN_MAX_SECONDS = 120
CAPTION_LEAD_SEC = 0.15  # YouTube-style 150ms pre-roll; Whisper word timestamps have ±100-300ms variable bias
MAX_VIDEO_DURATION_SEC = 1800  # 30 minutes — reject longer videos before download
MIN_VIDEO_DURATION_SEC = 60   # 1 minute — skip very short videos (auto-clip from channels)
# Tenants in this set bypass the duration limit (comma-separated emails in env)
_UNLIMITED_EMAILS = {e.strip().lower() for e in os.getenv("UNLIMITED_DURATION_EMAILS", "aman@viralo.com,bidhya@viralo.com").split(",") if e.strip()}

REFRAME_PRESETS = {
    "9:16":  (1080, 1920, "9:16"),
    "16:9":  (1920, 1080, "16:9"),
    "1:1":   (1080, 1080, "1:1"),
    "4:5":   (1080, 1350, "4:5"),
    "tiktok":  (1080, 1920, "9:16"),
    "reels":   (1080, 1920, "9:16"),
    "shorts":  (1080, 1920, "9:16"),
}

# Max long-edge pixels per quality tier (None = no cap)
QUALITY_CAP = {
    "source": None,
    "1080p": 1080,
    "720p":  720,
    "480p":  480,
    "360p":  360,
}

CAPTION_STYLE_CFG = {
    # style: (text_rgba, highlight_rgba, context_alpha, font_size, bg_rgba)
    "capcut":      ((255, 255, 255, 255), (245, 197, 24, 255),  0.45, 62, (0, 0, 0, 160)),
    "capcut-bold": ((255, 230, 0, 255),   (255, 255, 255, 255), 0.40, 68, (0, 0, 0, 0)),
    "classic":     ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  52, (0, 0, 0, 140)),
    "minimal":     ((200, 200, 200, 255), (255, 255, 255, 255), 0.8,  44, (0, 0, 0, 0)),
}
CAPCUT_STYLES = {"capcut", "capcut-bold"}

FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]

redis_client = redis.from_url(REDIS_URL, max_connections=5)
engine = create_engine(
    SYNC_DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    pool_recycle=3600,
    pool_timeout=30,
)
import atexit as _atexit
_atexit.register(lambda: engine.dispose())


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class WordTimestamp:
    word: str
    start: float
    end: float


@dataclass
class CaptionSegment:
    text: str
    start: float
    end: float
    words: list = field(default_factory=list)


@dataclass
class ClipResult:
    start: float
    end: float
    score: float
    title: str
    reason: str
    platform: str = "tiktok"
    audio_energy: float | None = None
    speech_rate: float | None = None
    chapter_match: bool = False
    hook_score: float = 0.0
    speaker_id: str | None = None
    topic_id: int | None = None


@dataclass
class VideoMeta:
    duration: float
    width: int
    height: int
    fps: float
    codec: str
    has_audio: bool
    audio_sample_rate: int = 44100
    audio_channels: int = 2


@dataclass
class SpeakerSegment:
    start: float
    end: float
    speaker_id: str  # e.g. "SPEAKER_00"


@dataclass
class TopicBlock:
    start_word_idx: int
    end_word_idx: int
    topic: str
    keywords: list[str] = field(default_factory=list)
    start_sec: float = 0.0
    end_sec: float = 0.0


@dataclass
class SceneFrame:
    time_sec: float
    path: str


# ── DB / Redis helpers ────────────────────────────────────────────────────────

def _is_unlimited(tenant_id: str) -> bool:
    """Return True if tenant's plan has no duration limit (pro+ or bypass email)."""
    try:
        with Session(engine) as s:
            row = s.execute(
                text("""
                    SELECT u.email, p.name AS plan_name
                    FROM users u
                    LEFT JOIN subscriptions sub ON sub.tenant_id = u.id AND sub.status = 'active'
                    LEFT JOIN plans p ON p.id = sub.plan_id
                    WHERE u.id = CAST(:tid AS uuid)
                    LIMIT 1
                """),
                {"tid": str(tenant_id)},
            ).fetchone()
        if not row:
            return False
        email, plan_name = row
        if email and email.lower() in _UNLIMITED_EMAILS:
            return True
        # free plan has video_duration_limit_min set; all others (pro/starter/creator/unlimited) are None
        from shared.shared.plan_gate import get_plan_features
        features = get_plan_features(plan_name or "free")
        return features.video_duration_limit_min is None
    except Exception:
        return False


@contextmanager
def _get_session(tenant_id: str):
    with Session(engine) as session:
        session.execute(text("SET LOCAL app.current_tenant = :tid"), {"tid": str(tenant_id)})
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def _publish_progress(job_id: str, step: str, pct: int, status: str, message: str = "") -> None:
    redis_client.publish(f"job:{job_id}:progress", json.dumps({
        "job_id": job_id, "step": step, "pct": pct, "status": status, "message": message,
    }))


def _publish_clip_event(job_id: str, event: str, payload: dict) -> None:
    msg = json.dumps({"event": event, **payload})
    # Publish on job channel (task ID) AND video_id channel so frontend can subscribe by either key
    redis_client.publish(f"job:{job_id}:clips", msg)
    video_id = payload.get("video_id") or payload.get("clip_id", "")[:0]  # video_id in payload when available
    if video_id:
        redis_client.publish(f"job:{video_id}:clips", msg)


def _update_video(tenant_id: str, video_id: str, **kwargs) -> None:
    if not kwargs:
        return
    set_parts = ", ".join(f"{k} = :{k}" for k in kwargs)
    with _get_session(tenant_id) as session:
        session.execute(
            text(f"UPDATE videos SET {set_parts}, updated_at = NOW() WHERE id = CAST(:vid AS uuid)"),
            {**kwargs, "vid": video_id},
        )


def _check_cancelled(tenant_id: str, video_id: str) -> bool:
    """Return True if video was cancelled — worker should stop."""
    with _get_session(tenant_id) as session:
        row = session.execute(
            text("SELECT status FROM videos WHERE id = CAST(:vid AS uuid)"),
            {"vid": video_id},
        ).fetchone()
    return row is not None and row[0] == "cancelled"


def _save_step_artifact(tenant_id: str, video_id: str, step: str, data: dict) -> None:
    artifact = json.dumps({step: {**data, "completed_at": datetime.utcnow().isoformat()}})
    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                UPDATE videos
                SET step_artifacts = COALESCE(step_artifacts, '{}'::jsonb) || CAST(:artifact AS jsonb)
                WHERE id = CAST(:vid AS uuid)
            """),
            {"artifact": artifact, "vid": video_id},
        )


def _save_transcript(tenant_id: str, video_id: str, words: list[WordTimestamp]) -> None:
    segments = []
    current, cur_start = [], None
    for w in words:
        if cur_start is None:
            cur_start = w.start
        current.append(w)
        if w.word.endswith((".", "!", "?")) or len(current) >= 20:
            segments.append({
                "start": cur_start, "end": current[-1].end,
                "text": " ".join(x.word for x in current),
            })
            current, cur_start = [], None
    if current:
        segments.append({
            "start": cur_start, "end": current[-1].end,
            "text": " ".join(x.word for x in current),
        })

    full_text = " ".join(w.word for w in words)
    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                INSERT INTO transcripts
                  (id, tenant_id, video_id, language, segments, full_text, created_at)
                VALUES
                  (:id, CAST(:tid AS uuid), CAST(:vid AS uuid), :lang, CAST(:segs AS jsonb), :txt, NOW())
                ON CONFLICT (video_id)
                DO UPDATE SET segments = EXCLUDED.segments, full_text = EXCLUDED.full_text
            """),
            {
                "id": str(uuid.uuid4()), "tid": tenant_id, "vid": video_id,
                "lang": "en",
                "segs": json.dumps(segments),
                "txt": full_text,
            },
        )


# ── Stage 1: Probe video via PyAV ─────────────────────────────────────────────

from shared.llm import LLM_PROVIDERS, call_llm_json as _shared_call_llm_json, probe_all_providers  # noqa: F401


def _call_llm_json(
    messages: list[dict],
    temperature: float = 0.3,
    max_tokens: int = 1000,
    prefer_large: bool = True,
    _progress_fn=None,
) -> dict:
    """Thin shim — delegates to shared.llm.call_llm_json with the global free-tier hierarchy."""
    return _shared_call_llm_json(
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        prefer_large=prefer_large,
        notify=_progress_fn,
    )


# ── Stage 4: AI clip scoring via Groq LLaMA ───────────────────────────────────

def _generate_srt(captions: list[CaptionSegment]) -> str:
    def ts(s: float) -> str:
        h = int(s // 3600)
        m = int((s % 3600) // 60)
        sec = int(s % 60)
        ms = int((s % 1) * 1000)
        return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"
    lines = []
    for i, seg in enumerate(captions, 1):
        lines.append(f"{i}\n{ts(seg.start)} --> {ts(seg.end)}\n{seg.text}\n")
    return "\n".join(lines)


# ── Stage 7: Rendering via PyAV + Pillow ──────────────────────────────────────

def _srt_to_plain(srt: str) -> str:
    """Strip SRT timestamps/indices, return plain text."""
    import re as _re
    lines = []
    for line in srt.splitlines():
        line = line.strip()
        if not line or line.isdigit():
            continue
        if _re.match(r"\d{2}:\d{2}:\d{2}", line):
            continue
        lines.append(line)
    return " ".join(lines)


