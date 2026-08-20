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
    'STYLE_FAMILY',
    'CAPCUT_STYLES',
    'BOLD_PILL_STYLES',
    'UPPERCASE_PILL_STYLES',
    'UPPERCASE_STYLES',
    '_effective_caption_style',
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
        with engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT clip_config->>'notification_user_id'
                    FROM videos
                    WHERE id = CAST(:vid AS uuid) AND tenant_id = CAST(:tid AS uuid)
                """),
                {"vid": video_id, "tid": tenant_id},
            ).fetchone()
        user_id = row[0] if row else None
        if not user_id:
            return
        from workers.tasks.notification import send_notification
        send_notification.delay(
            tenant_id,
            user_id=user_id,
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
    # highlight_rgba drives the active-word pill fill for word-by-word styles
    "capcut":      ((255, 255, 255, 255), (245, 197, 24, 255),  0.45, 62, (0, 0, 0, 160)),
    "capcut-bold": ((255, 230, 0, 255),   (245, 197, 24, 255),  0.40, 68, (0, 0, 0, 0)),
    "tiktok":      ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  56, (0, 0, 0, 170)),
    "word-pop":    ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  84, (0, 0, 0, 0)),
    "hormozi":     ((255, 255, 255, 255), (57, 255, 20, 255),   0.40, 66, (0, 0, 0, 0)),
    "beast":       ((255, 255, 255, 255), (255, 45, 45, 255),   0.40, 70, (0, 0, 0, 0)),
    "neon":        ((255, 255, 255, 255), (0, 229, 255, 255),   0.45, 62, (0, 0, 0, 140)),
    "karaoke":     ((255, 255, 255, 255), (245, 197, 24, 255),  1.0,  56, (0, 0, 0, 150)),
    "bounce":      ((255, 255, 255, 255), (245, 197, 24, 255),  1.0,  56, (0, 0, 0, 0)),
    "glow":        ((255, 255, 255, 255), (0, 229, 255, 255),   1.0,  58, (0, 0, 0, 0)),
    "shadow":      ((255, 255, 255, 255), (255, 61, 106, 255),  1.0,  66, (0, 0, 0, 0)),
    "highlighter": ((255, 255, 255, 255), (250, 204, 21, 255),  1.0,  56, (0, 0, 0, 140)),
    "rainbow":     ((255, 255, 255, 255), (245, 197, 24, 255),  1.0,  58, (0, 0, 0, 0)),
    "classic":     ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  52, (0, 0, 0, 140)),
    "impact":      ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  72, (0, 0, 0, 0)),
    "minimal":     ((200, 200, 200, 255), (255, 255, 255, 255), 0.8,  44, (0, 0, 0, 0)),
    # ── CapCut-Pro-style expansion pack ──
    "sunset":       ((255, 255, 255, 255), (255, 94, 126, 255),  0.45, 62, (0, 0, 0, 160)),
    "royal":        ((255, 255, 255, 255), (168, 85, 247, 255),  0.45, 62, (0, 0, 0, 160)),
    "ocean":        ((255, 255, 255, 255), (56, 189, 248, 255),  0.45, 62, (0, 0, 0, 160)),
    "bubble":       ((255, 255, 255, 255), (255, 122, 217, 255), 0.45, 62, (0, 0, 0, 0)),
    "banger":       ((255, 255, 255, 255), (255, 138, 0, 255),   0.40, 68, (0, 0, 0, 0)),
    "money":        ((255, 255, 255, 255), (34, 197, 94, 255),   0.40, 68, (0, 0, 0, 0)),
    "reveal-light": ((17, 17, 17, 255),    (255, 255, 255, 255), 1.0,  56, (255, 255, 255, 225)),
    "podcast":      ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  62, (20, 20, 20, 200)),
    "pop-yellow":   ((255, 230, 0, 255),   (255, 230, 0, 255),   1.0,  84, (0, 0, 0, 0)),
    "pop-red":      ((255, 45, 45, 255),   (255, 45, 45, 255),   1.0,  84, (0, 0, 0, 0)),
    "karaoke-green":((255, 255, 255, 255), (57, 255, 20, 255),   1.0,  56, (0, 0, 0, 150)),
    "karaoke-cyan": ((255, 255, 255, 255), (0, 229, 255, 255),   1.0,  56, (0, 0, 0, 150)),
    "comic":        ((255, 230, 0, 255),   (255, 230, 0, 255),   1.0,  66, (0, 0, 0, 0)),
    "cinema":       ((255, 255, 255, 255), (255, 255, 255, 255), 1.0,  50, (0, 0, 0, 120)),
}

# Visual family per style — drives the render dispatch in _draw_caption and the
# frontend preview card. Must stay in sync with CAPTION_STYLE_CATALOG (schemas.py).
STYLE_FAMILY = {
    "capcut": "pill", "capcut-bold": "pill", "hormozi": "pill", "beast": "pill",
    "neon": "pill", "sunset": "pill", "royal": "pill", "ocean": "pill",
    "bubble": "pill", "banger": "pill", "money": "pill",
    "tiktok": "reveal", "reveal-light": "reveal", "podcast": "reveal",
    "word-pop": "pop", "pop-yellow": "pop", "pop-red": "pop",
    "karaoke": "karaoke", "karaoke-green": "karaoke", "karaoke-cyan": "karaoke",
    "classic": "outline", "impact": "outline", "comic": "outline", "cinema": "outline",
    "minimal": "minimal",
}

# Styles rendered word-by-word (need word-level caption timeline)
CAPCUT_STYLES = {s for s, f in STYLE_FAMILY.items() if f in ("pill", "reveal", "pop", "karaoke")} | {
    "bounce", "glow", "highlighter", "rainbow",
}
# Word-pill styles drawn with the larger highlight font
BOLD_PILL_STYLES = {"capcut-bold", "hormozi", "beast", "banger", "money"}
# Pill styles drawn in ALL CAPS (their signature look)
UPPERCASE_PILL_STYLES = {"hormozi", "beast", "banger", "money"}
# Outline/pop styles drawn in ALL CAPS
UPPERCASE_STYLES = {"impact", "comic", "word-pop", "pop-yellow", "pop-red"}


def _effective_caption_style(cfg: dict) -> str:
    """Resolve the caption style: explicit user choice wins, unset = auto from template."""
    style = cfg.get("caption_style")
    if not style:
        from workers.tasks.templates import resolve_template
        tmpl = resolve_template(cfg.get("occasion"), cfg.get("template_id"))
        style = tmpl.get("caption_style", "capcut")
    return style if style in CAPTION_STYLE_CFG else "capcut"

FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    # CJK / Arabic / broad Unicode
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
    "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
    # Emoji
    "/System/Library/Fonts/Apple Color Emoji.ttc",
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
]

redis_client = redis.from_url(
    REDIS_URL, max_connections=5,
    socket_connect_timeout=10, socket_timeout=10,
)
engine = create_engine(
    SYNC_DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    pool_recycle=3600,
    pool_timeout=30,
    connect_args={"connect_timeout": 10},
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
                    SELECT array_remove(array_agg(lower(u.email)), NULL) AS emails,
                           p.name AS plan_name
                    FROM tenants t
                    LEFT JOIN users u ON u.tenant_id = t.id
                    LEFT JOIN subscriptions sub ON sub.tenant_id = t.id AND sub.status = 'active'
                    LEFT JOIN plans p ON p.id = sub.plan_id
                    WHERE t.id = CAST(:tid AS uuid)
                    GROUP BY p.name, sub.updated_at
                    ORDER BY sub.updated_at DESC NULLS LAST
                    LIMIT 1
                """),
                {"tid": str(tenant_id)},
            ).fetchone()
        if not row:
            return False
        emails, plan_name = row
        if any(email in _UNLIMITED_EMAILS for email in (emails or [])):
            return True
        # free plan has video_duration_limit_min set; all others (pro/starter/creator/unlimited) are None
        from shared.plan_gate import get_plan_features
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
    payload = json.dumps({
        "job_id": job_id, "step": step, "pct": pct, "status": status, "message": message,
    })
    try:
        redis_client.setex(f"job:{job_id}:progress:last", 3600, payload)
    except Exception as exc:
        logging.warning("Could not cache progress for job %s: %s", job_id, exc)
    try:
        redis_client.publish(f"job:{job_id}:progress", payload)
    except Exception as exc:
        logging.warning("Could not publish progress for job %s: %s", job_id, exc)


def _publish_clip_event(job_id: str, event: str, payload: dict) -> None:
    msg = json.dumps({"event": event, **payload})
    # Publish on job channel (task ID) AND video_id channel so frontend can subscribe by either key
    channels = [f"job:{job_id}:clips"]
    if video_id := payload.get("video_id"):
        channels.append(f"job:{video_id}:clips")
    for channel in channels:
        try:
            redis_client.publish(channel, msg)
        except Exception as exc:
            logging.warning("Could not publish clip event on %s: %s", channel, exc)


def _update_video(tenant_id: str, video_id: str, notify_webhook: bool = True, **kwargs) -> None:
    """
    notify_webhook: set False when this 'failed' write is an intermediate state
    before a self.retry() call — a retry that later succeeds must not have
    already fired a 'video.failed' webhook. Callers on a retry path should
    only pass True once retries are actually exhausted (this attempt is final).
    """
    if not kwargs:
        return
    set_parts = ", ".join(f"{k} = :{k}" for k in kwargs)
    with _get_session(tenant_id) as session:
        session.execute(
            text(f"UPDATE videos SET {set_parts}, updated_at = NOW() WHERE id = CAST(:vid AS uuid)"),
            {**kwargs, "vid": video_id},
        )

    status = kwargs.get("status")
    if notify_webhook and status in ("ready", "failed"):
        try:
            from workers.tasks.webhook import enqueue_video_webhook
            enqueue_video_webhook(tenant_id, video_id, status, kwargs.get("error_message"))
        except Exception:
            logging.warning("_update_video: failed to enqueue webhook for video %s", video_id)


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
