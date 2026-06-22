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

def _probe_video(source_path: str) -> VideoMeta:
    import av
    with av.open(source_path) as container:
        video = next((s for s in container.streams if s.type == "video"), None)
        audio = next((s for s in container.streams if s.type == "audio"), None)
        if video is None:
            raise RuntimeError("No video stream found")
        duration = float(container.duration) / 1_000_000 if container.duration else 0.0
        fps = float(video.average_rate) if video.average_rate else 30.0
        width = video.codec_context.width
        height = video.codec_context.height
        codec = video.codec_context.name
        sr = audio.codec_context.sample_rate if audio else 44100
        ch = audio.codec_context.channels if audio else 0
    return VideoMeta(
        duration=duration, width=width, height=height,
        fps=round(fps, 2), codec=codec, has_audio=audio is not None,
        audio_sample_rate=sr, audio_channels=ch,
    )


# ── Stage 2: Extract audio via PyAV (in-memory, no ffmpeg) ────────────────────

def _extract_audio_bytes(source_path: str, start: float = 0.0, end: float = None) -> bytes:
    import av
    buf = io.BytesIO()
    with av.open(source_path) as src:
        audio_stream = next((s for s in src.streams if s.type == "audio"), None)
        if audio_stream is None:
            return b""
        with av.open(buf, "w", format="mp3") as dst:
            out_stream = dst.add_stream("mp3", rate=16000, layout="mono")
            if start > 0:
                src.seek(int(start * 1_000_000), stream=audio_stream)
            for frame in src.decode(audio_stream):
                t = float(frame.pts * audio_stream.time_base)
                if t < start:
                    continue
                if end is not None and t > end:
                    break
                frame.pts = None
                for packet in out_stream.encode(frame):
                    dst.mux(packet)
            for packet in out_stream.encode(None):
                dst.mux(packet)
    return buf.getvalue()


def _prepare_audio_chunks(source_path: str, duration: float) -> list[tuple[bytes, float]]:
    estimated_mb = duration / 60.0 * 1.2
    if estimated_mb <= GROQ_MAX_AUDIO_MB:
        return [(_extract_audio_bytes(source_path), 0.0)]
    num_chunks = int(estimated_mb / GROQ_MAX_AUDIO_MB) + 1
    chunk_dur = duration / num_chunks
    chunks = []
    for i in range(num_chunks):
        start = i * chunk_dur
        end = min((i + 1) * chunk_dur + 2.0, duration)
        chunks.append((_extract_audio_bytes(source_path, start=start, end=end), start))
    return chunks


# ── Stage 3: Transcribe via Groq Whisper (word-level timestamps) ──────────────

def _get_attr(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _parse_words(response, offset: float) -> list[WordTimestamp]:
    words = []
    # 1. Top-level response.words
    raw = getattr(response, "words", None) or []
    for w in raw:
        text = (_get_attr(w, "word") or "").strip()
        if not text:
            continue
        words.append(WordTimestamp(
            word=text,
            start=round(float(_get_attr(w, "start") or 0) + offset, 3),
            end=round(float(_get_attr(w, "end") or 0) + offset, 3),
        ))
    if words:
        return words

    # 2. Nested segments[].words
    for seg in (getattr(response, "segments", None) or []):
        for w in (_get_attr(seg, "words") or []):
            text = (_get_attr(w, "word") or "").strip()
            if not text:
                continue
            words.append(WordTimestamp(
                word=text,
                start=round(float(_get_attr(w, "start") or 0) + offset, 3),
                end=round(float(_get_attr(w, "end") or 0) + offset, 3),
            ))
    if words:
        return words

    # 3. Approximate: character-proportional split over segment duration.
    # Even split ignores word length — long words get the same slot as short words,
    # causing captions to fall behind on long words and run ahead on short ones.
    # Weighting by character count tracks phoneme count better.
    for seg in (getattr(response, "segments", None) or []):
        seg_text = (_get_attr(seg, "text") or "").strip()
        seg_start = float(_get_attr(seg, "start") or 0)
        seg_end = float(_get_attr(seg, "end") or 0)
        tokens = seg_text.split()
        if not tokens:
            continue
        seg_dur = max(seg_end - seg_start, 0.01)
        char_counts = [max(len(t), 1) for t in tokens]
        total_chars = sum(char_counts)
        t = seg_start
        for token, chars in zip(tokens, char_counts):
            dur = seg_dur * (chars / total_chars)
            words.append(WordTimestamp(
                word=token,
                start=round(t + offset, 3),
                end=round(t + dur + offset, 3),
            ))
            t += dur
    return words


def _transcribe_chunk(groq_client, audio_bytes: bytes, filename: str, offset: float, language: str) -> list[WordTimestamp]:
    try:
        response = groq_client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=GROQ_WHISPER_MODEL,
            language=language if language != "auto" else None,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )
    except Exception:
        try:
            response = groq_client.audio.transcriptions.create(
                file=(filename, audio_bytes),
                model=GROQ_WHISPER_MODEL,
                language=language if language != "auto" else None,
                response_format="json",
            )
            text_val = (getattr(response, "text", "") or "").strip()
            if not text_val:
                return []
            tokens = text_val.split()
            dpw = max(0.3, 30.0 / max(len(tokens), 1))
            return [
                WordTimestamp(word=t, start=round(i * dpw + offset, 3), end=round((i + 1) * dpw + offset, 3))
                for i, t in enumerate(tokens)
            ]
        except Exception:
            return []
    return _parse_words(response, offset)


def _transcribe(source_path: str, duration: float, language: str = "en") -> list[WordTimestamp]:
    # Collect all GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3, … in order
    from groq import Groq, RateLimitError as GroqRateLimitError

    groq_keys: list[str] = []
    for env in ["GROQ_API_KEY"] + [f"GROQ_API_KEY_{i}" for i in range(2, 20)]:
        k = os.getenv(env, "")
        if k and k not in groq_keys:
            groq_keys.append(k)

    if not groq_keys:
        return []

    audio_chunks = _prepare_audio_chunks(source_path, duration)
    last_exc: Exception | None = None

    for key_idx, groq_key in enumerate(groq_keys):
        client = Groq(api_key=groq_key)
        label = "GROQ_API_KEY" if key_idx == 0 else f"GROQ_API_KEY_{key_idx + 1}"
        try:
            all_words: list[WordTimestamp] = []
            for i, (audio_bytes, offset) in enumerate(audio_chunks):
                fname = f"audio_chunk_{i}.mp3"
                words = _transcribe_chunk(client, audio_bytes, fname, offset, language)
                all_words.extend(words)

            # Deduplicate overlapping chunk boundaries
            if len(audio_chunks) > 1:
                seen: set = set()
                deduped: list[WordTimestamp] = []
                for w in sorted(all_words, key=lambda x: x.start):
                    k = round(w.start, 1)
                    if k not in seen:
                        deduped.append(w)
                        seen.add(k)
                all_words = deduped

            logging.info(f"[Whisper] Transcribed {len(all_words)} words via {label}")
            return all_words

        except GroqRateLimitError as e:
            logging.warning(f"[Whisper] {label} rate-limited — trying next key: {str(e)[:120]}")
            last_exc = e
            continue
        except Exception as e:
            logging.warning(f"[Whisper] {label} failed: {str(e)[:120]}")
            last_exc = e
            break  # non-rate-limit errors won't be fixed by switching keys

    logging.error(f"[Whisper] All Groq keys exhausted. Last error: {last_exc}")
    return []


# ── LLM helpers: multi-provider fallback ─────────────────────────────────────

# ── LLM: delegate to shared.llm (Groq → Cloudflare → Cerebras → OpenRouter → SambaNova → Groq-small)
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

def _audio_energy_signals(video_path: str, duration: float, top_n: int = 15) -> list[dict]:
    """Extract RMS energy peaks from audio using PyAV. Returns top-N timestamp dicts."""
    try:
        import av as _av
        import array as _array
        import math

        window_sec = 2.0
        hop_sec = 0.5
        energies: list[tuple[float, float]] = []  # (timestamp, rms)

        with _av.open(video_path) as container:
            audio_stream = next((s for s in container.streams if s.type == "audio"), None)
            if not audio_stream:
                return []

            # Accumulate (sum_sq, count) per bucket — no per-frame list allocation
            samples_by_sec: dict[int, tuple[float, int]] = {}
            for frame in container.decode(audio_stream):
                t = float(frame.pts * frame.time_base)
                bucket = int(t / hop_sec)
                planes = frame.to_ndarray()
                mono = planes.mean(axis=0) if planes.ndim > 1 else planes[0]
                mean_sq = float((mono.astype(float) ** 2).mean())
                prev = samples_by_sec.get(bucket, (0.0, 0))
                samples_by_sec[bucket] = (prev[0] + mean_sq, prev[1] + 1)
                del planes, mono

        if not samples_by_sec:
            return []

        # Compute windowed RMS from (sum_sq, count) tuples — no list allocation
        window_buckets = int(window_sec / hop_sec)
        buckets = sorted(samples_by_sec.keys())
        for b in buckets:
            w_sum_sq, w_count = 0.0, 0
            for wb in range(b, b + window_buckets):
                sq, cnt = samples_by_sec.get(wb, (0.0, 0))
                w_sum_sq += sq
                w_count += cnt
            if w_count > 0:
                rms_avg = math.sqrt(max(w_sum_sq / w_count, 1e-10))
                ts = b * hop_sec
                energies.append((ts, rms_avg))

        if not energies:
            return []

        # Normalize 0-1
        max_e = max(e for _, e in energies) or 1.0
        min_e = min(e for _, e in energies)
        rng = max_e - min_e or 1.0

        normalized = [(ts, (e - min_e) / rng) for ts, e in energies]

        # Find local peaks (higher than neighbours on both sides within 3s)
        gap_buckets = int(3.0 / hop_sec)
        peaks: list[tuple[float, float]] = []
        for i, (ts, val) in enumerate(normalized):
            window_vals = [v for _, v in normalized[max(0, i - gap_buckets): i + gap_buckets + 1]]
            if val >= max(window_vals) * 0.95 and val > 0.3:
                peaks.append((ts, val))

        # Deduplicate — keep highest within 5s
        deduped: list[tuple[float, float]] = []
        for ts, val in sorted(peaks, key=lambda x: -x[1]):
            if not any(abs(ts - kept_ts) < 5.0 for kept_ts, _ in deduped):
                deduped.append((ts, val))
            if len(deduped) >= top_n:
                break

        return [
            {
                "timestamp_sec": round(ts, 1),
                "signal_type": "audio_energy_peak",
                "score": round(5.0 + val * 4.5, 2),  # maps 0-1 → 5.0-9.5
                "trigger_words": f"[high energy audio peak at {int(ts//60)}:{int(ts%60):02d}]",
                "stop_scroll_reason": "Audio energy spike — loud moment, reaction, or climax",
            }
            for ts, val in sorted(deduped, key=lambda x: x[0])
        ]
    except Exception as e:
        logging.warning("_audio_energy_signals failed: %s", e)
        return []


def _speech_rate_signals(words: list[WordTimestamp], top_n: int = 10) -> list[dict]:
    """Detect speech rate spikes (fast speech) and dramatic pauses using word timestamps."""
    if len(words) < 20:
        return []

    window_sec = 5.0
    hop_sec = 1.0
    duration = words[-1].end
    results: list[tuple[float, float, str]] = []  # (ts, score, type)

    # Sliding window: words-per-second
    t = 0.0
    while t + window_sec <= duration:
        window_words = [w for w in words if t <= w.start < t + window_sec]
        wps = len(window_words) / window_sec
        results.append((t + window_sec / 2, wps, "speech_rate"))
        t += hop_sec

    if not results:
        return []

    # Normalize wps to score
    max_wps = max(r[1] for r in results) or 1.0
    rate_signals = [
        {
            "timestamp_sec": round(ts, 1),
            "signal_type": "speech_rate_peak",
            "score": round(5.5 + (wps / max_wps) * 3.5, 2),  # 5.5–9.0
            "trigger_words": f"[fast speech burst: {wps:.1f} words/sec]",
            "stop_scroll_reason": "Rapid speech burst — excitement, argument, or climax",
        }
        for ts, wps, _ in results
        if wps > max_wps * 0.75
    ]

    # Detect dramatic pauses (silence > 1.5s mid-video = before big reveal)
    pause_signals = []
    for i in range(len(words) - 1):
        gap = words[i + 1].start - words[i].end
        if gap > 1.5 and 10 < words[i].start < duration - 10:
            score = min(9.0, 5.0 + gap * 1.2)
            pause_signals.append({
                "timestamp_sec": round(words[i].start, 1),
                "signal_type": "dramatic_pause",
                "score": round(score, 2),
                "trigger_words": f"[{gap:.1f}s silence before: \"{words[i+1].word}\"]",
                "stop_scroll_reason": f"Dramatic {gap:.1f}s pause before statement — tension builder",
            })

    # Merge, deduplicate by 3s proximity, take top_n
    all_signals = rate_signals + pause_signals
    all_signals.sort(key=lambda x: -x["score"])
    deduped: list[dict] = []
    for sig in all_signals:
        if not any(abs(sig["timestamp_sec"] - k["timestamp_sec"]) < 3.0 for k in deduped):
            deduped.append(sig)
        if len(deduped) >= top_n:
            break
    return deduped


_AD_PHRASES = [
    "sponsored by", "this video is sponsored", "use code", "use my code",
    "check the description", "link in the description", "link in bio",
    "discount code", "promo code", "coupon code", "affiliate",
    "thank you to our sponsor", "today's sponsor", "brought to you by",
    "subscribe and hit the bell", "hit the notification", "smash the like",
    "turn on notifications",
]


def _detect_ad_segments(words: list, min_gap_sec: float = 5.0) -> list[tuple[float, float]]:
    """Return list of (start, end) ad segments to skip when building clips."""
    if not words:
        return []
    text_lower = " ".join(w.word for w in words).lower()
    segments: list[tuple[float, float]] = []

    for phrase in _AD_PHRASES:
        idx = 0
        while True:
            pos = text_lower.find(phrase, idx)
            if pos == -1:
                break
            char_count = 0
            word_idx = 0
            for i, w in enumerate(words):
                char_count += len(w.word) + 1
                if char_count >= pos:
                    word_idx = i
                    break
            ts = words[word_idx].start
            seg_start = max(0.0, ts - 5.0)
            seg_end = ts + 30.0
            segments.append((seg_start, seg_end))
            idx = pos + len(phrase)

    if not segments:
        return []
    segments.sort()
    merged: list[tuple[float, float]] = [segments[0]]
    for start, end in segments[1:]:
        if start <= merged[-1][1] + min_gap_sec:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _youtube_chapter_signals(chapters: list[dict]) -> list[dict]:
    """Convert YouTube chapters to viral signals — chapter boundaries = natural clip points."""
    if not chapters:
        return []
    signals = []
    for i, ch in enumerate(chapters):
        ts = float(ch.get("start_time", 0))
        title = ch.get("title", "")
        # Chapters near start get hook bonus; chapters with exciting titles score higher
        excitement_words = {"CRAZY", "INSANE", "EPIC", "SHOCKING", "FAIL", "WIN", "CLUTCH",
                            "FUNNY", "BEST", "WORST", "OMG", "WTF", "??", "!!"}
        excitement_bonus = 1.5 if any(w in title.upper() for w in excitement_words) else 0.0
        # Earlier chapters often have better retention
        position_bonus = max(0, 1.0 - i * 0.1)
        score = min(9.5, 6.5 + excitement_bonus + position_bonus)
        signals.append({
            "timestamp_sec": round(ts, 1),
            "signal_type": "youtube_chapter",
            "score": round(score, 2),
            "trigger_words": f"[Chapter: {title}]",
            "stop_scroll_reason": f"YouTube chapter start: '{title}' — pre-validated segment boundary",
        })
    return signals


def _build_timed_transcript(words: list[WordTimestamp]) -> str:
    """Build M:SS-stamped transcript lines for LLM input."""
    if not words:
        return ""
    lines, current, current_start = [], [], words[0].start
    for w in words:
        current.append(w.word)
        if len(current) >= 10 or w.word.endswith((".", "!", "?", "...", ",")):
            m, s = divmod(int(current_start), 60)
            lines.append(f"[{m}:{s:02d}] {' '.join(current)}")
            current = []
            current_start = w.end
    if current:
        m, s = divmod(int(current_start), 60)
        lines.append(f"[{m}:{s:02d}] {' '.join(current)}")
    return "\n".join(lines)


_CONTENT_TYPE_SIGNALS: dict[str, str] = {
    "entertainment": """\
- Explosive reactions (screaming, shock, disbelief)
- Unexpected plot twists or outcomes
- Funniest or most chaotic moments
- Crowd or audience reactions
- Iconic catchphrases or repeated memes
- High-energy climax moments
- "Did he just do that?" moments""",
    "gaming": """\
- Clutch plays / near-death moments
- Rage moments or controller throws
- Insane skill shots or record breaks
- Funny bugs or unexpected game behavior
- Streamer screaming or losing composure
- Unexpected win or loss at the last second""",
    "vlog": """\
- Surprising reveals or confessions
- Funny mishaps or bloopers
- Genuine emotional reactions
- Unexpected encounters
- Strong personal opinion statements
- "You won't believe this" moments""",
    "interview": """\
- Controversial or bold opinion dropped
- Uncomfortable question and authentic answer
- Jaw-dropping personal revelation
- Disagreement or pushback moments
- Memorable one-liner or quotable quote
- Emotional or vulnerable moment""",
    "educational": """\
- "Mind-blowing" fact or statistic
- Common myth busted
- Counter-intuitive insight
- Practical tip with immediate value
- Strong hook: "Most people don't know..."
- Surprising before/after comparison""",
    "tutorial": """\
- Before/after transformation reveal
- Single trick that changes everything
- Mistake everyone makes + the fix
- Fastest shortcut nobody knows
- Satisfying result moment""",
    "opinion": """\
- Most provocative take
- Direct callout or challenge
- Passionate rant peak
- Memorable phrase/slogan
- Bold prediction or bet""",
    "news": """\
- Most shocking headline fact
- Emotional eyewitness account
- "This changes everything" moment
- Surprising statistic or data point
- Controversy or conflict peak""",
    "other": """\
- Strong hook / pattern interrupt
- Emotional peak (any emotion)
- Surprising or unexpected moment
- Quotable one-liner
- Story climax or turning point""",
    "football": """\
- Goal scored — especially in the 90th minute, a final, or against the run of play
- Stunning individual skill: dribble, bicycle kick, long-range strike, rabona
- Embarrassing error: own goal, goalkeeper howler, missed open-net penalty
- Near-miss or goal-line clearance that defied physics
- Referee controversy — wrong call, red card, VAR overrule that changed the game
- Iconic celebration — unusual, emotional, or instantly meme-able reaction
- Player story moment: debut goal, return from injury, record broken on camera
- Crowd eruption — the audio peak when an entire stadium reacts at once""",
    "sports": """\
- Game-changing play at a critical moment (last second, overtime, elimination final)
- Record broken or personal milestone reached live on camera
- Underdog beats the heavy favourite in stunning fashion
- Athlete emotional reaction — tears, disbelief, raw celebration
- Controversial officiating decision that swung the result
- Spectacular athletic feat: impossible speed, strength, precision
- Crowd or stadium atmosphere peak — the noise and energy is the story""",
}

_SCORE_CALIBRATION = """\
SCORING RULES — score relative to THIS content type's audience, NOT vs global entertainment:
- 9-10: Best possible clip from this video. The moment that defines the video. MUST share.
- 7-8:  Strong clip for this genre. Clear hook or emotional peak. Will perform well.
- 5-6:  Decent clip. Worth publishing but not the standout moment.
- 3-4:  Weak. Missing hook or payoff. Only use if nothing better exists.
- 1-2:  Flat. No value. Skip entirely.

IMPORTANT: Score within the genre context:
- News/politics clips: a shocking revelation or heated moment scores 8-9, not 3.
- Educational clips: a mind-blowing fact or counterintuitive insight scores 8-9.
- Comedy clips: the funniest punchline scores 9-10.
- DO NOT penalize clips for being political or educational — score the BEST MOMENT for that genre.
- The TOP clip from any real video should score 7-9. A score of 2-3 means the video has NO watchable moments at all.
- If you are scoring clips below 5, you are being too strict. Re-calibrate upward."""


def _multi_agent_viral_signals(
    transcript: str,
    content_type: str,
    num_clips: int,
    signals_for_type: str,
) -> list[dict]:
    """Run 4 specialised LLM agents in parallel and aggregate their viral signals.

    Signals within a 5-second window are grouped; consensus across agents boosts
    the score (+1.0 for 2 agents, +2.0 for 3+).  Returns up to 15 signals sorted
    by boosted score descending.  Falls back to an empty list so the caller can
    use the existing single-agent path.
    """
    short_transcript = transcript[:6000]

    agent_prompts = [
        (
            "hook_hunter",
            f"""You are a viral hook specialist. Find moments where the speaker says something in the first 3 words that would STOP a scroller cold.
Focus on: bold claims, shocking facts, counter-intuitive statements, direct challenges.
Score 8-10 for genuine scroll-stoppers. Return 5-8 best moments.

Transcript:
{short_transcript}

Return JSON:
{{"signals": [{{"timestamp_sec": <number>, "signal_type": "hook", "score": <8.0-10.0>, "trigger_words": "<exact quote>", "stop_scroll_reason": "<1 sentence>"}}]}}""",
        ),
        (
            "emotion_detector",
            f"""You are an emotional intelligence analyst. Find moments of genuine human emotion: laughter, shock, frustration, awe, pride, fear, surprise.
Focus on: tone changes, exclamations, dramatic pauses followed by revelation, genuine reactions.
Score 8-10 for peak emotional moments. Return 5-8 best moments.

Transcript:
{short_transcript}

Return JSON:
{{"signals": [{{"timestamp_sec": <number>, "signal_type": "emotion", "score": <8.0-10.0>, "trigger_words": "<exact quote>", "stop_scroll_reason": "<1 sentence>"}}]}}""",
        ),
        (
            "info_density",
            f"""You are an educational content specialist. Find the most information-dense, surprising, or counter-intuitive facts/insights.
Focus on: statistics that surprise, myths busted, "nobody knows this" moments, expert reveals.
Score 8-10 for genuinely mind-blowing insights. Return 5-8 best moments.

Transcript:
{short_transcript}

Return JSON:
{{"signals": [{{"timestamp_sec": <number>, "signal_type": "insight", "score": <8.0-10.0>, "trigger_words": "<exact quote>", "stop_scroll_reason": "<1 sentence>"}}]}}""",
        ),
        (
            "controversy",
            f"""You are a controversy and opinion analyst. Find the most provocative opinions, bold predictions, disagreements, or callouts.
Focus on: strong opinions stated directly, pushback moments, bold predictions, statements that will make people reply.
Score 8-10 for genuinely provocative/shareable opinions. Return 5-8 best moments.

Transcript:
{short_transcript}

Return JSON:
{{"signals": [{{"timestamp_sec": <number>, "signal_type": "controversy", "score": <8.0-10.0>, "trigger_words": "<exact quote>", "stop_scroll_reason": "<1 sentence>"}}]}}""",
        ),
    ]

    agent_results: list[list[dict]] = []
    successful_agents = 0

    def _run_agent(name: str, prompt: str) -> list[dict]:
        try:
            data = _call_llm_json(
                [{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=1500,
            )
            sigs = data.get("signals", [])
            logging.info("Multi-agent viral detection: agent '%s' returned %d signals", name, len(sigs))
            return sigs
        except Exception as exc:
            logging.warning("Multi-agent viral detection: agent '%s' failed — %s", name, exc)
            return []

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_run_agent, name, prompt): name for name, prompt in agent_prompts}
        for future in as_completed(futures):
            result = future.result()
            if result:
                agent_results.append(result)
                successful_agents += 1
            else:
                agent_results.append([])

    # Require at least 2 successful agents; otherwise signal caller to fall back.
    if successful_agents < 2:
        logging.warning("Multi-agent viral detection: only %d/4 agents succeeded — falling back", successful_agents)
        return []

    # Flatten all signals with their origin
    all_signals: list[dict] = []
    for sigs in agent_results:
        for s in sigs:
            if isinstance(s.get("timestamp_sec"), (int, float)):
                all_signals.append(s)

    if not all_signals:
        return []

    # Group signals within 5-second windows and compute boosted scores
    groups: list[list[dict]] = []
    for sig in sorted(all_signals, key=lambda x: x.get("timestamp_sec", 0)):
        placed = False
        for group in groups:
            rep_ts = group[0].get("timestamp_sec", 0)
            if abs(sig.get("timestamp_sec", 0) - rep_ts) <= 5.0:
                group.append(sig)
                placed = True
                break
        if not placed:
            groups.append([sig])

    merged: list[dict] = []
    for group in groups:
        avg_score = sum(s.get("score", 5.0) for s in group) / len(group)
        agent_count = len(group)
        if agent_count >= 3:
            boosted = avg_score + 2.0
        elif agent_count >= 2:
            boosted = avg_score + 1.0
        else:
            boosted = avg_score
        boosted = min(10.0, round(boosted, 2))
        # Use the representative signal (highest individual score) as the base
        best = max(group, key=lambda s: s.get("score", 0))
        merged.append({
            "timestamp_sec": best.get("timestamp_sec"),
            "signal_type": best.get("signal_type", "multi"),
            "score": boosted,
            "trigger_words": best.get("trigger_words", ""),
            "stop_scroll_reason": best.get("stop_scroll_reason", ""),
        })

    merged.sort(key=lambda x: x["score"], reverse=True)
    top = merged[:15]
    logging.info("Multi-agent viral detection: %d signals from %d/4 agents", len(top), successful_agents)
    return top


def _ai_score_clips(
    words: list[WordTimestamp],
    duration: float,
    num_clips: int,
    min_dur: int,
    max_dur: int,
    min_score_10: float,
    topic_focus: str = "",
    platforms: list[str] = None,
    content_type: str = "other",
    key_moments: list[dict] = None,
    source_path: str = "",
    chapters: list[dict] = None,
    precision_mode: bool = False,
    yt_engagement: dict | None = None,
    occasion: str = "",
) -> list[ClipResult]:
    if platforms is None:
        platforms = ["tiktok", "reels", "shorts"]
    if not words:
        return []

    transcript = _build_timed_transcript(words)
    platforms_str = ", ".join(platforms)

    context_lines = []
    if topic_focus:
        context_lines.append(f"Topic: {topic_focus}")
    context_lines.append(f"Content type: {content_type}")
    context_lines.append(f"Target platforms: {platforms_str}")
    context_block = "\n".join(context_lines)

    # For sports occasions, use the sport-specific signal prompts regardless of content_type
    _occasion_ct_map = {"football": "football", "soccer": "football", "sports": "sports",
                        "gaming": "gaming", "esports": "gaming"}
    _effective_ct = _occasion_ct_map.get(occasion.lower(), content_type) if occasion else content_type
    signals_for_type = _CONTENT_TYPE_SIGNALS.get(_effective_ct, _CONTENT_TYPE_SIGNALS.get(content_type, _CONTENT_TYPE_SIGNALS["other"]))

    # Seed from metadata key_moments if available
    key_moments_hint = ""
    if key_moments:
        km_lines = "\n".join(
            f"  - t={m.get('timestamp_sec', 0):.0f}s: {m.get('description', '')}"
            for m in key_moments[:10]
        )
        key_moments_hint = f"\nPre-identified key moments (use as starting points):\n{km_lines}\n"

    # Step 1 — identify viral signal moments in the transcript
    if precision_mode:
        _eng = yt_engagement or {}
        _views = _eng.get("views", 0)
        _likes = _eng.get("likes", 0)
        _like_ratio = (_likes / _views) if _views > 0 else 0.0
        _title = _eng.get("title", "Unknown")
        _comments = _eng.get("comments", 0)
        _desc = _eng.get("description", "")[:500]
        _chapters_hint = ""
        if chapters:
            # raw yt-dlp chapters use start_time+title; processed signals use timestamp_sec+reason
            top_chapters = chapters[:5]
            _chapters_hint = "YouTube chapters: " + "; ".join(
                f"{int(c.get('start_time', c.get('timestamp_sec', 0)) // 60)}:{int(c.get('start_time', c.get('timestamp_sec', 0)) % 60):02d} — {c.get('title', c.get('reason', ''))}"
                for c in top_chapters
            )
        analysis_prompt = f"""You are a world-class viral content scout. Find the SINGLE BEST moment that stops a scroller in 2 seconds.

VIDEO METADATA:
- Title: {_title}
- Views: {_views:,}
- Likes: {_likes:,}
- Like ratio: {_like_ratio:.2%}
- Comment count: {_comments:,}
- Description: {_desc}

{_chapters_hint}

Transcript:
{transcript}

PRECISION SCORING — score 0–10:
9.5–10: Instant scroll-stop. First 3 words are a hook. Contains: shocking reveal, counter-intuitive fact, raw emotion, before/after payoff, quotable one-liner, or a moment viewers feel they discovered alone.
8–9.4: Strong potential but missing one hook element.
<8: Not precision-mode worthy.

Find ALL moments scoring 8.0+. For each, explain exactly why the first 3 words create an irresistible hook.

Return JSON:
{{
  "signals": [
    {{
      "timestamp_sec": <number>,
      "signal_type": "<hook|reveal|emotion|payoff|quotable>",
      "score": <8.0-10.0>,
      "trigger_words": "<exact quote — 3-8 words that ARE the hook>",
      "hook_mechanism": "<why first 3 words stop a scroller, 1 sentence>",
      "payoff": "<what viewer gets if they watch the full clip>",
      "shareability": "<why someone forwards this>"
    }}
  ]
}}"""
        min_score_10 = max(min_score_10, 8.5)  # precision mode: only high-quality clips
    else:
        analysis_prompt = f"""You are an expert viral content analyst specializing in {content_type} content for TikTok, Reels, and Shorts.

{context_block}
{key_moments_hint}
Full transcript with timestamps (M:SS):
{transcript}

Analyze this transcript and identify ALL moments with HIGH viral potential for {platforms_str}.

Viral signals to prioritize for {content_type} content:
{signals_for_type}

{_SCORE_CALIBRATION}

For EACH viral signal found, output:
- timestamp (seconds from start)
- signal type
- virality score (0-10) — be generous, calibrate to the scale above
- the exact words that make it viral
- why this will stop scrollers

Return JSON with ALL signals found (aim for at least {max(num_clips * 2, 8)} signals):
{{
  "signals": [
    {{
      "timestamp_sec": <number>,
      "signal_type": "<type>",
      "score": <0.0-10.0>,
      "trigger_words": "<exact quote from transcript>",
      "stop_scroll_reason": "<1 sentence why viewers stop here>"
    }}
  ]
}}"""

    try:
        _stage1_temp = 0.1 if precision_mode else 0.3
        if precision_mode:
            # Precision mode: use the focused single-agent prompt built above
            try:
                signals_data = _call_llm_json(
                    [{"role": "user", "content": analysis_prompt}],
                    temperature=_stage1_temp, max_tokens=3000,
                )
                signals = signals_data.get("signals", [])
            except Exception as e1:
                logging.warning("_ai_score_clips step-1 LLM failed (%s) — using evenly-spaced fallback signals", e1)
                signals = []
        else:
            # Non-precision mode: multi-agent consensus detection
            signals = _multi_agent_viral_signals(
                transcript=transcript,
                content_type=content_type,
                num_clips=num_clips,
                signals_for_type=signals_for_type,
            )
        if not signals:
            signals = [{"timestamp_sec": i * (duration / max(num_clips, 1)), "score": 6.0} for i in range(num_clips)]

        # Augment with multimodal signals — audio energy, speech rate, YT chapters
        extra_signals: list[dict] = []
        if source_path:
            audio_sigs = _audio_energy_signals(source_path, duration, top_n=12)
            # For sports/football, crowd roar = goal/climax — up-weight audio peaks
            # since commentary transcript alone is unreliable for finding goal moments.
            _sports_occasions = {"football", "soccer", "sports"}
            if occasion.lower() in _sports_occasions:
                for sig in audio_sigs:
                    sig["score"] = min(10.0, round(sig["score"] * 1.5, 2))
            extra_signals += audio_sigs
            extra_signals += _speech_rate_signals(words, top_n=8)
        if chapters:
            extra_signals += _youtube_chapter_signals(chapters)

        # Merge: deduplicate by 2s proximity — prefer higher score
        for extra in extra_signals:
            ts_extra = extra["timestamp_sec"]
            close = next((s for s in signals if abs(s.get("timestamp_sec", 0) - ts_extra) < 2.0), None)
            if close:
                # Boost existing signal score if extra signal confirms it
                close["score"] = min(10.0, round((close["score"] + extra["score"]) / 2 + 0.5, 2))
                close["stop_scroll_reason"] = (
                    close.get("stop_scroll_reason", "") + f" | {extra.get('stop_scroll_reason', '')}"
                )
            else:
                signals.append(extra)

        logging.info("_ai_score_clips: %d LLM signals + %d multimodal → %d total",
                     len(signals) - len(extra_signals), len(extra_signals), len(signals))

        # Step 2 — build clips around viral signals
        signals_str = "\n".join(
            f"- t={s.get('timestamp_sec', 0):.1f}s  score={s.get('score', 5)}/10  [{s.get('signal_type', '?')}]  \"{s.get('trigger_words', '')}\"  → {s.get('stop_scroll_reason', '')}"
            for s in sorted(signals, key=lambda x: x.get("score", 0), reverse=True)
        )

        if precision_mode:
            stage2_prompt = f"""You are a precision clip editor. Select the TOP {num_clips} clip(s) scoring as close to 10/10 as possible.

VIDEO: {_title} | {_views:,} views | {_like_ratio:.2%} like ratio

Signals (best first):
{signals_str}

RULES:
- Select exactly {num_clips} non-overlapping clip(s), ranked by score descending.
- Start 2–3s BEFORE trigger words to build micro-tension.
- End exactly at the payoff peak. Silence after punchline is fine.
- Duration: {min_dur}–{max_dur}s. Never cut mid-sentence unless it adds cliffhanger tension.
- Score each clip honestly — do NOT inflate. If signal is weak, score it low.
- Adjacent short clips (<{min_dur}s gap between them) SHOULD be merged into one longer clip when they form a narrative arc.

Return ONLY JSON with EXACTLY {num_clips} clip(s):
{{
  "clips": [
    {{
      "start_seconds": <number>,
      "end_seconds": <number>,
      "score": <0.0-10.0>,
      "title": "<punchy TikTok caption under 80 chars>",
      "reason": "<why this scores this high, max 15 words>",
      "platform": "<tiktok|reels|shorts>",
      "hook_words": "<exact first 3-5 words of clip>"
    }}
  ]
}}"""
            clip_prompt = stage2_prompt
        else:
            clip_prompt = f"""You are a viral video editor specializing in {content_type} content for {platforms_str}.

{context_block}

Viral signals found (sorted by score, highest first):
{signals_str}

{_SCORE_CALIBRATION}

Create EXACTLY {num_clips} non-overlapping clips. Rules:
- Use top-scoring signals first — fill remaining slots with next-best
- Each clip MUST be {min_dur}–{max_dur} seconds long
- Start 2-4s BEFORE the viral moment to build context/tension
- End AFTER the payoff, punchline, or reaction peak
- No overlapping clips
- Score = virality strength of this clip on {platforms_str} (be generous per calibration scale)
- Title: punchy, curiosity-driven, matches platform energy

Return ONLY JSON:
{{
  "clips": [
    {{
      "start_seconds": <number>,
      "end_seconds": <number>,
      "score": <0.0-10.0>,
      "title": "<punchy title, MAX 100 CHARS>",
      "reason": "<why this goes viral, max 12 words>",
      "platform": "<best fit from: {platforms_str}>"
    }}
  ]
}}"""

        _stage2_temp = 0.1 if precision_mode else 0.25
        try:
            data = _call_llm_json(
                [{"role": "user", "content": clip_prompt}],
                temperature=_stage2_temp, max_tokens=max(2000, num_clips * 400),
            )
            raw_clips = data.get("clips", [])
        except Exception as e2:
            logging.warning("_ai_score_clips step-2 LLM failed (%s) — building clips directly from signals", e2)
            raw_clips = []

        # If LLM step-2 failed or returned nothing, build clips directly from top signals
        if not raw_clips:
            raw_clips = []
            used_signals = sorted(signals, key=lambda s: s.get("score", 0), reverse=True)
            for sig in used_signals:
                ts = float(sig.get("timestamp_sec", 0))
                start = max(0.0, ts - 3.0)  # 3s lead-in
                end = min(duration, start + min(max_dur, 30))
                if end - start >= min_dur:
                    raw_clips.append({
                        "start_seconds": start,
                        "end_seconds": end,
                        "score": sig.get("score", 6.0),
                        "title": sig.get("trigger_words", f"Moment at {int(ts//60)}:{int(ts%60):02d}")[:100],
                        "reason": sig.get("stop_scroll_reason", "")[:80],
                        "platform": platforms[0],
                    })
                if len(raw_clips) >= num_clips * 2:
                    break
            logging.info("_ai_score_clips: built %d clips from signals directly", len(raw_clips))

        clips = []
        for c in raw_clips:
            start = float(c.get("start_seconds", 0))
            end = float(c.get("end_seconds", 0))
            if end > duration:
                end = duration
            clip_dur = end - start
            if end - start > max_dur:
                end = start + max_dur
                clip_dur = max_dur
            if clip_dur < min_dur or start < 0:
                continue
            score = round(float(c.get("score", 5.0)), 2)
            plat = c.get("platform", platforms[0])
            if plat not in platforms:
                plat = platforms[0]
            clips.append(ClipResult(
                start=round(start, 2),
                end=round(end, 2),
                score=score,
                title=(c.get("title") or f"Clip {len(clips)+1}")[:100],
                reason=c.get("reason", ""),
                platform=plat,
            ))

        # Filter clips overlapping with ad segments
        ad_segs = _detect_ad_segments(words)
        if ad_segs:
            pre_count = len(clips)
            clips = [c for c in clips if not any(c.start < seg_end and c.end > seg_start for seg_start, seg_end in ad_segs)]
            if pre_count != len(clips):
                logging.info("_ai_score_clips: removed %d ad-overlapping clips", pre_count - len(clips))

        # Rescale scores relative to content type — LLM under-scores non-entertainment genres.
        # Linear map: raw 0→floor, raw 10→10 (preserves relative ranking within the video).
        _genre_floors = {"news": 6.0, "interview": 6.5, "educational": 6.0, "opinion": 6.5,
                         "tutorial": 6.0, "vlog": 5.5, "other": 5.5, "entertainment": 5.0, "gaming": 5.0}
        _floor = _genre_floors.get(content_type, 5.5)
        if not precision_mode and _floor > 0:
            clips = [
                ClipResult(
                    start=c.start, end=c.end,
                    score=round(_floor + (c.score / 10.0) * (10.0 - _floor), 2),
                    title=c.title, reason=c.reason, platform=c.platform,
                    audio_energy=c.audio_energy, speech_rate=c.speech_rate, chapter_match=c.chapter_match,
                )
                for c in clips
            ]

        clips.sort(key=lambda c: c.score, reverse=True)
        clips = [c for c in clips if c.score >= min(min_score_10, _floor)]
        deduped: list[ClipResult] = []
        for clip in clips:
            overlaps = any(
                clip.start < kept.end and clip.end > kept.start
                for kept in deduped
            )
            if not overlaps:
                deduped.append(clip)
            if len(deduped) >= num_clips:
                break
        deduped.sort(key=lambda c: c.start)
        return deduped

    except Exception as e:
        logging.exception("_ai_score_clips failed: %s", e)
        return []


# ── Stage 5: Heuristic fallback ───────────────────────────────────────────────

def _heuristic_clips(
    words: list[WordTimestamp],
    duration: float,
    num_clips: int,
    min_dur: int,
    max_dur: int,
    platforms: list[str] = None,
) -> list[ClipResult]:
    if platforms is None:
        platforms = ["tiktok", "reels", "shorts"]

    if not words:
        target = min(max_dur, max(min_dur, duration / (num_clips + 1)))
        clips = []
        for i in range(num_clips):
            start = i * (max(0.0, duration - target) / max(num_clips - 1, 1))
            clips.append(ClipResult(
                start=round(start, 2), end=round(start + target, 2),
                score=1.0, title=f"Clip {i+1}", reason="no speech",
                platform=platforms[i % len(platforms)],
            ))
        return clips

    # Group words into sentences
    sentences, current = [], []
    for i, w in enumerate(words):
        current.append(w)
        ends = (
            w.word.endswith((".", "!", "?", "...", ","))
            or (i < len(words) - 1 and words[i + 1].start - w.end > 0.8)
            or i == len(words) - 1
        )
        if ends and len(current) >= 3:
            sentences.append(current[:])
            current = []
    if current:
        sentences.append(current)

    candidates = []
    for i in range(len(sentences)):
        for j in range(i + 1, min(i + 20, len(sentences) + 1)):
            window = [w for s in sentences[i:j] for w in s]
            start, end = window[0].start, window[-1].end
            dur = end - start
            if dur < min_dur or dur > max_dur:
                continue
            density = min(len(window) / dur / 2.5, 2.0)
            pos_bonus = 1.2 if start / max(duration, 1) < 0.3 else 1.0
            dur_bonus = 1.2 if 15 <= dur <= 45 else (0.8 if dur < 15 else 0.9)
            score = min(7.0, round(density * pos_bonus * dur_bonus * 3.5, 2))
            candidates.append((score, start, end, " ".join(w.word for w in window[:8])))

    candidates.sort(key=lambda c: c[0], reverse=True)
    selected: list[ClipResult] = []
    for score, start, end, preview in candidates:
        if not any(start < s.end and end > s.start for s in selected):
            selected.append(ClipResult(
                start=round(start, 2), end=round(end, 2),
                score=min(7.0, round(score * 3.5, 2)), title=f"Clip {len(selected)+1}",
                reason=preview, platform=platforms[len(selected) % len(platforms)],
            ))
        if len(selected) >= num_clips:
            break

    selected.sort(key=lambda c: c.start)
    for i, clip in enumerate(selected):
        clip.title = f"Clip {i+1}"

    # If sentence-based yielded nothing (e.g. tight duration window), fall back to fixed intervals
    if not selected:
        target = min(max_dur, max(min_dur, duration / (num_clips + 1)))
        for i in range(num_clips):
            start = round(i * max(0.0, duration - target) / max(num_clips - 1, 1), 2)
            end = round(min(start + target, duration), 2)
            selected.append(ClipResult(
                start=start, end=end, score=1.0,
                title=f"Clip {i+1}", reason="fixed interval",
                platform=platforms[i % len(platforms)],
            ))

    return selected


# ── Stage 6: Caption generation ───────────────────────────────────────────────

def _smooth_word_timestamps(words: list[WordTimestamp]) -> list[WordTimestamp]:
    """
    Smooth out Whisper's per-word timing jitter (±100-300ms heterogeneous bias).

    Strategy (matches YouTube's forced-alignment approach):
    1. Clip overlaps: a word cannot start before the previous word ends.
    2. Detect and fix implausible gaps or backward jumps caused by Whisper drift.
    3. Enforce minimum word duration of 80ms (below this = transcription artifact).
    """
    if len(words) < 2:
        return words
    smoothed = [words[0]]
    for w in words[1:]:
        prev = smoothed[-1]
        # Clamp: word cannot start before previous word ends
        start = max(w.start, prev.end)
        # Implausible backward jump (>200ms): anchor to prev.end + small gap
        if start > prev.end + 0.2 and w.start < prev.end:
            start = prev.end + 0.05
        # Minimum duration 80ms
        end = max(w.end, start + 0.08)
        smoothed.append(WordTimestamp(word=w.word, start=round(start, 3), end=round(end, 3)))
    return smoothed


def _generate_captions(words: list[WordTimestamp], clip: ClipResult, max_words: int = 3) -> list[CaptionSegment]:
    """
    Group word-level timestamps into caption segments for burn-in.

    Timing contract (YouTube-style):
      - start: shifted earlier by CAPTION_LEAD_SEC (150ms) — captions appear
               slightly before the word, matching YouTube's ~150-200ms pre-roll.
      - end:   natural word end time — NOT shifted, stays visible until word finishes.
      - Gaps ≤ 0.5 s between consecutive segments are closed to prevent flicker.
      - Whisper timestamps are smoothed first to remove ±100-300ms jitter.
    """
    clip_words = [w for w in words if w.start >= clip.start - 0.1 and w.end <= clip.end + 0.1]
    if not clip_words:
        return []

    clip_words = _smooth_word_timestamps(clip_words)

    segments, current = [], []
    for w in clip_words:
        current.append(w)
        is_break = len(current) >= max_words or w.word.endswith((".", "!", "?", ","))
        if is_break:
            seg_start = max(0.0, current[0].start - clip.start - CAPTION_LEAD_SEC)
            seg_end   = max(seg_start + 0.1, current[-1].end - clip.start)
            seg_words = [
                WordTimestamp(cw.word,
                              max(0.0, cw.start - clip.start - CAPTION_LEAD_SEC),
                              max(0.0, cw.end   - clip.start))
                for cw in current
            ]
            segments.append(CaptionSegment(text=" ".join(cw.word for cw in current),
                                           start=seg_start, end=seg_end, words=seg_words))
            current = []
    if current:
        seg_start = max(0.0, current[0].start - clip.start - CAPTION_LEAD_SEC)
        seg_end   = max(seg_start + 0.1, current[-1].end - clip.start)
        seg_words = [
            WordTimestamp(cw.word,
                          max(0.0, cw.start - clip.start - CAPTION_LEAD_SEC),
                          max(0.0, cw.end   - clip.start))
            for cw in current
        ]
        segments.append(CaptionSegment(text=" ".join(cw.word for cw in current),
                                       start=seg_start, end=seg_end, words=seg_words))

    # Extend each segment's end to the next segment's start to eliminate blank frames
    for i in range(len(segments) - 1):
        gap = segments[i + 1].start - segments[i].end
        if 0 < gap <= 0.5:
            segments[i] = CaptionSegment(
                text=segments[i].text,
                start=segments[i].start,
                end=segments[i + 1].start,
                words=segments[i].words,
            )

    return segments


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

def _load_font(size: int):
    from PIL import ImageFont
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _build_caption_timeline(segments: list[CaptionSegment], style: str) -> dict:
    """
    Build a centisecond-keyed lookup table used by _draw_caption.

    Keys are int(t * 100) — hundredths of a second relative to clip start.
    Values are (word_list, active_word_index) for capcut styles,
    or (text, None) for all other styles.

    Each word's display window runs from its shifted start to the next word's
    start (or segment end for the last word). Minimum 0.12 s per word prevents
    single-frame flashes. Upper bound uses +1 to include the boundary centisecond
    that floating-point truncation would otherwise miss.
    """
    timeline = {}
    is_capcut = style in CAPCUT_STYLES
    for seg in segments:
        if is_capcut and seg.words:
            words = [w.word for w in seg.words]
            n = len(seg.words)
            for i, w in enumerate(seg.words):
                t_start = w.start
                t_end = seg.words[i + 1].start if i + 1 < n else seg.end
                if t_end - t_start < 0.12:
                    t_end = t_start + 0.12
                for cs in range(int(t_start * 100), int(t_end * 100) + 1):
                    timeline[cs] = (list(words), i)
        else:
            for cs in range(int(seg.start * 100), int(seg.end * 100) + 1):
                timeline[cs] = (seg.text, None)
    return timeline


def _crop_frame(img, crop_mode: str, target_w: int, target_h: int):
    from PIL import Image
    w, h = img.size
    if crop_mode == "9:16":
        new_w = int(h * 9 / 16)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    elif crop_mode == "16:9":
        new_h = int(w * 9 / 16)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    elif crop_mode == "1:1":
        s = min(w, h)
        left, top = (w - s) // 2, (h - s) // 2
        img = img.crop((left, top, left + s, top + s))
    elif crop_mode == "4:5":
        new_h = int(w * 5 / 4)
        if new_h <= h:
            top = (h - new_h) // 2
            img = img.crop((0, top, w, top + new_h))
        else:
            new_w = int(h * 4 / 5)
            left = (w - new_w) // 2
            img = img.crop((left, 0, left + new_w, h))
    if img.size != (target_w, target_h):
        from PIL import Image as _PILImage
        img = img.resize((target_w, target_h), resample=_PILImage.LANCZOS)
    return img


def _draw_caption(img, t: float, caption_timeline: dict, style: str, width: int, height: int, font_main, font_highlight, cfg):
    from PIL import ImageDraw
    cs = round(t * 100)
    if cs not in caption_timeline:
        # Try adjacent centisecond for float rounding edge
        cs = int(t * 100)
        if cs not in caption_timeline:
            return img
    entry = caption_timeline[cs]
    text_color, highlight_color, ctx_alpha, font_size, bg_color = cfg
    is_capcut = style in CAPCUT_STYLES
    is_vertical = height > width

    if style == "minimal":
        y_base = int(height * (0.88 if is_vertical else 0.90))
    else:
        y_base = int(height * (0.76 if is_vertical else 0.80))

    draw = ImageDraw.Draw(img)

    def draw_centered_outline(text, y, font, color, stroke_width=4, stroke_color=(0, 0, 0, 255), bg=None, pad=16):
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (width - tw) // 2
        if bg and bg[3] > 0:
            draw.rounded_rectangle([x - pad, y - pad // 2, x + tw + pad, y + th + pad // 2], radius=8, fill=bg)
        for dx in range(-stroke_width, stroke_width + 1):
            for dy in range(-stroke_width, stroke_width + 1):
                if dx == 0 and dy == 0:
                    continue
                draw.text((x + dx, y + dy), text, font=font, fill=stroke_color)
        draw.text((x, y), text, font=font, fill=color)

    def draw_capcut_inline(words: list, active_idx: int, y: int, bold: bool):
        """Draw words in one or two rows; wraps to second row if total exceeds frame width."""
        GAP = 8
        PAD_X, PAD_Y = 14, 8
        RADIUS = 10
        MARGIN = int(width * 0.04)  # 4% side margin so pills never touch edges
        MAX_W = width - MARGIN * 2
        font = font_highlight if bold else font_main
        word_sizes = []
        for w in words:
            bb = draw.textbbox((0, 0), w, font=font)
            word_sizes.append((bb[2] - bb[0], bb[3] - bb[1]))

        def _pill_w(tw): return tw + PAD_X * 2

        total_w = sum(_pill_w(ws[0]) for ws in word_sizes) + GAP * (len(words) - 1)

        # Split into two rows if overflow
        if total_w > MAX_W and len(words) > 1:
            split = max(1, len(words) // 2)
            rows = [list(zip(words[:split], word_sizes[:split])),
                    list(zip(words[split:], word_sizes[split:]))]
            active_rows = [(active_idx if active_idx < split else -1),
                           (active_idx - split if active_idx >= split else -1)]
        else:
            rows = [list(zip(words, word_sizes))]
            active_rows = [active_idx]

        row_h_base = max(ws[1] for ws in word_sizes) if word_sizes else font_size
        pill_h = row_h_base + PAD_Y * 2

        for row_i, (row, act_idx) in enumerate(zip(rows, active_rows)):
            row_total_w = sum(_pill_w(ws[0]) for _, ws in row) + GAP * (len(row) - 1)
            x = (width - row_total_w) // 2
            row_y = y + row_i * (pill_h + GAP)

            for i, (w, (tw, th)) in enumerate(row):
                pw = _pill_w(tw)
                pill_y = row_y

                if i == act_idx:
                    draw.rounded_rectangle([x, pill_y, x + pw, pill_y + pill_h],
                                           radius=RADIUS, fill=(245, 197, 24, 240))
                    txt_color = (0, 0, 0, 255)
                else:
                    txt_color = (255, 255, 255, 230)

                wx = x + PAD_X
                wy = pill_y + PAD_Y
                if i != act_idx:
                    draw.text((wx + 2, wy + 2), w, font=font, fill=(0, 0, 0, 120))
                draw.text((wx, wy), w, font=font, fill=txt_color)
                x += pw + GAP

    if style == "classic":
        ctx_text, _ = entry
        ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
        draw_centered_outline(ctx_text, y_base, font_main, ctx_color, stroke_width=4,
                              bg=bg_color if bg_color[3] > 0 else None)

    elif style == "capcut-bold":
        if isinstance(entry[0], list):
            words, active_idx = entry
            draw_capcut_inline(words, active_idx, y_base, bold=True)
        else:
            ctx_text, _ = entry
            ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
            draw_centered_outline(ctx_text, y_base, font_main, ctx_color, stroke_width=5)

    elif style == "minimal":
        ctx_text = entry[0] if isinstance(entry[0], str) else " ".join(entry[0])
        ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
        bbox = draw.textbbox((0, 0), ctx_text, font=font_main)
        tw = bbox[2] - bbox[0]
        x = (width - tw) // 2
        draw.text((x + 2, y_base + 2), ctx_text, font=font_main, fill=(0, 0, 0, 100))
        draw.text((x, y_base), ctx_text, font=font_main, fill=ctx_color)

    else:  # capcut default
        if isinstance(entry[0], list):
            words, active_idx = entry
            draw_capcut_inline(words, active_idx, y_base, bold=False)
        else:
            ctx_text, _ = entry
            ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
            bbox = draw.textbbox((0, 0), ctx_text, font=font_main)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            x = (width - tw) // 2
            if bg_color[3] > 0:
                draw.rounded_rectangle([x - 16, y_base - 8, x + tw + 16, y_base + th + 8],
                                       radius=8, fill=bg_color)
            draw.text((x + 3, y_base + 3), ctx_text, font=font_main, fill=(0, 0, 0, 170))
            draw.text((x, y_base), ctx_text, font=font_main, fill=ctx_color)

    return img


def _make_hook_text(title: str, viral_type: str = "") -> str:
    """Derive a short punchy hook text for the first-frame overlay from the clip title."""
    if not title:
        return ""
    words = title.split()[:6]
    text = " ".join(words).upper()
    # Cap at 38 chars for readability
    return text[:38]


def _draw_hook_overlay(img, t_in_clip: float, hook_text: str, hook_duration_sec: float, width: int, height: int):
    """Draw a bold text hook at the top and a circle overlay at the action area.

    Active only while t_in_clip < hook_duration_sec. Fades in/out over 0.3s edges.
    """
    if not hook_text or t_in_clip >= hook_duration_sec:
        return img
    from PIL import ImageDraw

    fade_in = min(1.0, t_in_clip / 0.3)
    fade_out = min(1.0, (hook_duration_sec - t_in_clip) / 0.3)
    alpha = int(255 * min(fade_in, fade_out))
    if alpha < 5:
        return img

    font_size = max(48, int(width * 0.062))
    font = _load_font(font_size)
    draw = ImageDraw.Draw(img)

    bbox = draw.textbbox((0, 0), hook_text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (width - tw) // 2
    y = int(height * 0.055)

    PAD = 16
    bg = (0, 0, 0, int(alpha * 0.72))
    draw.rounded_rectangle([x - PAD, y - PAD // 2, x + tw + PAD, y + th + PAD // 2], radius=10, fill=bg)

    stroke = 3
    for dx in range(-stroke, stroke + 1):
        for dy in range(-stroke, stroke + 1):
            if dx == 0 and dy == 0:
                continue
            draw.text((x + dx, y + dy), hook_text, font=font, fill=(0, 0, 0, alpha))
    draw.text((x, y), hook_text, font=font, fill=(255, 218, 0, alpha))

    # Red circle at lower-center — where ball/player action typically sits in 9:16 crop
    cx = width // 2
    cy = int(height * 0.60)
    r = int(min(width, height) * 0.075)
    outline_w = 4
    for i in range(outline_w):
        fade_a = max(0, alpha - i * 40)
        draw.ellipse([cx - r - i, cy - r - i, cx + r + i, cy + r + i],
                     outline=(255, 50, 50, fade_a))
    return img


RANKING_THEMES = {
    "classic": {
        "num_fill": (255, 218, 0),
        "title_fill": (255, 255, 255),
        "stroke_fill": (0, 0, 0),
        "stroke_width": 4,
        "bg_fill": (0, 0, 0, 160),
    },
    "neon": {
        "num_fill": (0, 255, 180),
        "title_fill": (255, 255, 255),
        "stroke_fill": (0, 80, 60),
        "stroke_width": 4,
        "bg_fill": (10, 10, 30, 180),
    },
    "minimal": {
        "num_fill": (255, 255, 255),
        "title_fill": (220, 220, 220),
        "stroke_fill": (30, 30, 30),
        "stroke_width": 3,
        "bg_fill": (0, 0, 0, 120),
    },
}


def _hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def _draw_ranking_overlay(
    img,
    rank_number: int,
    title_text: str,
    theme_name: str,
    width: int,
    height: int,
    total: int = 1,
    all_labels: list = None,
    revealed_ranks: set = None,
    template_config: dict | None = None,
):
    """
    Overlay matching reference style (Image #16):
    - Title: left-aligned top, bold, 2 lines (line2 in theme highlight color)
    - Rank list: left-aligned, bottom 45% of frame, compact tight spacing
    - Active rank: number in rank-specific color, label WHITE, slightly larger
    - Revealed ranks: number in rank-specific color dimmed, label white dimmed, same size as active
    - Hidden ranks: number only, heavily dimmed, no label
    """
    from PIL import Image, ImageDraw

    theme = dict(RANKING_THEMES.get(theme_name, RANKING_THEMES["classic"]))
    if template_config:
        if tc := template_config.get("titleColor"):
            theme["title_fill"] = _hex_to_rgb(tc)
        if bc := template_config.get("bgColor"):
            r, g, b = _hex_to_rgb(bc)
            theme["bg_fill"] = (r, g, b, theme["bg_fill"][3] if len(theme["bg_fill"]) == 4 else 160)
        if nc := template_config.get("numberColors"):
            theme["number_colors"] = [_hex_to_rgb(c) for c in nc]
        elif ac := template_config.get("accentColor"):
            theme["num_fill"] = _hex_to_rgb(ac)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    sw = theme["stroke_width"]
    left_x = int(width * 0.04)

    rank_colors = theme.get("number_colors") or [
        (255, 218, 0),    # 1 - yellow
        (255, 140, 0),    # 2 - orange
        (180, 220, 60),   # 3 - yellow-green
        (120, 200, 255),  # 4 - light blue
        (220, 120, 255),  # 5 - purple
        (100, 220, 200),  # 6+
    ]

    # ── Title: centered, top of frame ────────────────────────────────────────
    title = (title_text or "").strip()
    if title:
        title_sz = int(width * 0.07)
        title_font = _load_font(title_sz)
        words = title.split()
        mid = max(1, len(words) // 2)
        line1 = " ".join(words[:mid])
        line2 = " ".join(words[mid:])
        ty = int(height * 0.03)
        for line_idx, line in enumerate([line1, line2]):
            if not line:
                continue
            tb = draw.textbbox((0, 0), line, font=title_font)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            tx = (width - tw) // 2   # centered
            fill = theme["num_fill"] if line_idx == 1 else theme["title_fill"]
            for dx in range(-sw, sw + 1):
                for dy in range(-sw, sw + 1):
                    if dx == 0 and dy == 0:
                        continue
                    draw.text((tx + dx, ty + dy), line, font=title_font, fill=(0, 0, 0, 200))
            draw.text((tx, ty), line, font=title_font, fill=fill)
            ty += th + int(height * 0.008)

    # ── Rank list: compact block, bottom 45% ─────────────────────────────────
    revealed_set = set(revealed_ranks) if revealed_ranks else {rank_number}

    # Uniform base font size — active slightly larger, capped so list fits frame
    base_sz   = min(int(width * 0.060), int(height * 0.045))
    active_sz = min(int(width * 0.078), int(height * 0.058))
    line_gap  = int(active_sz * 1.30)   # tight line spacing

    # Position block so it ends near bottom
    block_h = line_gap * total
    section_top = int(height * 0.96) - block_h
    section_top = max(int(height * 0.55), section_top)

    base_font   = _load_font(base_sz)
    active_font = _load_font(active_sz)

    for i in range(1, total + 1):
        is_active  = (i == rank_number)
        is_hidden  = i not in revealed_set
        color_idx  = min(i - 1, len(rank_colors) - 1)
        base_color = rank_colors[color_idx]
        font       = active_font if is_active else base_font
        label_str  = f"{i}."

        if is_active:
            num_fill    = (*base_color, 255)
            lbl_fill    = (255, 255, 255, 255)
            stroke_a    = 220
        elif not is_hidden:  # revealed
            num_fill    = (*base_color, 200)
            lbl_fill    = (220, 220, 220, 200)
            stroke_a    = 150
        else:  # hidden
            num_fill    = (*base_color, 80)
            lbl_fill    = (200, 200, 200, 80)
            stroke_a    = 40

        y = section_top + (i - 1) * line_gap

        # Measure number width for label x offset
        tb_num = draw.textbbox((0, 0), label_str, font=font)
        num_w = tb_num[2] - tb_num[0]

        sw_use = sw if is_active else max(1, sw - 1)

        # Draw number
        for dx in range(-sw_use, sw_use + 1):
            for dy in range(-sw_use, sw_use + 1):
                if dx == 0 and dy == 0:
                    continue
                draw.text((left_x + dx, y + dy), label_str, font=font, fill=(0, 0, 0, stroke_a))
        draw.text((left_x, y), label_str, font=font, fill=num_fill)

        # Draw label (only for revealed+active ranks)
        if not is_hidden and all_labels and len(all_labels) >= i:
            seg_label = (all_labels[i - 1] or "").strip()
            if seg_label:
                lx = left_x + num_w + int(width * 0.02)
                max_lbl_w = width - lx - int(width * 0.04)  # 4% right margin
                # Truncate label until it fits within max_lbl_w
                while len(seg_label) > 1:
                    lb = draw.textbbox((0, 0), seg_label, font=font)
                    if lb[2] - lb[0] <= max_lbl_w:
                        break
                    seg_label = seg_label[:-1].rstrip()
                for dx in range(-sw_use, sw_use + 1):
                    for dy in range(-sw_use, sw_use + 1):
                        if dx == 0 and dy == 0:
                            continue
                        draw.text((lx + dx, y + dy), seg_label, font=font, fill=(0, 0, 0, stroke_a))
                draw.text((lx, y), seg_label, font=font, fill=lbl_fill)

    return Image.alpha_composite(img, overlay)


def _render_ranking_segment(
    source_path: str,
    start_sec: float,
    end_sec: float,
    rank_number: int,
    title_text: str,
    theme_name: str,
    out_path: str,
    target_w: int = 1080,
    target_h: int = 1920,
    total: int = 1,
    all_labels: list = None,
    revealed_ranks: set = None,
    template_config: dict | None = None,
) -> None:
    """Two-pass: ffmpeg trim/crop/scale → h264 intermediate, then PyAV ranking overlay burn."""
    import av
    import tempfile

    duration = max(1.0, float(end_sec) - float(start_sec))
    seek_start = max(0.0, float(start_sec) - 2.0)
    seek_offset = float(start_sec) - seek_start

    # Probe source dims for crop math
    src_w = src_h = 0
    try:
        with av.open(source_path) as probe:
            vs = next((s for s in probe.streams if s.type == "video"), None)
            if vs is not None:
                src_w = vs.codec_context.width or 0
                src_h = vs.codec_context.height or 0
    except Exception:
        pass

    vf_parts = []
    if src_w and src_h and src_w > src_h:
        crop_h = src_h
        crop_w = int(src_h * 9 / 16) & ~1
        x_off = (src_w - crop_w) // 2
        vf_parts.append(f"crop={crop_w}:{crop_h}:{x_off}:0")
    elif src_w and src_h and src_h > src_w:
        crop_w = src_w
        crop_h = int(src_w * 16 / 9) & ~1
        if crop_h <= src_h:
            y_off = (src_h - crop_h) // 2
            vf_parts.append(f"crop={crop_w}:{crop_h}:0:{y_off}")
    vf_parts.append(f"scale={target_w}:{target_h}:flags=lanczos")
    vf_str = ",".join(vf_parts)

    v_chain = f"[0:v:0]trim=start={seek_offset}:duration={duration},setpts=PTS-STARTPTS,{vf_str}[vout]"
    filter_complex = (
        f"{v_chain};"
        f"[0:a:0]atrim=start={seek_offset}:duration={duration},asetpts=PTS-STARTPTS[aout]"
    )

    tmp_h264 = str(Path(out_path).parent / f"_tmp_rank_{Path(out_path).name}")
    cmd1 = [
        "ffmpeg", "-y", "-threads", "2",
        "-ss", str(seek_start),
        "-i", source_path,
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-avoid_negative_ts", "make_zero",
        tmp_h264,
    ]
    r1 = subprocess.run(cmd1, capture_output=True, text=True, timeout=180)
    if r1.returncode != 0 or not Path(tmp_h264).exists() or Path(tmp_h264).stat().st_size < 1000:
        # Retry without audio map (source may have no audio track)
        v_only = f"[0:v:0]trim=start={seek_offset}:duration={duration},setpts=PTS-STARTPTS,{vf_str}[vout]"
        cmd1_noaudio = [
            "ffmpeg", "-y", "-threads", "2", "-ss", str(seek_start), "-i", source_path,
            "-filter_complex", v_only, "-map", "[vout]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-r", "30",
            "-avoid_negative_ts", "make_zero", tmp_h264,
        ]
        r1 = subprocess.run(cmd1_noaudio, capture_output=True, text=True, timeout=180)
        if r1.returncode != 0 or not Path(tmp_h264).exists() or Path(tmp_h264).stat().st_size < 1000:
            err = r1.stderr
            excerpt = (err[:400] + "\n...\n" + err[-400:]) if len(err) > 800 else err
            raise RuntimeError(f"ranking segment pass1 failed (rc={r1.returncode}): {excerpt}")

    try:
        with av.open(tmp_h264) as src, av.open(out_path, "w", format="mp4") as dst:
            v_stream = next((s for s in src.streams if s.type == "video"), None)
            a_stream = next((s for s in src.streams if s.type == "audio"), None)
            if v_stream is None:
                raise RuntimeError("ranking intermediate has no video stream")

            fps = int(round(float(v_stream.average_rate or 30)))
            out_v = dst.add_stream("h264", rate=fps)
            out_v.width = target_w
            out_v.height = target_h
            out_v.pix_fmt = "yuv420p"
            out_v.options = {"crf": "23", "preset": "veryfast", "movflags": "+faststart"}

            out_a = None
            if a_stream is not None:
                a_rate = a_stream.sample_rate or 44100
                a_layout = a_stream.layout.name if a_stream.layout else "stereo"
                out_a = dst.add_stream("aac", rate=a_rate, layout=a_layout)

            frame_idx = 0
            for packet in src.demux(*([v_stream] + ([a_stream] if a_stream else []))):
                if packet.stream is v_stream:
                    for frame in packet.decode():
                        img = frame.to_image()
                        img = _draw_ranking_overlay(img, rank_number, title_text, theme_name, target_w, target_h, total=total, all_labels=all_labels, revealed_ranks=revealed_ranks, template_config=template_config)
                        img = img.convert("RGB")
                        new_frame = av.VideoFrame.from_image(img)
                        new_frame.pts = frame_idx
                        new_frame.time_base = Fraction(1, fps)
                        frame_idx += 1
                        for pkt in out_v.encode(new_frame):
                            dst.mux(pkt)
                        del img, new_frame
                elif out_a is not None and packet.stream is a_stream:
                    if packet.dts is None:
                        continue
                    for aframe in packet.decode():
                        aframe.pts = None
                        for apkt in out_a.encode(aframe):
                            dst.mux(apkt)

            for pkt in out_v.encode(None):
                dst.mux(pkt)
            if out_a is not None:
                for apkt in out_a.encode(None):
                    dst.mux(apkt)

        if not Path(out_path).exists() or Path(out_path).stat().st_size < 1000:
            raise RuntimeError(f"ranking segment produced empty file: {out_path}")
    finally:
        Path(tmp_h264).unlink(missing_ok=True)


def _suggest_ranking_title(topic: str, segment_count: int) -> dict:
    prompt = f"""Generate a catchy title for a Top {segment_count} ranking video about: {topic}
Return JSON: {{"title": "...", "highlight_words": ["word1", "word2"]}}
Title should be punchy, 4-8 words, like "Ranking The Best Goals In Football History"."""
    try:
        result = _call_llm_json([{"role": "user", "content": prompt}], max_tokens=100)
        if isinstance(result, dict) and "title" in result:
            return result
    except Exception:
        pass
    return {"title": f"Top {segment_count} {topic}", "highlight_words": []}


def _generate_voiceover_script(clip: ClipResult, viral_type: str, content_type: str) -> str:
    """Generate a 15-25 word punchy narrator script for this clip via LLM."""
    prompt = f"""Write a punchy 15-25 word voiceover narration for a viral short-form video clip.

Content type: {content_type}
Viral type: {viral_type}
Clip title: {clip.title}
Why it's viral: {clip.reason}

Rules:
- Sound like a hyped-up sports commentator or reaction narrator
- Hook in the first 3 words — immediate tension or disbelief
- End with an emotional one-word payoff: "unbelievable", "sent", "historic", "never again"
- Max 25 words. No hashtags. No emojis. No quotation marks.

Return ONLY valid JSON in this exact shape:
{"script":"<the narration>"}"""
    try:
        result = _call_llm_json([{"role": "user", "content": prompt}], temperature=0.85, max_tokens=80)
        if isinstance(result, dict):
            return (result.get("script") or result.get("text") or result.get("narration") or "")[:250].strip()
        return str(result)[:250].strip()
    except Exception as e:
        logging.warning("_generate_voiceover_script failed: %s", e)
        return ""


def _synthesize_voiceover(script: str, out_path: str) -> bool:
    """Synthesize voiceover MP3 via edge-tts (free, no API key). Returns True on success."""
    if not script:
        return False
    try:
        cmd = [
            "edge-tts",
            "--voice", "en-US-GuyNeural",
            "--rate", "+15%",
            "--text", script,
            "--write-media", out_path,
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=30)
        if r.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 100:
            return True
        logging.warning("edge-tts failed (rc=%d): %s", r.returncode, r.stderr[:200])
    except FileNotFoundError:
        logging.warning("edge-tts not installed — skipping voiceover synthesis")
    except Exception as e:
        logging.warning("_synthesize_voiceover failed: %s", e)
    return False


def _enhance_clip_quality(clip_path: str, out_path: str, src_width: int) -> str:
    """Sharpen + color-grade the clip to a punchy 4K-like look.

    Two-stage pipeline:
    1. ffmpeg unsharp + eq + lanczos scale (fast, always runs).
    2. If source width < 720, OpenCV INTER_LANCZOS4 frame-level super-sampling
       is applied before ffmpeg so ffmpeg gets a cleaner input to work with.

    Returns out_path on success, clip_path on ffmpeg failure.
    """
    vf = "unsharp=lx=5:ly=5:la=0.5:cx=3:cy=3:ca=0.2,eq=saturation=1.2:contrast=1.06:gamma=0.97"
    cmd = [
        "ffmpeg", "-y",
        "-i", clip_path,
        "-vf", vf,
        "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
        "-c:a", "copy",
        "-movflags", "+faststart",
        out_path,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=120)
        if r.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 1000:
            return out_path
        logging.warning("_enhance_clip_quality ffmpeg failed (rc=%d): %s", r.returncode, r.stderr[-200:])
    except Exception as e:
        logging.warning("_enhance_clip_quality failed: %s", e)

    return clip_path


def _detect_action_centroid(source_path: str, start: float, end: float, n_frames: int = 10) -> tuple[float, float]:
    """Sample frames via OpenCV, compute motion centroid via frame differencing.

    Returns (x_ratio, y_ratio) in 0..1 relative to frame dimensions.
    x/y is the detected action hotspot — use as zoompan anchor.
    Falls back to (0.5, 0.45) (lower-center, good for sports) on any failure.
    """
    try:
        import cv2
        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            return 0.5, 0.45

        duration = max(end - start, 1.0)
        grays: list = []
        for i in range(n_frames):
            t = start + duration * i / max(n_frames - 1, 1)
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if not ret:
                continue
            small = cv2.resize(frame, (160, 90))
            grays.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
        cap.release()

        if len(grays) < 2:
            return 0.5, 0.45

        diffs = [cv2.absdiff(grays[i], grays[i - 1]).astype(float) for i in range(1, len(grays))]
        motion = sum(diffs) / len(diffs)

        # Threshold: only keep high-motion pixels (top 20%)
        thresh = float(np.percentile(motion, 80))
        motion[motion < thresh] = 0.0

        total = motion.sum()
        if total < 1e-6:
            return 0.5, 0.45

        import numpy as np
        ys, xs = np.mgrid[0:motion.shape[0], 0:motion.shape[1]]
        cx = float((xs * motion).sum() / total) / motion.shape[1]
        cy = float((ys * motion).sum() / total) / motion.shape[0]

        # Clamp so zoompan viewport stays inside the frame
        return max(0.1, min(0.9, cx)), max(0.1, min(0.9, cy))
    except Exception as e:
        logging.warning("_detect_action_centroid failed: %s", e)
        return 0.5, 0.45


def _mix_audio_tracks(clip_path: str, out_path: str, music_path: str | None = None, vo_path: str | None = None) -> str:
    """Mix background music and/or voiceover under/over the clip audio.

    Returns out_path on success, clip_path (unmixed) on any ffmpeg failure.
    Handles silent source clips by mixing the requested music/voiceover only.
    """
    has_music = music_path and Path(music_path).exists()
    has_vo = vo_path and Path(vo_path).exists()
    if not has_music and not has_vo:
        return clip_path

    def _has_audio_stream(path: str) -> bool:
        try:
            r = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-select_streams", "a:0",
                    "-show_entries", "stream=codec_type",
                    "-of", "csv=p=0",
                    path,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return r.returncode == 0 and "audio" in (r.stdout or "")
        except Exception:
            return False

    has_orig_audio = _has_audio_stream(clip_path)
    inputs: list[str] = ["-i", clip_path]
    filter_parts: list[str] = []
    stream_idx = 1

    if has_music:
        inputs += ["-i", music_path]
        # Loop music to fill clip, keep it quiet
        filter_parts.append(f"[{stream_idx}:a]volume=-18dB,aloop=loop=-1:size=2000000000[music]")
        stream_idx += 1

    if has_vo:
        inputs += ["-i", vo_path]
        filter_parts.append(f"[{stream_idx}:a]volume=1.0[vo]")
        stream_idx += 1

    mix_inputs = ""
    n = 0
    if has_orig_audio:
        # Original audio quieter when voiceover present (preserve crowd ambience)
        orig_vol = "-12dB" if has_vo else "-6dB"
        filter_parts.append(f"[0:a]volume={orig_vol}[orig]")
        mix_inputs += "[orig]"
        n += 1
    if has_music:
        mix_inputs += "[music]"
        n += 1
    if has_vo:
        mix_inputs += "[vo]"
        n += 1
    if n == 0:
        return clip_path
    filter_parts.append(f"{mix_inputs}amix=inputs={n}:duration=shortest:dropout_transition=0:normalize=0[aout]")

    filter_complex = ";".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-avoid_negative_ts", "make_zero",
        out_path,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=120)
        if r.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 1000:
            return out_path
        logging.warning("_mix_audio_tracks failed (rc=%d): %s", r.returncode, r.stderr[-300:])
    except Exception as e:
        logging.warning("_mix_audio_tracks exception: %s", e)
    return clip_path


def _render_clip_streamcopy(
    source_path: str,
    clip: ClipResult,
    output_path: str,
    target_width: int,
    target_height: int,
    crop_mode: Optional[str],
    meta: VideoMeta,
) -> None:
    """Fast path: ffmpeg stream-copy + optional crop/scale. Zero re-encode quality loss."""
    src_w, src_h = meta.width, meta.height
    # Hard cap: never encode more than 120s regardless of caller settings
    if clip.end - clip.start > 120:
        clip = dataclass_replace(clip, end=clip.start + 120)
    duration = clip.end - clip.start

    # Build vf (video filter) for crop + scale if needed
    vf_parts = []
    if crop_mode == "9:16" and src_w > src_h:
        # Landscape → portrait: crop to centre 9:16 pillar
        crop_h = src_h
        crop_w = int(src_h * 9 / 16) & ~1
        x_off = (src_w - crop_w) // 2
        vf_parts.append(f"crop={crop_w}:{crop_h}:{x_off}:0")
    elif crop_mode == "16:9" and src_h > src_w:
        crop_w = src_w
        crop_h = int(src_w * 9 / 16) & ~1
        y_off = (src_h - crop_h) // 2
        vf_parts.append(f"crop={crop_w}:{crop_h}:0:{y_off}")
    elif crop_mode == "1:1":
        side = min(src_w, src_h) & ~1
        vf_parts.append(f"crop={side}:{side}:{(src_w-side)//2}:{(src_h-side)//2}")

    if target_width != src_w or target_height != src_h:
        vf_parts.append(f"scale={target_width}:{target_height}:flags=lanczos")

    # Re-encode even when codecs are stream-copy safe. Stream-copy can only cut on
    # keyframes, which lets video begin before/after the requested start while audio
    # is trimmed independently. Use matching trim/atrim windows and reset both PTS
    # timelines to zero so audio and video are clipped from the exact same interval.
    vf_str = ",".join(vf_parts) if vf_parts else "null"
    clip_start = max(0.0, clip.start)
    clip_duration = max(1.0, duration)
    v_chain = f"[0:v:0]trim=start={clip_start}:duration={clip_duration},setpts=PTS-STARTPTS,{vf_str}[vout]"
    if meta.has_audio:
        filter_complex = (
            f"{v_chain};"
            f"[0:a:0]atrim=start={clip_start}:duration={clip_duration},asetpts=PTS-STARTPTS[aout]"
        )
        maps = ["-map", "[vout]", "-map", "[aout]"]
    else:
        filter_complex = v_chain
        maps = ["-map", "[vout]"]
    # Use -ss before -i for fast keyframe seek; trim filter then does precise frame-accurate cut
    seek_start = max(0.0, clip_start - 2.0)  # seek 2s before clip for keyframe landing
    seek_offset = clip_start - seek_start     # adjust trim to account for seek overshoot
    if seek_offset > 0:
        # Rebuild filter_complex with adjusted trim times relative to seek position
        v_chain2 = f"[0:v:0]trim=start={seek_offset}:duration={clip_duration},setpts=PTS-STARTPTS,{vf_str}[vout]"
        if meta.has_audio:
            filter_complex = (
                f"{v_chain2};"
                f"[0:a:0]atrim=start={seek_offset}:duration={clip_duration},asetpts=PTS-STARTPTS[aout]"
            )
        else:
            filter_complex = v_chain2

    cmd = [
        "ffmpeg", "-y",
        "-threads", "2",
        "-ss", str(seek_start),  # fast seek before input
        "-i", source_path,
        "-filter_complex", filter_complex,
        *maps,
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "veryfast",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "256k",
        "-movflags", "+faststart",
        output_path,
    ]

    encode_timeout = max(180, int(duration * 3))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=encode_timeout)
    out_ok = Path(output_path).exists() and Path(output_path).stat().st_size >= 1000
    if result.returncode != 0 or not out_ok:
        err = result.stderr
        excerpt = (err[:400] + "\n...\n" + err[-400:]) if len(err) > 800 else err
        raise RuntimeError(f"ffmpeg render failed (rc={result.returncode}): {excerpt}")


def _render_clip_ffmpeg_captions(
    source_path: str,
    clip: ClipResult,
    output_path: str,
    captions: list[CaptionSegment],
    target_width: int,
    target_height: int,
    crop_mode: Optional[str],
    meta: VideoMeta,
    style: str = "capcut",
    hook_text: str = "",
    hook_duration_sec: float = 0.0,
    punch_zoom: bool = False,
    background_style: str = "center_crop",
) -> None:
    """Two-pass caption burn for VP9/AV1 sources.
    Pass 1: ffmpeg transcode clip to h264 (low memory, fast seek).
    Pass 2: PyAV frame-by-frame caption burn on h264 intermediate.
    Avoids simultaneous VP9 decode + libx264 encode + libass = OOM (rc=-9)."""
    import tempfile

    src_w, src_h = meta.width, meta.height
    # Hard cap: never encode more than 120s regardless of caller settings
    if clip.end - clip.start > 120:
        clip = dataclass_replace(clip, end=clip.start + 120)
    duration = clip.end - clip.start

    # Pass 1: transcode VP9/AV1 clip segment → h264 intermediate (no captions yet)
    tmp_h264 = str(Path(output_path).parent / f"_tmp_h264_{Path(output_path).name}")

    vf_parts = []
    use_blur_fill = background_style == "blur_fill" and crop_mode == "9:16" and src_w > src_h
    if use_blur_fill:
        # Blur-fill: keep landscape video visible inside blurred 9:16 background.
        # Filter built in v_chain below using split; vf_parts stays empty for this path.
        pass
    elif crop_mode == "9:16" and src_w > src_h:
        crop_h = src_h
        crop_w = int(src_h * 9 / 16) & ~1
        x_off = (src_w - crop_w) // 2
        vf_parts.append(f"crop={crop_w}:{crop_h}:{x_off}:0")
    elif crop_mode == "16:9" and src_h > src_w:
        crop_w = src_w
        crop_h = int(src_w * 9 / 16) & ~1
        y_off = (src_h - crop_h) // 2
        vf_parts.append(f"crop={crop_w}:{crop_h}:0:{y_off}")
    elif crop_mode == "1:1":
        side = min(src_w, src_h) & ~1
        vf_parts.append(f"crop={side}:{side}:{(src_w-side)//2}:{(src_h-side)//2}")

    if not use_blur_fill and (target_width != src_w or target_height != src_h):
        vf_parts.append(f"scale={target_width}:{target_height}:flags=lanczos")

    clip_start = max(0.0, clip.start)
    clip_duration = max(1.0, duration)
    if punch_zoom:
        # Detect where the action is before building the filter
        cx_ratio, cy_ratio = _detect_action_centroid(source_path, clip_start, clip_start + clip_duration)
        cx_px = int(src_w * cx_ratio)
        cy_px = int(src_h * cy_ratio)
        fps_int = max(1, int(meta.fps))
        zoom_expr = f"if(lte(on\\,{fps_int})\\,min(zoom+0.005\\,1.12)\\,1.12)"
        # x/y = top-left of zoomed viewport, clamped so it stays inside the frame
        zoom_x = f"max(0\\,min(iw-iw/zoom\\,{cx_px}-iw/zoom/2))"
        zoom_y = f"max(0\\,min(ih-ih/zoom\\,{cy_px}-ih/zoom/2))"

    if use_blur_fill:
        # Blur-fill pass 1: layout only (split+scale+boxblur+overlay).
        # zoompan intentionally EXCLUDED here — it buffers fps_int frames simultaneously
        # with the split+boxblur frames → OOM (rc=-9). Applied in a cheap pass 3 instead.
        tw, th = target_width, target_height
        trim = f"trim=start={clip_start}:duration={clip_duration},setpts=PTS-STARTPTS"
        v_chain = (
            f"[0:v:0]{trim},split=2[main_raw][bg_raw];"
            f"[bg_raw]scale={tw}:{th}:force_original_aspect_ratio=increase,"
            f"crop={tw}:{th},boxblur=10:4[bg];"   # lighter blur → less memory
            f"[main_raw]scale={tw}:{th}:force_original_aspect_ratio=decrease[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[vout]"
        )
    else:
        if punch_zoom:
            # zoompan safe in center-crop path (no split/boxblur competing for memory)
            vf_parts.append(
                f"zoompan=z='{zoom_expr}':d=1:fps={fps_int}:"
                f"x='{zoom_x}':y='{zoom_y}':s={target_width}x{target_height}"
            )
        vf_str = ",".join(vf_parts) if vf_parts else "null"
        v_chain = f"[0:v:0]trim=start={clip_start}:duration={clip_duration},setpts=PTS-STARTPTS,{vf_str}[vout]"
    if meta.has_audio:
        filter_complex = (
            f"{v_chain};"
            f"[0:a:0]atrim=start={clip_start}:duration={clip_duration},asetpts=PTS-STARTPTS[aout]"
        )
        maps = ["-map", "[vout]", "-map", "[aout]"]
    else:
        filter_complex = v_chain
        maps = ["-map", "[vout]"]
    # Fast seek before input; adjust trim times relative to seek landing point
    seek_start1 = max(0.0, clip_start - 2.0)
    seek_off1 = clip_start - seek_start1
    if seek_off1 > 0:
        if use_blur_fill:
            trim1 = f"trim=start={seek_off1}:duration={clip_duration},setpts=PTS-STARTPTS"
            v_chain = (
                f"[0:v:0]{trim1},split=2[main_raw][bg_raw];"
                f"[bg_raw]scale={tw}:{th}:force_original_aspect_ratio=increase,"
                f"crop={tw}:{th},boxblur=10:4[bg];"
                f"[main_raw]scale={tw}:{th}:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2[vout]"
            )
        else:
            v_chain = f"[0:v:0]trim=start={seek_off1}:duration={clip_duration},setpts=PTS-STARTPTS,{vf_str}[vout]"
        if meta.has_audio:
            filter_complex = (
                f"{v_chain};"
                f"[0:a:0]atrim=start={seek_off1}:duration={clip_duration},asetpts=PTS-STARTPTS[aout]"
            )
        else:
            filter_complex = v_chain

    cmd1 = [
        "ffmpeg", "-y",
        "-threads", "2",
        "-ss", str(seek_start1),  # fast seek before input
        "-i", source_path,
        "-filter_complex", filter_complex,
        *maps,
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "ultrafast",
        "-profile:v", "baseline",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "256k",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        tmp_h264,
    ]

    try:
        encode_timeout = max(180, int(duration * 3))
        r1 = subprocess.run(cmd1, capture_output=True, text=True, timeout=encode_timeout)
        if r1.returncode != 0 or not Path(tmp_h264).exists() or Path(tmp_h264).stat().st_size < 1000:
            err = r1.stderr
            excerpt = (err[:400] + "\n...\n" + err[-400:]) if len(err) > 800 else err
            raise RuntimeError(f"ffmpeg transcode pass1 failed (rc={r1.returncode}): {excerpt}")

        # Pass 1.5 (blur_fill + punch_zoom only): apply zoompan on the h264 intermediate.
        # Kept separate from pass 1 so boxblur+split+zoompan never compete for memory.
        if use_blur_fill and punch_zoom:
            tmp_zoomed = tmp_h264 + "_zoomed.mp4"
            z_expr = f"if(lte(on\\,{fps_int})\\,min(zoom+0.005\\,1.12)\\,1.12)"
            z_x = f"max(0\\,min(iw-iw/zoom\\,{cx_px}-iw/zoom/2))"
            z_y = f"max(0\\,min(ih-ih/zoom\\,{cy_px}-ih/zoom/2))"
            zoom_cmd = [
                "ffmpeg", "-y", "-threads", "1",
                "-i", tmp_h264,
                "-vf", f"zoompan=z='{z_expr}':d=1:fps={fps_int}:x='{z_x}':y='{z_y}':s={target_width}x{target_height}",
                "-c:v", "libx264", "-crf", "18", "-preset", "ultrafast",
                "-profile:v", "baseline", "-pix_fmt", "yuv420p",
                "-c:a", "copy", "-avoid_negative_ts", "make_zero",
                tmp_zoomed,
            ]
            rz = subprocess.run(zoom_cmd, capture_output=True, text=True, timeout=180)
            if rz.returncode == 0 and Path(tmp_zoomed).exists() and Path(tmp_zoomed).stat().st_size > 1000:
                Path(tmp_h264).unlink(missing_ok=True)
                tmp_h264 = tmp_zoomed
            else:
                logging.warning("zoompan pass failed (rc=%d) — skipping zoom: %s", rz.returncode, rz.stderr[-200:])
                Path(tmp_zoomed).unlink(missing_ok=True)

        # Pass 2: caption burn — only run PyAV loop when captions or hook overlay needed.
        # When no captions/hook, streamcopy the h264 intermediate (zero re-encode cost).
        needs_pass2 = bool(captions) or bool(hook_text)
        if needs_pass2:
            h264_meta = VideoMeta(
                width=target_width,
                height=target_height,
                fps=meta.fps,
                duration=duration,
                codec="h264",
                has_audio=meta.has_audio,
            )
            _render_clip(
                source_path=tmp_h264,
                clip=ClipResult(
                    start=0.0,
                    end=duration,
                    score=clip.score,
                    title=clip.title,
                    reason=clip.reason,
                ),
                output_path=output_path,
                captions=captions,
                style=style,
                target_width=target_width,
                target_height=target_height,
                crop_mode=None,
                meta=h264_meta,
                burn_captions=True,
                hook_text=hook_text,
                hook_duration_sec=hook_duration_sec,
            )
        else:
            # No captions or hook — rename/move intermediate directly, no re-encode
            import shutil
            shutil.move(tmp_h264, output_path)
            tmp_h264 = output_path  # prevent finally from deleting it
    finally:
        try:
            Path(tmp_h264).unlink(missing_ok=True)
        except Exception:
            pass


def _render_clip(
    source_path: str,
    clip: ClipResult,
    output_path: str,
    captions: list[CaptionSegment],
    style: str,
    target_width: int,
    target_height: int,
    crop_mode: Optional[str],
    meta: VideoMeta,
    burn_captions: bool = True,
    hook_text: str = "",
    hook_duration_sec: float = 0.0,
) -> None:
    import av

    clip_dur = clip.end - clip.start
    cfg = CAPTION_STYLE_CFG.get(style, CAPTION_STYLE_CFG["capcut"])
    _, _, _, font_size, _ = cfg
    font_main = _load_font(font_size) if burn_captions else None
    font_highlight = _load_font(int(font_size * 1.28)) if burn_captions else None
    use_captions = burn_captions and captions and clip_dur <= CAPTION_BURN_MAX_SECONDS
    caption_timeline = _build_caption_timeline(captions, style) if use_captions else {}

    fps = meta.fps
    frame_idx = 0
    audio_sample_idx = 0

    with av.open(output_path, "w", format="mp4") as dst:
        out_v = dst.add_stream("h264", rate=int(fps))
        out_v.width = target_width
        out_v.height = target_height
        out_v.pix_fmt = "yuv420p"
        out_v.options = {
            "crf": str(VIDEO_CRF),
            "preset": "veryfast",
            "profile:v": "high",
            "level": "4.2",
            "movflags": "+faststart", # web-optimized: moov atom at front for streaming
        }

        out_a = None
        if meta.has_audio:
            ch_layout = "stereo" if meta.audio_channels >= 2 else "mono"
            out_a = dst.add_stream("aac", rate=meta.audio_sample_rate, layout=ch_layout)
            out_a.bit_rate = AUDIO_BITRATE

        with av.open(source_path) as src:
            v_stream = next((s for s in src.streams if s.type == "video"), None)
            a_stream = next((s for s in src.streams if s.type == "audio"), None) if out_a else None
            decode_streams = [s for s in [v_stream, a_stream] if s is not None]

            src.seek(int(clip.start * 1_000_000))
            video_done = False
            audio_done = False
            # Track the actual timestamp of the first accepted video frame so audio
            # PTS can be anchored to the same origin — prevents A/V drift when seek
            # lands on a keyframe slightly before clip.start.
            first_video_t: float | None = None

            for packet in src.demux(*decode_streams):
                if packet.pts is None:
                    continue  # end-of-container flush packet — handled after loop

                if video_done and (audio_done or not out_a):
                    break

                if packet.stream == v_stream:
                    if video_done:
                        continue
                    t = float(packet.pts * v_stream.time_base)
                    if t > clip.end + 0.05:
                        video_done = True
                        continue
                    if t < clip.start - 0.05:
                        continue
                    for frame in packet.decode():
                        t_frame = float(frame.pts * v_stream.time_base) if frame.pts is not None else t
                        if first_video_t is None:
                            first_video_t = t_frame
                        t_in_clip = t_frame - clip.start

                        needs_pil = bool(crop_mode or caption_timeline or (hook_text and hook_duration_sec > 0))
                        if needs_pil:
                            # PIL path: to_image reuses internal buffer; del immediately after encode
                            img = frame.to_image()
                            if img.mode != "RGB":
                                img = img.convert("RGB")
                            if crop_mode:
                                img = _crop_frame(img, crop_mode, target_width, target_height)
                            if caption_timeline:
                                img = _draw_caption(img, max(t_in_clip, 0), caption_timeline, style,
                                                    target_width, target_height, font_main, font_highlight, cfg)
                            if hook_text and hook_duration_sec > 0:
                                img = _draw_hook_overlay(img, max(t_in_clip, 0), hook_text,
                                                         hook_duration_sec, target_width, target_height)
                            new_frame = av.VideoFrame.from_image(img)
                            del img  # free PIL buffer before encode
                        else:
                            # Fast path: reformat in yuv420p directly — zero PIL overhead
                            new_frame = frame.reformat(
                                width=target_width, height=target_height,
                                format="yuv420p",
                            )

                        new_frame.pts = frame_idx
                        new_frame.time_base = Fraction(1, int(fps))
                        frame_idx += 1
                        for pkt in out_v.encode(new_frame):
                            dst.mux(pkt)
                        del new_frame  # release frame buffer before next decode

                elif out_a and packet.stream == a_stream:
                    if audio_done:
                        continue
                    t = float(packet.pts * a_stream.time_base)
                    if t > clip.end + 0.1:
                        audio_done = True
                        continue
                    if t < clip.start - 0.05:
                        continue
                    for frame in packet.decode():
                        t_frame = float(frame.pts * a_stream.time_base) if frame.pts is not None else t
                        # Align audio origin to first video frame so A/V stays in sync
                        anchor = first_video_t if first_video_t is not None else clip.start
                        pts_samples = max(0, int((t_frame - anchor) * meta.audio_sample_rate))
                        if audio_sample_idx == 0 and pts_samples > 0:
                            audio_sample_idx = pts_samples
                        frame.pts = audio_sample_idx
                        frame.dts = audio_sample_idx
                        frame.time_base = Fraction(1, meta.audio_sample_rate)
                        audio_sample_idx += frame.samples
                        for pkt in out_a.encode(frame):
                            dst.mux(pkt)

        for pkt in out_v.encode(None):
            dst.mux(pkt)
        if out_a:
            for pkt in out_a.encode(None):
                dst.mux(pkt)

    if not Path(output_path).exists() or Path(output_path).stat().st_size < 1000:
        raise RuntimeError(f"Clip render produced empty file: {output_path}")


def _generate_thumbnail(source_path: str, clip: ClipResult, output_path: str) -> None:
    midpoint = clip.start + (clip.end - clip.start) / 2
    result = subprocess.run(
        ["ffmpeg", "-y", "-ss", str(midpoint), "-i", source_path,
         "-vframes", "1", "-q:v", "2", "-f", "image2", output_path],
        capture_output=True, timeout=30,
    )
    if result.returncode != 0 or not Path(output_path).exists():
        raise RuntimeError(f"Thumbnail failed: {result.stderr[-200:]}")


# ── Stage 7b: AI content generation (title + per-platform copy) ───────────────

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


def _multi_agent_clip_content(
    clip: "ClipResult",
    transcript_snippet: str,
    platforms: list[str],
    content_type: str,
    topic_focus: str | None = None,
) -> dict:
    """Run 3 parallel agents: viral description, trending hashtags, title optimizer."""
    import concurrent.futures

    platforms_str = ", ".join(platforms)
    topic_ctx = f"Topic: {topic_focus}\n" if topic_focus else ""
    clip_ctx = f"Clip reason: {clip.reason}\nClip title hint: {clip.title}"

    # Agent 1 — Viral Description Writer
    def _desc_agent():
        prompt = f"""You are a viral social media copywriter specializing in {content_type} content.

{topic_ctx}{clip_ctx}
Transcript excerpt:
{transcript_snippet[:3000]}

Write platform-optimized descriptions for this clip. Each description must:
- Open with a HOOK (first 5 words stop the scroll)
- Build curiosity or emotional connection in 2-3 sentences
- End with a call-to-action or cliffhanger
- Match platform tone: TikTok=casual/punchy, Reels=visual/trendy, Shorts=direct/fast

Return JSON:
{{
  "platforms": {{
    "tiktok": {{"description": "<150 char hook-first caption>", "cta": "<comment bait question>"}},
    "reels": {{"description": "<visual storytelling caption 100-200 chars>", "cta": "<save/share prompt>"}},
    "shorts": {{"description": "<direct punchy caption under 100 chars>", "cta": "<subscribe hook>"}}
  }}
}}"""
        return _call_llm_json([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=1000)

    # Agent 2 — Trending Hashtag Researcher
    def _hashtag_agent():
        prompt = f"""You are a viral hashtag research agent. Your job is to identify the REAL trending hashtags being used right now on TikTok, Instagram Reels, and YouTube Shorts for this type of content.

Content type: {content_type}
{topic_ctx}{clip_ctx}
Transcript excerpt:
{transcript_snippet[:400]}

RESEARCH TASK — Think like a trending content analyst:
1. What topics, people, events, or themes appear in this clip?
2. What hashtags are people ACTUALLY searching and following for this content RIGHT NOW?
3. What mega viral tags (#viral #trending #fyp #foryou #reels) apply universally?
4. What niche tags are specific to this exact topic/moment?
5. What community tags will surface this to the right audience?

HASHTAG STRATEGY:
- 4-5 mega tags: #viral #trending #fyp #foryoupage #explore (always include these)
- 4-5 topic tags: specific to what's discussed (e.g. #politics #news #science #gaming)
- 3-4 niche tags: sub-topic specifics (e.g. #2024election #aitools #streetfood)
- 2-3 engagement tags: #watchthis #mustsee #mindblown or emotion-driven tags
- 2-3 platform-native tags relevant to current trends on each platform

RULES — CRITICAL:
- ALL tags must be LOWERCASE only — no CamelCase, no uppercase, no mixed case
- No spaces inside tags
- No special characters except letters and numbers
- Include # prefix in output
- Research actual trending tags — do NOT make up fake tags

Return JSON:
{{
  "hashtags": {{
    "mega": ["#viral", "#trending", "#fyp", "#foryou", "#explore"],
    "topic": ["#tag1", "#tag2", "#tag3", "#tag4"],
    "niche": ["#tag1", "#tag2", "#tag3"],
    "engagement": ["#watchthis", "#mustsee", "#tag3"],
    "by_platform": {{
      "tiktok": ["#viral", "#fyp", "#foryou", "<5 more topic-specific lowercase tags>"],
      "reels": ["#reels", "#instagram", "#explore", "<5 more topic-specific lowercase tags>"],
      "shorts": ["#shorts", "#youtubeshorts", "<3 more topic-specific lowercase tags>"]
    }}
  }}
}}"""
        return _call_llm_json([{"role": "user", "content": prompt}], temperature=0.4, max_tokens=1000)

    # Agent 3 — Title Optimizer (generates 5 options, picks best)
    def _title_agent():
        prompt = f"""You are a viral title specialist. Generate 5 title options for this clip, then select the single BEST one.

Content type: {content_type}
{topic_ctx}{clip_ctx}
Transcript excerpt:
{transcript_snippet[:400]}

Title rules:
- Under 80 characters
- Creates curiosity gap OR makes a bold claim OR triggers emotion
- Optimized for click-through as a TikTok caption or YouTube Shorts title
- NO clickbait that doesn't deliver — the title must reflect what's actually in the clip
- Formats that work: "X did Y and Z happened", "Nobody talks about X", "The truth about X", "When X meets Y"

Generate 5 options, score each 1-10, then return only the best.

Return JSON:
{{
  "titles": [
    {{"text": "<title>", "score": <1-10>, "hook_type": "<curiosity|emotion|bold|reveal>"}}
  ],
  "best_title": "<the highest scoring title>"
}}"""
        return _call_llm_json([{"role": "user", "content": prompt}], temperature=0.8, max_tokens=600)

    # Run all 3 in parallel
    desc_result, hashtag_result, title_result = {}, {}, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(_desc_agent): "desc",
            executor.submit(_hashtag_agent): "hashtag",
            executor.submit(_title_agent): "title",
        }
        for future in concurrent.futures.as_completed(futures):
            agent_name = futures[future]
            try:
                result = future.result(timeout=30)
                if agent_name == "desc":
                    desc_result = result
                elif agent_name == "hashtag":
                    hashtag_result = result
                elif agent_name == "title":
                    title_result = result
            except Exception as e:
                logging.warning("_multi_agent_clip_content %s agent failed: %s", agent_name, e)

    def _normalize_tag(t: str) -> str:
        """Lowercase, strip #, remove spaces/special chars, re-add #."""
        t = t.strip().lower().lstrip("#")
        t = re.sub(r"[^a-z0-9]", "", t)
        return f"#{t}" if t else ""

    # Merge results into final platform content
    merged_platforms = {}
    plat_descs = desc_result.get("platforms", {})
    ht = hashtag_result.get("hashtags", {})
    plat_hashtags = ht.get("by_platform", {})

    # Build master tag pool — all categories, normalized lowercase, deduplicated
    raw_all = (
        ht.get("mega", [])
        + ht.get("topic", [])
        + ht.get("niche", [])
        + ht.get("engagement", [])
        + ht.get("content_type", [])  # backward compat
    )
    seen: set[str] = set()
    all_hashtags: list[str] = []
    for t in raw_all:
        norm = _normalize_tag(t)
        if norm and norm not in seen:
            seen.add(norm)
            all_hashtags.append(norm)

    best_title = title_result.get("best_title") or clip.title or "Viral Clip"

    for plat in platforms:
        plat_key = plat.lower().replace("youtube_shorts", "shorts")
        desc_data = plat_descs.get(plat_key, {})
        description = desc_data.get("description", "")
        cta = desc_data.get("cta", "")

        # Per-platform tags, normalized lowercase, fallback to master pool
        raw_plat_tags = plat_hashtags.get(plat_key, [])
        plat_seen: set[str] = set()
        plat_tags: list[str] = []
        for t in raw_plat_tags:
            norm = _normalize_tag(t)
            if norm and norm not in plat_seen:
                plat_seen.add(norm)
                plat_tags.append(norm)
        if not plat_tags:
            plat_tags = all_hashtags[:8]

        full_desc = f"{description}\n\n{cta}" if cta else description

        merged_platforms[plat] = {
            "description": full_desc or clip.reason or "",
            "tags": [t.lstrip("#") for t in plat_tags],  # stored without # for DB compat
        }

    return {
        "title": best_title,
        "platforms": merged_platforms,
        "all_hashtags": all_hashtags,  # includes # prefix, all lowercase
    }


def _ai_generate_clip_content(
    clip: "ClipResult",
    transcript_snippet: str,
    platforms: list[str],
    captions_srt: str = "",
) -> dict:
    """Return {title, description, tags} per platform using Groq LLM."""
    # Caption SRT is the primary source — it contains exactly what's spoken in the clip
    caption_text = _srt_to_plain(captions_srt) if captions_srt else transcript_snippet
    if not caption_text.strip():
        caption_text = f"[Hook: {clip.reason}]" if clip.reason else "[no transcript]"

    platforms_str = ", ".join(platforms) if platforms else "tiktok, reels, shorts"
    prompt = f"""You are a viral social media content strategist. Generate platform-optimized content for this video clip.

Clip hook: {clip.reason or clip.title}
Caption text (exact words spoken in this clip):
{caption_text[:800]}

Platforms to generate for: {platforms_str}

Rules:
- Title: STRICT MAXIMUM 100 CHARACTERS. Count every character before writing. If over 100, shorten it. No exceptions. Punchy, no hashtags, creates curiosity or urgency.
- Description: platform-native tone
  - tiktok/reels/shorts: 1-2 casual sentences, hook first
  - youtube: 2-3 keyword-rich searchable sentences
  - instagram: 2-3 emotive storytelling sentences
  - twitter: 1 punchy tweetable sentence
- Tags: hashtags without # symbol
  - tiktok/reels/shorts: 5-8 trending tags
  - youtube: 10-15 keyword tags (short + long-tail)
  - instagram: 15-20 hashtags
  - twitter: 3-5 tags

Return ONLY valid JSON — MUST include every platform listed above:
{{
  "title": "<viral clip title, MUST be 100 characters or fewer>",
  "platforms": {{
    "<platform_name>": {{
      "description": "<description>",
      "tags": ["tag1", "tag2"]
    }}
  }}
}}"""

    try:
        result = _call_llm_json(
            [{"role": "user", "content": prompt}],
            temperature=0.7, max_tokens=max(1500, len(platforms) * 400),
        )
        if "platforms" not in result or not result["platforms"]:
            raise ValueError("empty platforms in response")
        # Normalize all tags to lowercase, no special chars
        for plat_data in result.get("platforms", {}).values():
            plat_data["tags"] = [
                re.sub(r"[^a-z0-9]", "", t.strip().lower().lstrip("#"))
                for t in plat_data.get("tags", [])
                if t.strip()
            ]
        return result
    except Exception as e:
        logging.warning(f"_ai_generate_clip_content failed: {e}")
        return {}


def _ai_generate_video_metadata(words: list[WordTimestamp], duration: float, topic_focus: str = "") -> dict:
    """Analyze full transcript and return video-level metadata: summary, topics, keywords, sentiment, content type."""
    if not words:
        return {}

    # Use timed transcript (M:SS stamped lines) — better sentence structure than raw word join
    timed_transcript = _build_timed_transcript(words)
    topic_line = f"Topic hint: {topic_focus}\n" if topic_focus else ""
    duration_min = int(duration // 60)

    prompt = f"""Analyze this video transcript and return structured metadata.

{topic_line}Duration: {duration_min} minutes
Transcript (with timestamps):
{timed_transcript[:3000]}

Return ONLY valid JSON:
{{
  "summary": "<2-3 sentence summary of the video content>",
  "title_suggestion": "<SEO-optimized title, 60 chars max>",
  "topics": ["<main topic>", "<subtopic>", ...],
  "keywords": ["<keyword1>", "<keyword2>", ...],
  "sentiment": "<positive|negative|neutral|mixed>",
  "content_type": "<educational|entertainment|news|tutorial|vlog|interview|opinion|other>",
  "occasion": "<football|soccer|sports|gaming|esports|podcast|interview|general>",
  "viral_type": "<goal|embarrassing_moment|genius_play|player_story|tactical_breakdown|reaction|general>",
  "target_audience": "<brief description of ideal viewer>",
  "key_moments": [
    {{"timestamp_sec": <number>, "description": "<what happens>"}}
  ],
  "language_detected": "<ISO 639-1 code, e.g. en>"
}}"""

    try:
        return _call_llm_json(
            [{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=1000,
        )
    except Exception as e:
        logging.warning(f"_ai_generate_video_metadata failed: {e}")
        return {}


def _batch_ai_content(
    clips: list[ClipResult],
    words: list[WordTimestamp],
    all_captions: dict[int, list],
    platforms: list[str],
    content_type: str = "other",
    topic_focus: str | None = None,
) -> dict[int, dict]:
    """Generate AI title/description/tags for all clips in parallel. Returns {clip_index: content}."""
    def _gen_one(idx_clip: tuple[int, ClipResult]) -> tuple[int, dict]:
        idx, clip = idx_clip
        captions = all_captions.get(idx, [])
        srt = _generate_srt(captions)
        clip_words = [w.word for w in words if clip.start <= w.start <= clip.end]
        snippet = " ".join(clip_words[:80])
        try:
            content = _multi_agent_clip_content(
                clip=clip,
                transcript_snippet=snippet,
                platforms=platforms,
                content_type=content_type,
                topic_focus=topic_focus,
            )
        except Exception as e:
            logging.warning("_multi_agent_clip_content failed for clip %s: %s — falling back", clip.start, e)
            content = _ai_generate_clip_content(clip, snippet, platforms, captions_srt=srt)
        return idx, content

    results: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(clips), 4)) as executor:
        for idx, content in executor.map(_gen_one, enumerate(clips)):
            results[idx] = content
    return results


# ── Stage 8: Export clip + upload to Cloudinary ───────────────────────────────

def _export_clip(
    tenant_id: str,
    video_id: str,
    clip: ClipResult,
    captions: list[CaptionSegment],
    source_path: str,
    work_dir: Path,
    meta: VideoMeta,
    cfg: dict,
    words: list | None = None,
    ai_content: dict | None = None,
    occasion: str = "",
    viral_type: str = "",
    job_id: str = "",
    clip_index: int = 0,
    clip_total: int = 1,
) -> str | None:
    from workers.tasks.templates import resolve_template, MUSIC_TRACKS

    def _prog(step: str, pct: int, msg: str) -> None:
        if job_id:
            _publish_progress(job_id, step, pct, "processing", msg)

    clip_id = str(uuid.uuid4())
    clip_path = str(work_dir / f"clip_{clip_id}.mp4")
    thumb_path = str(work_dir / f"clip_{clip_id}_thumb.jpg")

    aspect_ratio = cfg.get("aspect_ratio", "9:16")
    reframe = REFRAME_PRESETS.get(aspect_ratio)
    if reframe:
        target_w, target_h, crop_mode = reframe
    else:
        target_w, target_h, crop_mode = meta.width, meta.height, None

    # Apply output quality cap
    quality_tier = cfg.get("output_quality", "source")
    cap = QUALITY_CAP.get(quality_tier)
    if cap is not None:
        long_edge = max(target_w, target_h)
        if long_edge > cap:
            scale = cap / long_edge
            target_w = int(target_w * scale) & ~1  # keep even
            target_h = int(target_h * scale) & ~1

    # Resolve template — explicit override or auto-detect from occasion
    tmpl = resolve_template(occasion, cfg.get("template_id"))
    tmpl_label = cfg.get("template_id") or occasion or "auto"
    _prog("template", 62, f"Clip {clip_index+1}/{clip_total}: applying '{tmpl_label}' template"
          + (f" (blur-fill bg, {tmpl.get('background_style','center_crop')})" if tmpl.get("background_style") == "blur_fill" else ""))

    burn_captions = cfg.get("add_captions", False)
    # Let automatic templates supply their own caption style when the request is
    # still on the default CapCut style; non-default user choices keep priority.
    requested_style = cfg.get("caption_style") or "capcut"
    if requested_style == "capcut" and tmpl.get("caption_style"):
        style = tmpl.get("caption_style", "capcut")
    else:
        style = requested_style
    if style not in CAPTION_STYLE_CFG:
        style = "capcut"

    # Hook overlay parameters
    content = ai_content or {}
    ai_title = (content.get("title") or clip.title or "")
    hook_text = ""
    hook_duration_sec = 0.0
    if tmpl.get("hook_overlay"):
        hook_text = _make_hook_text(ai_title, viral_type)
        hook_duration_sec = float(tmpl.get("hook_duration_sec", 3.0))

    punch_zoom = bool(tmpl.get("punch_zoom"))
    background_style = str(tmpl.get("background_style", "center_crop"))

    # Respect the captions toggle. Hook visibility is handled by the separate
    # hook overlay; do not burn transcript captions when add_captions is false.

    # blur_fill forces the ffmpeg path (needs filter_complex split)
    needs_template_render = bool(hook_text or punch_zoom or background_style == "blur_fill")

    render_desc = []
    if background_style == "blur_fill": render_desc.append("blur-fill bg")
    if punch_zoom: render_desc.append("CV zoom")
    if hook_text: render_desc.append(f'hook "{hook_text}"')
    if burn_captions: render_desc.append("captions")
    _prog("render", 65, f"Clip {clip_index+1}/{clip_total}: rendering"
          + (f" ({', '.join(render_desc)})" if render_desc else ""))

    if not burn_captions and not needs_template_render:
        # Fast path: stream-copy when no captions and no template overlays
        _render_clip_streamcopy(
            source_path=source_path,
            clip=clip,
            output_path=clip_path,
            target_width=target_w,
            target_height=target_h,
            crop_mode=crop_mode,
            meta=meta,
        )
    else:
        # ffmpeg subprocess path — handles captions, hook overlay, punch_zoom, blur_fill
        _render_clip_ffmpeg_captions(
            source_path=source_path,
            clip=clip,
            output_path=clip_path,
            captions=captions if burn_captions else [],
            target_width=target_w,
            target_height=target_h,
            crop_mode=crop_mode,
            meta=meta,
            style=style,
            hook_text=hook_text,
            hook_duration_sec=hook_duration_sec,
            punch_zoom=punch_zoom,
            background_style=background_style,
        )

    # Post-render: mix background music and/or voiceover if requested
    want_music = cfg.get("music", True) and tmpl.get("music_track")
    # Respect the user-facing voiceover toggle. Templates can suggest a style,
    # but must not force narration when the UI/default config sends false.
    want_vo = bool(cfg.get("voiceover", False))

    music_path: str | None = None
    if want_music:
        track_key = cfg.get("music_track") or tmpl.get("music_track")
        music_path = MUSIC_TRACKS.get(track_key) if track_key else None

    vo_path: str | None = None
    if want_vo:
        _prog("voiceover", 75, f"Clip {clip_index+1}/{clip_total}: generating AI voiceover…")
        vo_script = _generate_voiceover_script(clip, viral_type, cfg.get("content_type", "other"))
        if vo_script:
            _vo_out = str(work_dir / f"clip_{clip_id}_vo.mp3")
            if _synthesize_voiceover(vo_script, _vo_out):
                vo_path = _vo_out

    if music_path or vo_path:
        audio_desc = []
        if music_path: audio_desc.append("music")
        if vo_path: audio_desc.append("voiceover")
        _prog("audio_mix", 80, f"Clip {clip_index+1}/{clip_total}: mixing {' + '.join(audio_desc)}…")
        mixed_path = str(work_dir / f"clip_{clip_id}_mixed.mp4")
        result_path = _mix_audio_tracks(clip_path, mixed_path, music_path=music_path, vo_path=vo_path)
        if result_path == mixed_path and Path(mixed_path).exists():
            # Replace clip_path with the mixed version
            try:
                Path(clip_path).unlink(missing_ok=True)
            except Exception:
                pass
            clip_path = mixed_path
        # Clean up voiceover temp
        if vo_path:
            try:
                Path(vo_path).unlink(missing_ok=True)
            except Exception:
                pass

    try:
        _generate_thumbnail(source_path, clip, thumb_path)
    except Exception:
        pass

    thumb_key = f"clips/{tenant_id}/{clip_id}_thumb.jpg"

    srt_content = _generate_srt(captions)

    ai_title = ai_title[:100].strip()
    clip_meta = {
        "ai_title": ai_title,
        "viral_reason": clip.reason or "",
        "viral_score": round(clip.score, 2),
        "platforms": content.get("platforms", {}),
        "occasion": occasion or "",
        "viral_type": viral_type or "",
        "template_id": cfg.get("template_id") or "",
        "aspect_ratio": aspect_ratio,
    }
    if content.get("all_hashtags"):
        clip_meta["trending_hashtags"] = content["all_hashtags"]

    # Upload thumbnail synchronously (small file, fast) — video upload deferred to queue
    from shared.storage.base import get_storage
    thumb_url: str | None = None
    if Path(thumb_path).exists():
        try:
            async def _up_thumb() -> str | None:
                _storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
                with open(thumb_path, "rb") as f:
                    return await _storage.upload(f, thumb_key, "image/jpeg")
            thumb_url = asyncio.run(_up_thumb())
        except Exception:
            pass
        try:
            Path(thumb_path).unlink(missing_ok=True)
        except Exception:
            pass

    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                INSERT INTO clips
                  (id, tenant_id, video_id, title, start_sec, end_sec,
                   start_ms, end_ms, duration_ms, platform, score, status,
                   storage_url, thumbnail_url, caption_srt, metadata, created_at, updated_at)
                VALUES
                  (:id, CAST(:tid AS uuid), CAST(:vid AS uuid), :title, :ss, :es,
                   :sms, :ems, :dur, :plat, :score, 'pending_upload',
                   NULL, :thumb, :srt, CAST(:meta AS jsonb), NOW(), NOW())
            """),
            {
                "id": clip_id, "tid": tenant_id, "vid": video_id,
                "title": ai_title,
                "ss": clip.start, "es": clip.end,
                "sms": int(clip.start * 1000), "ems": int(clip.end * 1000),
                "dur": int((clip.end - clip.start) * 1000),
                "plat": clip.platform,
                "score": float(clip.score),
                "thumb": thumb_url,
                "srt": srt_content,
                "meta": json.dumps(clip_meta),
            },
        )

    # clip_path kept alive — upload_clip_to_storage task will delete it after upload
    return clip_id, clip_path


# ── YouTube download ──────────────────────────────────────────────────────────

def _ytdlp_fetch_json_worker(url: str, timeout: int = 20) -> dict:
    """Lightweight yt-dlp --dump-json call for chapter/metadata extraction. Non-fatal."""
    base = _ytdlp_base_flags(proxy=None)
    cmd = ["yt-dlp", "--no-download", "--dump-json", "--no-playlist"] + base + [
        "--extractor-args", "youtube:player_client=tv_embedded", url
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip().splitlines()[0])
    except Exception as e:
        logging.warning("_ytdlp_fetch_json_worker failed: %s", e)
    return {}


def _fetch_youtube_metadata(url: str, video_id: str | None = None) -> dict:
    """Return {title, thumbnail_url} for a YouTube URL.

    Uses YouTube oEmbed API (no auth, no rate-limit) for title + thumbnail,
    then uploads thumbnail to Cloudinary so we own the URL.
    """
    import urllib.request as _urllib_req
    import urllib.parse as _urllib_parse
    try:
        # oEmbed: lightweight, no bot-detection, returns title + thumbnail_url
        oembed_url = f"https://www.youtube.com/oembed?url={_urllib_parse.quote(url, safe='')}&format=json"
        with _urllib_req.urlopen(oembed_url, timeout=10) as resp:
            info = json.loads(resp.read())

        title = (info.get("title") or "")[:255]
        raw_thumb = info.get("thumbnail_url") or ""

        # oEmbed gives sddefault; swap to maxresdefault for better quality
        if raw_thumb and "/hqdefault" in raw_thumb:
            raw_thumb = raw_thumb.replace("/hqdefault", "/sddefault")

        thumbnail_url = raw_thumb  # fallback: store YT URL as-is

        if raw_thumb and video_id:
            try:
                thumb_data = _urllib_req.urlopen(raw_thumb, timeout=15).read()
                storage_key = f"thumbnails/{video_id}/thumb.jpg"
                provider = os.getenv("STORAGE_PROVIDER", "local")
                if provider == "cloudinary":
                    import cloudinary as _cld, cloudinary.uploader as _cld_up, os as _os2
                    _cld.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))
                    pub_id = _os2.path.splitext(storage_key)[0]
                    result = _cld_up.upload(thumb_data, public_id=pub_id, resource_type="image", overwrite=True)
                    thumbnail_url = result["secure_url"]
                else:
                    from shared.storage.base import get_storage
                    storage = get_storage(provider)
                    thumbnail_url = asyncio.run(storage.upload(thumb_data, storage_key, "image/jpeg"))
            except Exception as e:
                logging.warning("thumbnail upload failed, using raw URL: %s", e)

        return {"title": title, "thumbnail_url": thumbnail_url}
    except Exception as e:
        logging.warning("_fetch_youtube_metadata failed: %s", e)
        return {"title": "", "thumbnail_url": ""}


def _get_youtube_info(url: str) -> dict:
    """Return {duration, is_live, live_status} via yt-dlp --dump-json (no download).
    Returns empty dict on failure so callers can decide whether to block or proceed."""
    try:
        # Strip playlist params — yt-dlp hangs enumerating playlists
        from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
        parsed = urlparse(url)
        qs = {k: v for k, v in parse_qs(parsed.query).items() if k not in ("list", "index", "start_radio")}
        url = urlunparse(parsed._replace(query=urlencode({k: v[0] for k, v in qs.items()})))
        base = _ytdlp_base_flags(None)
        result = subprocess.run(
            ["yt-dlp"] + base + ["--dump-json", "--no-download", "--no-playlist", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            info = json.loads(result.stdout.splitlines()[0])
            return {
                "duration": float(info.get("duration") or 0) or None,
                "is_live": bool(info.get("is_live")),
                "live_status": info.get("live_status") or "",
            }
    except Exception as e:
        logging.warning("_get_youtube_info failed: %s", e)
    return {}


def _get_youtube_duration(url: str) -> float | None:
    return _get_youtube_info(url).get("duration")


def _ytdlp_proxies() -> list[str]:
    """Read proxies from YTDLP_PROXY_LIST env var only. No fetching, no TCP tests."""
    env_raw = os.getenv("YTDLP_PROXY_LIST", "")
    proxies = [
        p.strip() if p.strip().startswith(("socks", "http")) else f"socks5://{p.strip()}"
        for p in env_raw.split(",") if p.strip()
    ]
    if proxies:
        logging.info("Proxy pool: %d proxies from YTDLP_PROXY_LIST", len(proxies))
    else:
        logging.warning("YTDLP_PROXY_LIST not set — no proxies available")
    return proxies


def _ytdlp_proxies_with_refresh() -> list[str]:
    return _ytdlp_proxies()


def _ytdlp_base_flags(proxy: str | None = None, use_cookies: bool = False) -> list[str]:
    """Return common yt-dlp flags. Cookies disabled — proxies handle auth."""
    if proxy:
        flags = ["--no-check-certificate", "--retries", "1",
                 "--socket-timeout", "15",
                 "--js-runtimes", "node:/usr/bin/node",
                 "--proxy", proxy]
    else:
        flags = ["--no-check-certificate", "--retries", "2",
                 "--socket-timeout", "20",
                 "--js-runtimes", "node:/usr/bin/node"]
    return flags


def _is_429(stderr: str) -> bool:
    return "429" in stderr or "Too Many Requests" in stderr

def _is_bot_blocked(stderr: str) -> bool:
    return "Sign in to confirm" in stderr or "bot" in stderr.lower() or "not a bot" in stderr

def _is_bad_cookies(stderr: str) -> bool:
    s = stderr.lower()
    return (
        "invalid" in s and "cookie" in s
        or "cookiefile" in s
        or "no such file" in s and "cookie" in s
        or "http error 400" in s
        or "please sign in" in s
    )


def _download_youtube(url: str, out_path: str, quality: str = "source", progress_cb=None, tenant_id: str | None = None) -> None:
    import time, random
    errors = []
    proxies = _ytdlp_proxies_with_refresh()

    def _pick_proxy(attempt: int) -> str | None:
        if not proxies:
            return None
        return proxies[attempt % len(proxies)]

    if quality == "source":
        # bestvideo+bestaudio (any codec — VP9/AV1 carry 4K on YouTube), remux to mp4
        fmt = "bestvideo+bestaudio/best"
        fmt_fallback = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    else:
        cap = {"1080p": 1080, "720p": 720, "480p": 480}.get(quality, 1080)
        fmt = f"bestvideo[height<={cap}]+bestaudio/best[height<={cap}]"
        fmt_fallback = f"bestvideo[height<={cap}][ext=mp4]+bestaudio[ext=m4a]/best[height<={cap}][ext=mp4]/best"

    def _client_args(proxy: str | None) -> list[list[str]]:
        """Return ordered strategy list — best quality first, fallbacks after."""
        base = _ytdlp_base_flags(proxy)
        base_no_cookies = _ytdlp_base_flags(proxy, use_cookies=False)
        return [
            # android_vr (Oculus Quest): no PO token, no cookies needed — primary
            ["yt-dlp"] + base_no_cookies + ["--extractor-args", "youtube:player_client=android_vr",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # tv_embedded: no JS required, bypasses bot detection
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=tv_embedded",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # ios: no JS required, different quota bucket
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=ios",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # android_testsuite: bypasses bot detection, unlocks 4K AV1/VP9 streams
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=android_testsuite",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # Default client with best format
            ["yt-dlp"] + base + ["-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # android client — different quota bucket
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=android",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # mp4-only fallback (H.264 only — caps at 1080p on most videos)
            ["yt-dlp"] + base + ["-f", fmt_fallback, "--merge-output-format", "mp4", "-o", out_path, url],
            # Last resort: mweb client
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=mweb",
                                  "-f", "best", "--merge-output-format", "mp4", "-o", out_path, url],
        ]

    import threading

    def _run_strategy(cmd: list[str], label: str, attempt: int) -> tuple[bool, str]:
        """Run one yt-dlp command. Returns (success, stderr)."""
        state = {"last_pct": 0}
        try:
            proc = subprocess.Popen(
                cmd + ["--newline"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True,
            )
            stderr_lines: list[str] = []

            def _drain_stdout():
                for _ in proc.stdout:
                    pass

            def _drain_stderr():
                for line in proc.stderr:
                    line = line.rstrip()
                    stderr_lines.append(line)
                    if progress_cb and "[download]" in line:
                        import re as _re
                        m = _re.search(r'(\d+\.?\d*)%', line)
                        if m:
                            pct = min(int(float(m.group(1))), 99)
                            if pct > state["last_pct"]:
                                state["last_pct"] = pct
                                progress_cb(pct)

            t_out = threading.Thread(target=_drain_stdout, daemon=True)
            t_err = threading.Thread(target=_drain_stderr, daemon=True)
            t_out.start(); t_err.start()
            t_out.join(timeout=310); t_err.join(timeout=310)
            proc.wait(timeout=300)
            if proc.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
                return True, ""
            return False, "\n".join(stderr_lines[-20:])
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except Exception:
                pass
            return False, "timeout"
        except Exception as e:
            return False, str(e)

    # Phase 1: race env proxies in parallel — android_vr client, first win takes it
    if proxies:
        import concurrent.futures, threading as _threading
        race_proxies = proxies[:10]
        logging.info("Phase 1: racing %d env proxies in parallel", len(race_proxies))
        proxy_errors: list[str] = []
        proxy_errors_lock = _threading.Lock()
        move_lock = _threading.Lock()
        moved = _threading.Event()

        def _try_proxy(proxy: str, idx: int) -> bool:
            if moved.is_set():
                return False
            tmp_path = out_path + f".proxy{idx}.tmp"
            base = _ytdlp_base_flags(proxy)
            cmd = (["yt-dlp"] + base +
                   ["--extractor-args", "youtube:player_client=android_vr",
                    "-f", fmt, "--merge-output-format", "mp4", "-o", tmp_path, url])
            try:
                proc = subprocess.Popen(cmd + ["--newline"],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                stderr_lines: list[str] = []

                def _drain():
                    for line in proc.stderr:
                        stderr_lines.append(line.rstrip())
                        if moved.is_set():
                            proc.kill()
                            return

                import threading as _t
                t_stdout = _t.Thread(target=lambda: [_ for _ in proc.stdout], daemon=True)
                t_stderr = _t.Thread(target=_drain, daemon=True)
                t_stdout.start(); t_stderr.start()
                proc.wait(timeout=25)
                t_stderr.join(timeout=3)  # ensure stderr drained before reading
                if proc.returncode == 0 and Path(tmp_path).exists() and Path(tmp_path).stat().st_size > 0:
                    with move_lock:
                        if not moved.is_set():
                            import shutil as _sh
                            _sh.move(tmp_path, out_path)
                            moved.set()
                            logging.info("Proxy race won by %s", proxy)
                            return True
                stderr = "\n".join(stderr_lines[-5:])
                reason = "429" if _is_429(stderr) else ("bot" if _is_bot_blocked(stderr) else "failed")
                logging.warning("Proxy[%d] %s → %s | %s", idx, proxy, reason, stderr[:120])
                with proxy_errors_lock:
                    proxy_errors.append(f"proxy[{idx}] {proxy}: {reason}: {stderr[:150]}")
            except Exception as e:
                logging.warning("Proxy[%d] %s → exception: %s", idx, proxy, e)
                with proxy_errors_lock:
                    proxy_errors.append(f"proxy[{idx}]: {e}")
            finally:
                try:
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    pass
            return False

        # Race in batches of 10 — next batch fires immediately after all in current batch fail
        BATCH = 10
        for batch_start in range(0, len(proxies), BATCH):
            batch = proxies[batch_start:batch_start + BATCH]
            logging.info("Proxy batch %d-%d: racing %d proxies",
                         batch_start, batch_start + len(batch) - 1, len(batch))
            with concurrent.futures.ThreadPoolExecutor(max_workers=BATCH) as ex:
                futures = {ex.submit(_try_proxy, p, batch_start + i): p
                           for i, p in enumerate(batch)}
                for fut in concurrent.futures.as_completed(futures):
                    if moved.is_set():
                        return
            if moved.is_set():
                return
            logging.info("Proxy batch %d-%d all failed, trying next batch",
                         batch_start, batch_start + len(batch) - 1)

        errors.extend(proxy_errors)

    # Phase 2: direct strategies (android_vr no-cookies, then cookie-based clients)
    logging.info("Phase 2: trying direct strategies (no proxy)")
    cookie_strategies = [(cmd, "direct") for cmd in _client_args(None)]
    for attempt, (cmd, label) in enumerate(cookie_strategies):
        ok, stderr = _run_strategy(cmd, label, attempt)
        if ok:
            return
        errors.append(f"yt-dlp strategy {attempt+1} ({label}): {stderr[:200]}")
        if _is_bad_cookies(stderr):
            logging.warning("YouTube invalid/expired cookies on strategy %d (%s), skipping remaining", attempt + 1, label)
            break
        if _is_429(stderr) or _is_bot_blocked(stderr):
            logging.warning("YouTube 429/bot-block on direct strategy %d (%s)", attempt + 1, label)
            break

    # pytubefix as final fallback (different HTTP stack, avoids some rate-limits)
    try:
        from pytubefix import YouTube
        yt = YouTube(url, use_oauth=False, allow_oauth_cache=False)
        stream = (
            yt.streams.filter(progressive=True, file_extension="mp4")
            .order_by("resolution").desc().first()
        ) or yt.streams.filter(file_extension="mp4").order_by("resolution").desc().first()
        if stream:
            downloaded = stream.download(output_path=str(Path(out_path).parent), filename="source.mp4")
            if Path(downloaded).exists() and Path(downloaded).stat().st_size > 0:
                return
        errors.append("pytubefix: no suitable stream")
    except Exception as e:
        errors.append(f"pytubefix: {e}")

    # RapidAPI TikTok fallback — handles IP-blocked TikTok URLs
    rapidapi_key = os.getenv("RAPIDAPI_TIKTOK_KEY", "")
    if rapidapi_key and "tiktok" in url.lower():
        try:
            import urllib.request as _urllib_req
            import json as _json
            api_url = f"https://tiktok-video-no-watermark2.p.rapidapi.com/?url={url}&hd=1"
            req = _urllib_req.Request(api_url, headers={
                "x-rapidapi-host": "tiktok-video-no-watermark2.p.rapidapi.com",
                "x-rapidapi-key": rapidapi_key,
            })
            with _urllib_req.urlopen(req, timeout=30) as resp:
                data = _json.loads(resp.read())
            video_url = (
                data.get("data", {}).get("hdplay")
                or data.get("data", {}).get("play")
                or data.get("data", {}).get("wmplay")
            )
            if not video_url:
                raise ValueError(f"No video URL in response: {list(data.get('data', {}).keys())}")
            dl_req = _urllib_req.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
            with _urllib_req.urlopen(dl_req, timeout=120) as resp:
                with open(out_path, "wb") as f:
                    f.write(resp.read())
            if Path(out_path).stat().st_size > 0:
                return
            errors.append("RapidAPI TikTok: downloaded file is empty")
        except Exception as e:
            errors.append(f"RapidAPI TikTok: {e}")

    raise RuntimeError("YouTube download failed after all strategies.\n" + "\n".join(errors))


# ── Main pipeline ─────────────────────────────────────────────────────────────

def _fetch_youtube_captions(url: str, language: str = "en") -> list[WordTimestamp]:
    """Download YouTube auto/manual captions and convert to WordTimestamp list. Returns [] if unavailable."""
    import tempfile, re as _re
    lang_codes = [language, "en"] if language != "en" else ["en"]
    with tempfile.TemporaryDirectory() as tmp:
        out_tmpl = os.path.join(tmp, "cap.%(ext)s")
        for lang in lang_codes:
            for sub_type in ["--write-sub", "--write-auto-sub"]:
                try:
                    _cookies = []
                    _cf = os.getenv("YTDLP_COOKIES_FILE", "")
                    if _cf and Path(_cf).exists():
                        _cookies = ["--cookies", _cf]
                    result = subprocess.run(
                        ["yt-dlp", "--skip-download", sub_type,
                         "--sub-lang", lang, "--sub-format", "vtt",
                         "--no-check-certificate", "-o", out_tmpl] + _cookies + [url],
                        capture_output=True, text=True, timeout=30,
                    )
                    vtt_files = list(Path(tmp).glob("*.vtt"))
                    if not vtt_files:
                        continue
                    vtt_text = vtt_files[0].read_text(encoding="utf-8", errors="ignore")
                    words = _parse_vtt_to_words(vtt_text)
                    if words:
                        return words
                except Exception:
                    continue
    return []


def _parse_vtt_to_words(vtt: str) -> list[WordTimestamp]:
    """Parse VTT caption file into word-level timestamps (approximated per segment)."""
    import re as _re
    TIME_RE = _re.compile(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})")
    words: list[WordTimestamp] = []

    def to_sec(h, m, s, ms):
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    lines = vtt.splitlines()
    i = 0
    while i < len(lines):
        m = TIME_RE.match(lines[i].strip())
        if m:
            start = to_sec(*m.groups()[:4])
            end = to_sec(*m.groups()[4:])
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                # Strip VTT inline tags like <00:00:00.000><c>word</c>
                clean = _re.sub(r"<[^>]+>", "", lines[i])
                text_lines.append(clean.strip())
                i += 1
            text = " ".join(text_lines).strip()
            if not text:
                i += 1
                continue
            seg_words = text.split()
            if seg_words:
                dur = max(end - start, 0.1)
                step = dur / len(seg_words)
                for j, w in enumerate(seg_words):
                    ws = start + j * step
                    we = ws + step
                    words.append(WordTimestamp(word=w, start=round(ws, 3), end=round(we, 3)))
        else:
            i += 1
    return words


def _auto_schedule_clips(tenant_id: str, clip_ids: list, ap_cfg: dict) -> None:
    """Create ScheduledPost records for auto-publish after a WebSub-triggered pipeline."""
    from datetime import datetime, timezone, timedelta
    import uuid as _uuid

    platforms = ap_cfg.get("platforms", [])
    social_account_ids = ap_cfg.get("social_account_ids", [])
    publish_per_day = max(1, int(ap_cfg.get("publish_per_day", 3)))
    interval_hours = max(1, int(ap_cfg.get("publish_interval_hours", 8)))
    caption_template = ap_cfg.get("caption_template", "")

    if not platforms and not social_account_ids:
        logging.info("_auto_schedule_clips: no platforms/accounts configured, skipping")
        return

    with Session(engine) as db:
        # Resolve social_account_ids — fetch matching accounts for this tenant
        if social_account_ids:
            id_list = ",".join(f"'{sid}'" for sid in social_account_ids if sid)
            rows = db.execute(
                text(f"SELECT id, platform FROM social_accounts WHERE tenant_id = :tid AND is_active = true AND id IN ({id_list})"),
                {"tid": tenant_id},
            ).fetchall()
        elif platforms:
            placeholders = ",".join(f"'{p}'" for p in platforms)
            rows = db.execute(
                text(f"SELECT id, platform FROM social_accounts WHERE tenant_id = :tid AND is_active = true AND platform IN ({placeholders})"),
                {"tid": tenant_id},
            ).fetchall()
        else:
            rows = []

        if not rows:
            logging.info("_auto_schedule_clips: no active social accounts found for tenant %s", tenant_id)
            return

        now = datetime.now(timezone.utc)
        posts_created = 0
        slot = 0  # tracks scheduling slot across clip × account combos

        for clip_id in clip_ids[:publish_per_day]:
            for account_id, platform in rows:
                scheduled_at = now + timedelta(hours=slot * interval_hours)
                db.execute(
                    text("""
                        INSERT INTO scheduled_posts
                            (id, tenant_id, clip_id, social_account_id, platform,
                             status, scheduled_at, caption, created_at, updated_at)
                        VALUES
                            (:id, :tid, :clip_id, :acct_id, :platform,
                             'scheduled', :scheduled_at, :caption, now(), now())
                    """),
                    {
                        "id": _uuid.uuid4(),
                        "tid": tenant_id,
                        "clip_id": clip_id,
                        "acct_id": account_id,
                        "platform": platform,
                        "scheduled_at": scheduled_at,
                        "caption": caption_template or None,
                    },
                )
                posts_created += 1
                slot += 1

        db.commit()

    logging.info("_auto_schedule_clips: created %d scheduled posts for tenant %s", posts_created, tenant_id)


def run_video_pipeline(tenant_id: str, video_id: str, source_path: str, job_id: str, cfg: dict | None = None, yt_url: str | None = None, yt_meta: dict | None = None) -> None:
    cfg = cfg or {}
    work_dir = Path(VIDEO_TEMP_DIR) / video_id
    work_dir.mkdir(parents=True, exist_ok=True)

    language = cfg.get("language", "en")
    num_clips = cfg.get("max_clips", 10)
    min_dur = cfg.get("duration_min", 15)
    max_dur = cfg.get("duration_max", 60)
    platforms = cfg.get("platforms", ["tiktok", "reels", "shorts"])
    topic_focus = cfg.get("topic_focus", "")
    # min_score is 0-1 in our config; ClipForge uses 0-10 scale
    min_score_01 = float(cfg.get("min_score", 0.5))
    min_score_10 = min_score_01 * 10  # e.g. 0.5 → 5.0; default keeps 7.5 floor in AI prompt
    vid_meta: dict = {}  # populated after transcription
    yt_chapters: list[dict] = []  # populated from yt-dlp metadata if YouTube
    precision_mode = cfg.get("precision_mode", False)
    _yt_meta = yt_meta or {}
    yt_engagement = {
        "title": _yt_meta.get("title", ""),
        "views": int(_yt_meta.get("view_count", 0) or 0),
        "likes": int(_yt_meta.get("like_count", 0) or 0),
        "comments": int(_yt_meta.get("comment_count", 0) or 0),
        "description": ((_yt_meta.get("description") or "")[:500]),
    } if precision_mode else None

    output_quality = cfg.get("output_quality", "source")
    if output_quality == "source":
        _publish_progress(job_id, "metadata", 5, "processing",
                          "Full resolution selected — export will take longer than usual.")

    # Dedup: skip re-processing if this source was already successfully processed within 24h
    import hashlib as _hashlib
    _url_key = f"pipeline:done:{tenant_id}:{_hashlib.md5((source_path or video_id).encode()).hexdigest()}"
    _cached = redis_client.get(_url_key)
    if _cached:
        logging.info("run_video_pipeline: cache hit for %s — skipping re-process", video_id)
        return json.loads(_cached)

    # Step 1: Probe (10%)
    _publish_progress(job_id, "metadata", 10, "processing", "Probing video...")
    meta = _probe_video(source_path)
    _update_video(tenant_id, video_id,
                  duration_sec=int(meta.duration),
                  resolution=f"{meta.width}x{meta.height}",
                  pipeline_step="metadata", pipeline_pct=10)
    _save_step_artifact(tenant_id, video_id, "metadata", {
        "duration": meta.duration, "resolution": f"{meta.width}x{meta.height}",
        "fps": meta.fps, "codec": meta.codec,
    })

    words: list[WordTimestamp] = []

    if _check_cancelled(tenant_id, video_id):
        return

    if meta.has_audio:
        # Step 2: Transcribe — use YouTube captions if available, else Groq Whisper
        _update_video(tenant_id, video_id, pipeline_step="transcribe", pipeline_pct=20)

        if yt_url:
            _publish_progress(job_id, "transcribe", 20, "processing",
                              "Checking YouTube for existing captions...")
            # Fetch chapters from yt-dlp metadata for signal augmentation
            try:
                _yt_info = _ytdlp_fetch_json_worker(yt_url)
                yt_chapters = _yt_info.get("chapters") or []
                logging.info("Fetched %d YouTube chapters for signal augmentation", len(yt_chapters))
                if precision_mode and yt_engagement is None:
                    yt_engagement = {
                        "title": _yt_info.get("title", "") or (_yt_meta.get("title", "") if _yt_meta else ""),
                        "views": int(_yt_info.get("view_count", 0) or 0),
                        "likes": int(_yt_info.get("like_count", 0) or 0),
                        "comments": int(_yt_info.get("comment_count", 0) or 0),
                        "description": ((_yt_info.get("description") or "")[:500]),
                    }
            except Exception:
                yt_chapters = []
            words = _fetch_youtube_captions(yt_url, language)
            if words:
                _publish_progress(job_id, "transcribe", 35, "processing",
                                  f"Using YouTube captions ({len(words)} words) — skipping AI transcription")
            else:
                _publish_progress(job_id, "transcribe", 20, "processing",
                                  "No YouTube captions found — transcribing with Groq Whisper...")
                words = _transcribe(source_path, meta.duration, language)
                _publish_progress(job_id, "transcribe", 35, "processing",
                                  f"Transcribed {len(words)} words via Whisper")
        else:
            _publish_progress(job_id, "transcribe", 20, "processing",
                              "Extracting audio + transcribing with Groq Whisper...")
            words = _transcribe(source_path, meta.duration, language)
            _publish_progress(job_id, "transcribe", 35, "processing",
                              f"Transcribed {len(words)} words")

        if words:
            _save_transcript(tenant_id, video_id, words)
        _update_video(tenant_id, video_id, pipeline_step="transcribe", pipeline_pct=35)
        _save_step_artifact(tenant_id, video_id, "transcript",
                            {"word_count": len(words), "language": language,
                             "source": "youtube_captions" if yt_url and words else "whisper"})

        # Generate AI metadata from full transcript
        if words:
            _publish_progress(job_id, "transcribe", 37, "processing", "Generating video metadata from transcript...")
            vid_meta = _ai_generate_video_metadata(words, meta.duration, topic_focus) or {}
            if vid_meta:
                _update_video(tenant_id, video_id, metadata=json.dumps(vid_meta))
                _save_step_artifact(tenant_id, video_id, "video_metadata", vid_meta)

    if _check_cancelled(tenant_id, video_id):
        return

    # Step 3: AI clip selection (50%)
    _publish_progress(job_id, "scoring", 40, "processing", "Step 1: AI analyzing transcript for viral signals...")
    _update_video(tenant_id, video_id, pipeline_step="scoring", pipeline_pct=40)

    # Extract content_type, occasion, and key_moments from metadata for richer scoring
    _content_type = "other"
    _occasion = ""
    _viral_type = ""
    _key_moments: list[dict] = []
    if vid_meta:
        _content_type = vid_meta.get("content_type", "other") or "other"
        _occasion = vid_meta.get("occasion", "") or ""
        _viral_type = vid_meta.get("viral_type", "") or ""
        _key_moments = vid_meta.get("key_moments", []) or []
    # User-supplied occasion hint overrides AI detection
    _user_occasion = cfg.get("occasion") or ""
    if _user_occasion:
        _occasion = _user_occasion

    clips = _ai_score_clips(
        words, meta.duration, num_clips, min_dur, max_dur,
        min_score_10=min_score_10,
        topic_focus=topic_focus,
        platforms=platforms,
        content_type=_content_type,
        key_moments=_key_moments,
        source_path=source_path,
        chapters=yt_chapters,
        precision_mode=precision_mode,
        yt_engagement=yt_engagement,
        occasion=_occasion,
    )

    # Fill remaining slots with heuristic clips if AI returned fewer than requested
    if len(clips) < num_clips:
        ai_count = len(clips)
        fallback = _heuristic_clips(words, meta.duration, num_clips, min_dur, max_dur, platforms)
        # Add non-overlapping heuristic clips to fill up to num_clips
        for fc in fallback:
            if len(clips) >= num_clips:
                break
            if not any(fc.start < ec.end and fc.end > ec.start for ec in clips):
                fc.title = f"Clip {len(clips)+1}"
                clips.append(fc)
        if ai_count == 0:
            _publish_progress(job_id, "scoring", 50, "processing",
                              f"AI found no clips — using {len(clips)} heuristic clips")
        else:
            _publish_progress(job_id, "scoring", 50, "processing",
                              f"AI found {ai_count} clips, filled to {len(clips)} with heuristics")

    if not clips:
        clips = [ClipResult(
            start=0.0, end=min(float(max_dur), meta.duration),
            score=0.5, title="Clip 1", reason="fallback",
            platform=platforms[0],
        )]

    _update_video(tenant_id, video_id, pipeline_step="scoring", pipeline_pct=55)
    _publish_progress(job_id, "scoring", 55, "processing",
                      f"Selected {len(clips)} clips (aspect={cfg.get('aspect_ratio','9:16')})")

    # Step 4: Captions (60%)
    _publish_progress(job_id, "captions", 60, "processing", "Generating captions...")
    style = cfg.get("caption_style", "capcut")
    words_per_line = 3 if style in CAPCUT_STYLES else 6
    all_captions: dict[int, list[CaptionSegment]] = {}
    for idx, clip in enumerate(clips):
        segs = _generate_captions(words, clip, max_words=words_per_line)
        all_captions[idx] = segs

    if _check_cancelled(tenant_id, video_id):
        return

    # Generate AI content for all clips in parallel before export
    _publish_progress(job_id, "ai_content", 58, "processing", f"Generating AI content for {len(clips)} clips...")
    all_ai_content = _batch_ai_content(clips, words, all_captions, platforms,
                                       content_type=_content_type, topic_focus=topic_focus)

    # Step 5: Export clips in parallel (60→95%)
    if output_quality == "source":
        _publish_progress(job_id, "export", 60, "processing",
                          f"Exporting {len(clips)} clips at full source resolution — this may take a while...")
    else:
        _publish_progress(job_id, "export", 60, "processing", f"Exporting {len(clips)} clips in parallel...")

    clip_ids: list[str] = []
    cancelled = False

    def _export_one(args: tuple[int, ClipResult]) -> tuple[str, str] | None:
        i, clip = args
        if _check_cancelled(tenant_id, video_id):
            return None
        pct = 60 + int((i / max(len(clips), 1)) * 35)
        _publish_progress(job_id, "export", pct, "processing",
                          f"Rendering clip {i+1}/{len(clips)}: {clip.title}")
        _update_video(tenant_id, video_id, pipeline_step="export", pipeline_pct=pct)
        captions = all_captions.get(i, [])
        ai_content = all_ai_content.get(i, {})
        return _export_clip(
            tenant_id=tenant_id, video_id=video_id,
            clip=clip, captions=captions,
            source_path=source_path, work_dir=work_dir,
            meta=meta, cfg=cfg, words=words,
            ai_content=ai_content,
            occasion=_occasion,
            viral_type=_viral_type,
            job_id=job_id,
            clip_index=i,
            clip_total=len(clips),
        )

    # Hard-cap clip durations before export — cfg max_dur can be large; absolute ceiling is 120s
    _export_cap = min(max_dur, 120)
    for clip in clips:
        if clip.end - clip.start > _export_cap:
            clip.end = clip.start + _export_cap

    max_workers = min(len(clips), 3)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(_export_one, (i, clip)): (i, clip) for i, clip in enumerate(clips)}
        for future in as_completed(future_map):
            i, clip = future_map[future]
            if _check_cancelled(tenant_id, video_id):
                _publish_progress(job_id, "cancelled", 0, "cancelled", "Job cancelled by user.")
                cancelled = True
                executor.shutdown(wait=False, cancel_futures=True)
                break
            try:
                result = future.result()
                if result:
                    clip_id, clip_path = result
                    clip_ids.append(clip_id)
                    # Queue async cloud upload — returns immediately
                    upload_clip_to_storage.delay(clip_id, clip_path, tenant_id, job_id)
            except Exception as e:
                logging.exception("Clip %d export failed: %s", i + 1, e)
                _publish_progress(job_id, "export", 60, "processing",
                                  f"Clip {i+1} failed: {str(e)[:120]}, continuing...")

    if cancelled:
        return

    # Video is ready for viewing — uploads happen in background per clip
    _update_video(tenant_id, video_id, status="ready", pipeline_step="complete", pipeline_pct=100)
    _publish_progress(job_id, "complete", 100, "complete",
                      f"Done! {len(clip_ids)} clips generated, uploading to cloud...")
    vid_title = _get_video_title_from_db(tenant_id, video_id)
    clip_word = "clip" if len(clip_ids) == 1 else "clips"
    _notify_video(
        tenant_id, video_id, "video_ready",
        "Your video is ready",
        f"{len(clip_ids)} {clip_word} generated{f' from {vid_title!r}' if vid_title else ''}.",
    )

    # Notify frontend that all clips are ready to display (with thumbnails + pending_upload status)
    _publish_clip_event(job_id, "clips_ready", {
        "video_id": video_id,
        "clip_ids": clip_ids,
        "count": len(clip_ids),
    })

    # Cache successful result to prevent re-processing same source within 24h
    redis_client.setex(_url_key, 86400, json.dumps(clip_ids))

    # Auto-schedule clips if enabled via channel subscription config
    if cfg.get("auto_publish") and cfg.get("auto_publish_config") and clip_ids:
        try:
            _auto_schedule_clips(tenant_id, clip_ids, cfg["auto_publish_config"])
        except Exception:
            logging.exception("Auto-schedule clips failed for video %s", video_id)

    # Work dir cleaned up per-clip by upload_clip_to_storage; remove dir after all queued
    # (uploads may still be running — only rmtree the work_dir skeleton, not clip files)
    try:
        for f in work_dir.iterdir():
            if f.name == "source.mp4" or f.suffix in (".log",):
                f.unlink(missing_ok=True)
    except Exception:
        pass


# ── Celery tasks ──────────────────────────────────────────────────────────────

def _segments_to_words(segments: list[dict]) -> list[WordTimestamp]:
    """Reconstruct word-level timestamps from transcript segments."""
    words: list[WordTimestamp] = []
    for seg in segments:
        seg_words = seg.get("text", "").split()
        if not seg_words:
            continue
        seg_start = float(seg.get("start", 0))
        seg_end   = float(seg.get("end", seg_start + len(seg_words) * 0.4))
        step = (seg_end - seg_start) / max(len(seg_words), 1)
        for i, w in enumerate(seg_words):
            words.append(WordTimestamp(
                word=w,
                start=round(seg_start + i * step, 3),
                end=round(seg_start + (i + 1) * step, 3),
            ))
    return words


@celery_app.task(bind=True, name="workers.tasks.video.generate_viral_clips",
                 queue="viralo.video.ai", acks_late=True, max_retries=2,
                 time_limit=1260, soft_time_limit=1200)
def generate_viral_clips(self, tenant_id: str, video_id: str, cfg: dict | None = None):
    """
    Transcript → viral clip scoring → per-clip social content. No video rendering.

    Flow:
      1. Load transcript from DB if exists (YouTube SRT or prior Whisper run).
      2. If no transcript: locate source file via original_storage_key → Groq Whisper.
      3. AI clip scoring (Groq LLaMA two-step viral analysis).
      4. Generate SRT captions per clip.
      5. Generate title + description + tags for each target platform.
      6. Persist Clip rows with status='scored' and full social metadata.
    """
    from celery.exceptions import SoftTimeLimitExceeded
    cfg = cfg or {}
    job_id = self.request.id or video_id
    try:
        return _gvc_inner(self, tenant_id, video_id, job_id, cfg)
    except SoftTimeLimitExceeded:
        _handle_timeout(tenant_id, video_id, job_id)
        raise

def _gvc_inner(self, tenant_id, video_id, job_id, cfg):
    num_clips   = int(cfg.get("max_clips", 5))
    min_dur     = int(cfg.get("duration_min", 15))
    max_dur     = int(cfg.get("duration_max", 60))
    min_score   = float(cfg.get("min_score", 0.5))
    topic_focus = cfg.get("topic_focus") or ""
    platforms   = cfg.get("platforms") or ["tiktok", "reels", "shorts"]
    language    = cfg.get("language", "en")
    style       = cfg.get("caption_style", "capcut")
    precision_mode_gvc = cfg.get("precision_mode", False)
    yt_engagement_gvc: dict | None = None

    _update_video(tenant_id, video_id, status="processing",
                  celery_task_id=job_id, pipeline_step="transcribe", pipeline_pct=5)
    _publish_progress(job_id, "transcribe", 5, "processing", "Checking for existing transcript...")

    # ── Step 1: Load or generate transcript ───────────────────────────────────
    words: list[WordTimestamp] = []
    transcript_source = "none"
    yt_chapters: list[dict] = []
    source_path: str | None = None

    with _get_session(tenant_id) as session:
        tr_row = session.execute(
            text("SELECT segments FROM transcripts WHERE video_id = CAST(:vid AS uuid)"),
            {"vid": video_id},
        ).fetchone()
        vid_row = session.execute(
            text("SELECT duration_sec, topic, source_url, original_storage_key, source_type, metadata FROM videos WHERE id = CAST(:vid AS uuid)"),
            {"vid": video_id},
        ).fetchone()

    if tr_row and tr_row.segments:
        segments = tr_row.segments if isinstance(tr_row.segments, list) else json.loads(tr_row.segments)
        words = _segments_to_words(segments)
        transcript_source = "db"
        _publish_progress(job_id, "transcribe", 20, "processing",
                          f"Loaded existing transcript ({len(words)} words)")
    else:
        # No transcript — try to generate one
        source_path: str | None = None
        yt_url = vid_row.source_url if vid_row and vid_row.source_type == "youtube_url" else None

        # Try YouTube captions first for YT videos
        if yt_url:
            _publish_progress(job_id, "transcribe", 10, "processing",
                              "Fetching YouTube captions...")
            try:
                _yt_info = _ytdlp_fetch_json_worker(yt_url)
                yt_chapters = _yt_info.get("chapters") or []
                if precision_mode_gvc:
                    yt_engagement_gvc = {
                        "title": _yt_info.get("title", ""),
                        "views": int(_yt_info.get("view_count", 0) or 0),
                        "likes": int(_yt_info.get("like_count", 0) or 0),
                        "comments": int(_yt_info.get("comment_count", 0) or 0),
                        "description": ((_yt_info.get("description") or "")[:500]),
                    }
            except Exception:
                yt_chapters = []
            words = _fetch_youtube_captions(yt_url, language)
            if words:
                transcript_source = "youtube_captions"
                _publish_progress(job_id, "transcribe", 20, "processing",
                                  f"Using YouTube captions ({len(words)} words)")

        if not words:
            # Locate source file from storage
            storage_key = vid_row.original_storage_key if vid_row else None
            if not storage_key:
                _update_video(tenant_id, video_id, status="failed",
                              pipeline_step="failed",
                              error_message="No transcript and no source file available.")
                _publish_progress(job_id, "failed", 0, "failed",
                                  "No transcript found and no source file available. Run full pipeline first.")
                return []

            _publish_progress(job_id, "transcribe", 10, "processing",
                              "Downloading source file for transcription...")
            work_dir = Path(VIDEO_TEMP_DIR) / video_id
            work_dir.mkdir(parents=True, exist_ok=True)
            source_path = str(work_dir / "source.mp4")

            try:
                provider = os.getenv("STORAGE_PROVIDER", "local")
                if provider == "local":
                    local_dir = os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage")
                    src = Path(local_dir) / storage_key.lstrip("/storage/").lstrip("storage/")
                    import shutil as _shutil
                    _shutil.copy2(str(src), source_path)
                else:
                    from shared.storage.base import get_storage
                    import asyncio as _asyncio
                    storage = get_storage(provider)
                    _asyncio.run(storage.download(storage_key, source_path))
            except Exception as exc:
                _update_video(tenant_id, video_id, status="failed",
                              pipeline_step="failed", error_message=str(exc)[:500])
                _publish_progress(job_id, "failed", 0, "failed", f"Failed to download source: {exc}")
                return []

            _publish_progress(job_id, "transcribe", 15, "processing",
                              "Transcribing with Groq Whisper...")
            meta = _probe_video(source_path)
            words = _transcribe(source_path, meta.duration, language)
            transcript_source = "whisper"
            _publish_progress(job_id, "transcribe", 30, "processing",
                              f"Transcribed {len(words)} words via Whisper")

        if words:
            _save_transcript(tenant_id, video_id, words)

    if not words:
        _update_video(tenant_id, video_id, status="failed",
                      pipeline_step="failed", error_message="Could not obtain transcript.")
        _publish_progress(job_id, "failed", 0, "failed", "No transcript available.")
        return []

    # Resolve duration and topic from video row
    duration = words[-1].end if words else 0.0
    if vid_row:
        if vid_row.duration_sec and float(vid_row.duration_sec) > duration:
            duration = float(vid_row.duration_sec)
        if not topic_focus and vid_row.topic:
            topic_focus = vid_row.topic

    # ── Step 2: AI viral clip scoring ─────────────────────────────────────────
    _update_video(tenant_id, video_id, pipeline_step="scoring", pipeline_pct=35)
    _publish_progress(job_id, "scoring", 35, "processing",
                      "Analyzing transcript for viral signals...")

    min_score_10 = min_score * 10
    _gvc_content_type = "other"
    if vid_row and vid_row.metadata:
        try:
            _meta = vid_row.metadata if isinstance(vid_row.metadata, dict) else json.loads(vid_row.metadata)
            _gvc_content_type = _meta.get("content_type", "other") or "other"
        except Exception:
            pass
    clips = _ai_score_clips(
        words=words,
        duration=duration,
        num_clips=num_clips,
        min_dur=min_dur,
        max_dur=max_dur,
        min_score_10=min_score_10,
        topic_focus=topic_focus,
        platforms=platforms,
        source_path=source_path or "",
        chapters=yt_chapters,
        precision_mode=precision_mode_gvc,
        yt_engagement=yt_engagement_gvc,
        content_type=_gvc_content_type,
    )

    # Heuristic fill if AI returned fewer than requested
    if len(clips) < num_clips:
        fallback = _heuristic_clips(words, duration, num_clips, min_dur, max_dur, platforms)
        for fc in fallback:
            if len(clips) >= num_clips:
                break
            if not any(fc.start < ec.end and fc.end > ec.start for ec in clips):
                fc.title = f"Clip {len(clips) + 1}"
                clips.append(fc)

    if not clips:
        clips = [ClipResult(
            start=0.0, end=min(float(max_dur), duration),
            score=0.5, title="Clip 1", reason="fallback",
            platform=platforms[0],
        )]

    _publish_progress(job_id, "scoring", 60, "processing",
                      f"Found {len(clips)} viral clips (source={transcript_source})")

    # ── Step 3: Captions per clip ──────────────────────────────────────────────
    words_per_line = 3 if style in CAPCUT_STYLES else 6
    all_captions: dict[int, list[CaptionSegment]] = {}
    for idx, clip in enumerate(clips):
        all_captions[idx] = _generate_captions(words, clip, max_words=words_per_line)

    # ── Step 4: AI social content per clip (parallel) ─────────────────────────
    _publish_progress(job_id, "ai_content", 65, "processing",
                      f"Generating social content for {len(clips)} clips across {len(platforms)} platforms...")
    all_ai_content = _batch_ai_content(clips, words, all_captions, platforms,
                                       content_type="other", topic_focus=topic_focus)

    # ── Step 5: Persist clips ─────────────────────────────────────────────────
    _publish_progress(job_id, "saving", 90, "processing", f"Saving {len(clips)} clips...")

    clip_ids: list[str] = []
    with _get_session(tenant_id) as session:
        for idx, clip in enumerate(clips):
            cid = str(uuid.uuid4())
            captions = all_captions.get(idx, [])
            srt_content = _generate_srt(captions)
            ai_content = all_ai_content.get(idx, {})

            # Title from AI content if available, else clip default
            title = (ai_content.get("title") or clip.title or f"Clip {idx + 1}")[:100]

            clip_meta = {
                "reason": clip.reason,
                "transcript_source": transcript_source,
                "social": ai_content.get("platforms", {}),
                "signals": {
                    "audio_energy": getattr(clip, "audio_energy", None),
                    "speech_rate": getattr(clip, "speech_rate", None),
                    "chapter_match": getattr(clip, "chapter_match", False),
                },
            }
            if ai_content.get("all_hashtags"):
                clip_meta["trending_hashtags"] = ai_content["all_hashtags"]

            session.execute(
                text("""
                    INSERT INTO clips
                      (id, tenant_id, video_id, title, start_sec, end_sec,
                       start_ms, end_ms, duration_ms, platform, score, status,
                       caption_srt, metadata, created_at, updated_at)
                    VALUES
                      (:id, CAST(:tid AS uuid), CAST(:vid AS uuid), :title,
                       :ss, :es, :sms, :ems, :dur, :plat, :score, 'scored',
                       :srt, CAST(:meta AS jsonb), NOW(), NOW())
                """),
                {
                    "id": cid, "tid": tenant_id, "vid": video_id,
                    "title": title,
                    "ss": clip.start, "es": clip.end,
                    "sms": int(clip.start * 1000), "ems": int(clip.end * 1000),
                    "dur": int((clip.end - clip.start) * 1000),
                    "plat": clip.platform,
                    "score": float(clip.score),
                    "srt": srt_content or None,
                    "meta": json.dumps(clip_meta),
                },
            )
            clip_ids.append(cid)

    _update_video(tenant_id, video_id, status="complete",
                  pipeline_step="complete", pipeline_pct=100)
    _publish_progress(job_id, "complete", 100, "complete",
                      f"Generated {len(clips)} viral clips with social content")
    return clip_ids


def _handle_timeout(tenant_id: str, video_id: str, job_id: str) -> None:
    """Called from SoftTimeLimitExceeded handlers — mark failed, free memory."""
    import gc
    msg = "Processing timed out after 20 minutes — video may be too long or complex."
    try:
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
    except Exception:
        pass
    gc.collect()


@celery_app.task(bind=True, name="workers.tasks.video.upload_clip_to_storage",
                 queue="viralo.video.upload", acks_late=True, max_retries=3,
                 default_retry_delay=30, time_limit=300, soft_time_limit=270)
def upload_clip_to_storage(self, clip_id: str, clip_path: str, tenant_id: str, job_id: str) -> None:
    """Upload a rendered clip mp4 to cloud storage and update clip record to ready."""
    attempt = (self.request.retries or 0) + 1
    try:
        with _get_session(tenant_id) as session:
            session.execute(
                text("""
                    UPDATE clips
                       SET status = 'uploading',
                           upload_attempts = COALESCE(upload_attempts, 0) + 1,
                           updated_at = NOW()
                     WHERE id = CAST(:cid AS uuid)
                """),
                {"cid": clip_id},
            )

        storage_key = f"clips/{tenant_id}/{clip_id}.mp4"

        # If tmp file is gone (worker restart) — re-export from source
        if not Path(clip_path).exists():
            logging.warning("upload_clip_to_storage: tmp file missing for clip %s, attempting re-export", clip_id)
            _reexport_clip_from_source(clip_id, tenant_id, clip_path)

        from shared.storage.base import get_storage

        async def _do_upload() -> str:
            _storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
            with open(clip_path, "rb") as f:
                return await _storage.upload(f, storage_key, "video/mp4")

        storage_url = asyncio.run(_do_upload())

        with _get_session(tenant_id) as session:
            row = session.execute(
                text("SELECT thumbnail_url, video_id::text FROM clips WHERE id = CAST(:cid AS uuid)"),
                {"cid": clip_id},
            ).fetchone()
            thumbnail_url = row[0] if row else None
            video_id = row[1] if row else None

            session.execute(
                text("""
                    UPDATE clips
                       SET status = 'ready',
                           storage_url = :url,
                           upload_error = NULL,
                           updated_at = NOW()
                     WHERE id = CAST(:cid AS uuid)
                """),
                {"url": storage_url, "cid": clip_id},
            )

        _publish_clip_event(job_id, "clip_upload_complete", {
            "clip_id": clip_id,
            "video_id": video_id,
            "media_url": storage_url,
            "thumbnail_url": thumbnail_url,
        })

        # Push clip metadata to Google Sheets for n8n publishing workflow
        try:
            from workers.tasks.gsheet import push_clip_to_gsheet
            push_clip_to_gsheet.apply_async(
                args=[clip_id, tenant_id],
                queue="viralo.post.publish",
            )
        except Exception as _gse:
            logging.warning("push_clip_to_gsheet enqueue failed for clip %s: %s", clip_id, _gse)

        # If all clips for this video are now ready/failed, delete the source from storage
        if video_id:
            try:
                with _get_session(tenant_id) as session:
                    counts = session.execute(
                        text("""
                            SELECT
                                COUNT(*) FILTER (WHERE status IN ('pending_upload','uploading')) AS pending,
                                COUNT(*) FILTER (WHERE status IN ('ready','upload_failed')) AS done
                              FROM clips WHERE video_id = CAST(:vid AS uuid)
                        """),
                        {"vid": video_id},
                    ).fetchone()
                if counts and counts.pending == 0 and counts.done > 0:
                    # All uploads settled — delete source video from cloud storage to save space
                    with _get_session(tenant_id) as session:
                        src_key_row = session.execute(
                            text("SELECT original_storage_key FROM videos WHERE id = CAST(:vid AS uuid)"),
                            {"vid": video_id},
                        ).fetchone()
                    if src_key_row and src_key_row.original_storage_key:
                        import asyncio as _asyncio2
                        from shared.storage.base import get_storage as _get_storage2
                        async def _del_source():
                            st = _get_storage2(os.getenv("STORAGE_PROVIDER", "local"))
                            try:
                                await st.delete(src_key_row.original_storage_key)
                            except Exception:
                                pass
                        _asyncio2.run(_del_source())
                        logging.info("Deleted source %s after all clips uploaded", src_key_row.original_storage_key)
            except Exception as e:
                logging.warning("Source cleanup check failed for video %s: %s", video_id, e)

    except Exception as exc:
        logging.exception("upload_clip_to_storage failed for clip %s (attempt %d)", clip_id, attempt)
        if self.request.retries >= self.max_retries:
            failed_video_id = None
            with _get_session(tenant_id) as session:
                _row = session.execute(
                    text("SELECT video_id::text FROM clips WHERE id = CAST(:cid AS uuid)"),
                    {"cid": clip_id},
                ).fetchone()
                failed_video_id = _row[0] if _row else None
                session.execute(
                    text("""
                        UPDATE clips
                           SET status = 'upload_failed',
                               upload_error = :err,
                               updated_at = NOW()
                         WHERE id = CAST(:cid AS uuid)
                    """),
                    {"err": str(exc)[:500], "cid": clip_id},
                )
            _publish_clip_event(job_id, "clip_upload_failed", {
                "clip_id": clip_id,
                "video_id": failed_video_id,
                "error": str(exc)[:300],
                "attempts": attempt,
            })
            return
        raise self.retry(exc=exc)
    finally:
        try:
            Path(clip_path).unlink(missing_ok=True)
        except Exception:
            pass


def _reexport_clip_from_source(clip_id: str, tenant_id: str, out_path: str) -> None:
    """Re-export a clip segment from the original source video when tmp file is lost."""
    with _get_session(tenant_id) as session:
        row = session.execute(
            text("""
                SELECT c.start_sec, c.end_sec, v.original_storage_key, v.id::text as vid
                  FROM clips c
                  JOIN videos v ON v.id = c.video_id
                 WHERE c.id = CAST(:cid AS uuid)
            """),
            {"cid": clip_id},
        ).fetchone()

    if not row or not row[2]:
        raise FileNotFoundError(f"Cannot re-export clip {clip_id}: missing source storage key")

    start_sec, end_sec, storage_key, video_id = row[0], row[1], row[2], row[3]

    work_dir = Path(VIDEO_TEMP_DIR) / video_id
    work_dir.mkdir(parents=True, exist_ok=True)
    source_path = str(work_dir / "source_reexport.mp4")

    from shared.storage.base import get_storage
    storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
    asyncio.run(storage.download(storage_key, source_path))

    duration = end_sec - start_sec
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start_sec), "-i", source_path,
         "-t", str(duration), "-c", "copy", out_path],
        check=True, capture_output=True,
    )


@celery_app.task(bind=True, name="workers.tasks.video.process_uploaded_video",
                 queue="viralo.video.pipeline", acks_late=True, max_retries=3,
                 time_limit=1260, soft_time_limit=1200)
def process_uploaded_video(self, tenant_id: str, video_id: str, file_path: str | None, cfg: dict | None = None):
    from celery.exceptions import SoftTimeLimitExceeded
    job_id = self.request.id or video_id
    cfg = cfg or {}
    try:
        _update_video(tenant_id, video_id, status="processing",
                      celery_task_id=job_id, pipeline_step="upload", pipeline_pct=5)
        _publish_progress(job_id, "upload", 5, "processing", "File received, starting pipeline...")

        # file_path may be a local tmp path (first run) or a storage key (retry)
        if file_path and Path(file_path).exists():
            source = file_path
        elif file_path:
            # Treat as storage key — download to tmp
            _publish_progress(job_id, "upload", 8, "processing", "Re-downloading source from storage...")
            from shared.storage.base import get_storage
            storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
            work_dir = Path(VIDEO_TEMP_DIR) / video_id
            work_dir.mkdir(parents=True, exist_ok=True)
            source = str(work_dir / "source.mp4")
            import asyncio as _asyncio
            _asyncio.run(storage.download(file_path, source))
        else:
            raise FileNotFoundError("No source file available. Re-upload the video.")

        # Enforce max duration before running the full pipeline
        try:
            probe = _probe_video(source)
            if probe.duration > MAX_VIDEO_DURATION_SEC and not _is_unlimited(tenant_id):
                mins = int(probe.duration // 60)
                raise ValueError(
                    f"Video is {mins} minutes long. Maximum supported length is "
                    f"{MAX_VIDEO_DURATION_SEC // 60} minutes."
                )
        except ValueError:
            raise
        except Exception:
            pass  # probe failure is non-fatal; pipeline will probe again

        run_video_pipeline(tenant_id, video_id, source, job_id, cfg)
    except SoftTimeLimitExceeded:
        import gc
        msg = "Processing timed out (20 min limit). Try a shorter video or lower clip count."
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        gc.collect()
        raise
    except (FileNotFoundError, ValueError) as exc:
        msg = str(exc)[:400]
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg[:200])
        raise  # non-retryable
    except subprocess.TimeoutExpired:
        msg = "Rendering timed out. Try fewer clips or a lower quality setting."
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        if self.request.retries >= 1:
            _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        raise self.retry(exc=RuntimeError(msg), countdown=60, max_retries=1)
    except RuntimeError as exc:
        err = str(exc)
        if "ffmpeg" in err.lower() or "render" in err.lower():
            msg = "Video rendering failed. Try a different quality setting."
        else:
            msg = f"Processing error: {err[:200]}"
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        retry_n = self.request.retries
        if retry_n >= 1:
            _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        raise self.retry(exc=exc, countdown=min(30 * (2 ** retry_n), 300), max_retries=2)
    except Exception as exc:
        msg = f"Unexpected error: {str(exc)[:150]}"
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        retry_n = self.request.retries
        if retry_n >= 1:
            _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        raise self.retry(exc=exc, countdown=min(60 * (2 ** retry_n), 600), max_retries=2)


@celery_app.task(bind=True, name="workers.tasks.video.process_youtube_video",
                 queue="viralo.video.pipeline", acks_late=True, max_retries=3,
                 time_limit=3600, soft_time_limit=3540)
def process_youtube_video(self, tenant_id: str, video_id: str, url: str, cfg: dict | None = None):
    from celery.exceptions import SoftTimeLimitExceeded
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse as _urlunparse
    job_id = self.request.id or video_id
    cfg = cfg or {}
    # Strip playlist params — yt-dlp hangs enumerating playlists
    _p = urlparse(url)
    _qs = {k: v[0] for k, v in parse_qs(_p.query).items() if k not in ("list", "index", "start_radio")}
    url = _urlunparse(_p._replace(query=urlencode(_qs)))
    try:
        _update_video(tenant_id, video_id, status="processing",
                      celery_task_id=job_id, pipeline_step="download", pipeline_pct=5)
        _publish_progress(job_id, "download", 5, "processing", "Downloading YouTube video...")

        work_dir = Path(VIDEO_TEMP_DIR) / video_id
        work_dir.mkdir(parents=True, exist_ok=True)
        out_path = str(work_dir / "source.mp4")

        meta = _fetch_youtube_metadata(url, video_id=video_id)
        if meta.get("title") or meta.get("thumbnail_url"):
            _update_video(tenant_id, video_id, **{k: v for k, v in meta.items() if v})

        # Check live status and duration before downloading
        yt_info = _get_youtube_info(url)
        if yt_info.get("is_live") or yt_info.get("live_status") in ("is_live", "is_upcoming"):
            raise ValueError(
                "Live and upcoming streams are not supported. Please use a recorded video."
            )
        yt_duration = yt_info.get("duration")
        if yt_duration and yt_duration > MAX_VIDEO_DURATION_SEC and not _is_unlimited(tenant_id):
            mins = int(yt_duration // 60)
            raise ValueError(
                f"Video is {mins} minutes long. Maximum supported length is "
                f"{MAX_VIDEO_DURATION_SEC // 60} minutes."
            )
        if yt_duration and yt_duration < MIN_VIDEO_DURATION_SEC and cfg.get("source") == "websub":
            raise ValueError(
                f"Video is {int(yt_duration)}s — too short to clip (minimum {MIN_VIDEO_DURATION_SEC}s)."
            )

        def _on_download_progress(pct: int):
            # Map yt-dlp 0-100% → pipeline 5-14% range
            mapped = 5 + int(pct * 9 / 100)
            _publish_progress(job_id, "download", mapped, "processing",
                              f"Downloading YouTube video... {pct}%")
            _update_video(tenant_id, video_id, pipeline_pct=mapped)

        _download_youtube(url, out_path, quality=cfg.get("output_quality", "source"),
                          progress_cb=_on_download_progress, tenant_id=str(tenant_id))
        _publish_progress(job_id, "download", 15, "processing", "Download complete, processing...")
        run_video_pipeline(tenant_id, video_id, out_path, job_id, cfg, yt_url=url, yt_meta=meta)
    except SoftTimeLimitExceeded:
        import gc
        msg = "Processing timed out (20 min limit). Try a shorter video or lower clip count."
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        gc.collect()
        raise
    except ValueError as exc:
        msg = str(exc)[:400]
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg[:200])
        raise  # non-retryable — bad input
    except subprocess.TimeoutExpired:
        msg = "Video download or rendering timed out. The video may be too large or the server is busy."
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        if self.request.retries >= 1:
            _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        raise self.retry(exc=RuntimeError(msg), countdown=60, max_retries=2)
    except RuntimeError as exc:
        err = str(exc)
        if "download" in err.lower() or "yt-dlp" in err.lower() or "youtube" in err.lower():
            if "429" in err or "Too Many Requests" in err:
                msg = "YouTube is rate-limiting downloads. Retrying automatically..."
            else:
                msg = "Failed to download video. The URL may be private, geo-blocked, or unsupported."
        elif "429" in err or "rate" in err.lower():
            msg = "AI providers are busy right now. Retrying automatically..."
        elif "ffmpeg" in err.lower() or "render" in err.lower():
            msg = "Video rendering failed. Try a shorter clip duration or lower quality setting."
        else:
            msg = f"Processing error: {err[:200]}"
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        retry_n = self.request.retries
        if retry_n >= 1:
            _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        raise self.retry(exc=exc, countdown=min(30 * (2 ** retry_n), 300), max_retries=2)
    except Exception as exc:
        err = str(exc)[:300]
        msg = f"Unexpected error during processing. Our team has been notified. ({err[:120]})"
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed", error_message=msg)
        _publish_progress(job_id, "failed", 0, "failed", msg)
        retry_n = self.request.retries
        if retry_n >= 1:
            _notify_video(tenant_id, video_id, "video_failed", "Video processing failed", msg)
        raise self.retry(exc=exc, countdown=min(60 * (2 ** retry_n), 600), max_retries=2)


@celery_app.task(
    bind=True,
    name="workers.tasks.video.concat_top_clips",
    queue="viralo.video.generate",
    acks_late=True,
    max_retries=2,
    default_retry_delay=60,
    time_limit=1260,
    soft_time_limit=1200,
)
def concat_top_clips(self, tenant_id: str, video_id: str, clip_ids: list) -> str:
    """Download two clips from storage, concat via ffmpeg, upload as composite clip."""
    import tempfile
    import uuid as uuid_mod

    if len(clip_ids) != 2:
        raise ValueError(f"concat_top_clips requires exactly 2 clip_ids, got {len(clip_ids)}")

    composite_id = str(uuid_mod.uuid4())
    tmp_dir = Path(tempfile.mkdtemp(prefix=f"viralo-concat-{composite_id}-"))

    try:
        import httpx as _httpx

        local_paths = []
        for i, clip_id in enumerate(clip_ids):
            with _get_session(tenant_id) as session:
                row = session.execute(
                    text("SELECT storage_url, status FROM clips WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
                    {"id": clip_id, "tid": tenant_id},
                ).fetchone()
                if not row:
                    raise ValueError(f"Clip {clip_id} not found for tenant {tenant_id}")
                if row.status != "ready":
                    raise ValueError(f"Clip {clip_id} status is '{row.status}', must be 'ready'")
                storage_url = row.storage_url

            local_path = tmp_dir / f"part_{i}.mp4"
            with _httpx.stream("GET", storage_url, timeout=120, follow_redirects=True) as resp:
                resp.raise_for_status()
                with open(local_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=65536):
                        f.write(chunk)

            if local_path.stat().st_size == 0:
                raise ValueError(f"Downloaded clip {clip_id} is empty")
            local_paths.append(local_path)

        list_file = tmp_dir / "list.txt"
        list_file.write_text("\n".join(f"file '{p}'" for p in local_paths))

        output_path = tmp_dir / f"{composite_id}.mp4"
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(list_file),
                "-c", "copy",
                "-movflags", "+faststart",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed: {result.stderr[-2000:]}")

        if output_path.stat().st_size == 0:
            raise RuntimeError("ffmpeg produced empty output file")

        with _get_session(tenant_id) as session:
            session.execute(
                text("""
                    INSERT INTO clips (id, tenant_id, video_id, title, status, metadata, created_at, updated_at)
                    VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:vid AS uuid), :title, 'uploading',
                            CAST(:meta AS jsonb), NOW(), NOW())
                """),
                {
                    "id": composite_id,
                    "tid": tenant_id,
                    "vid": video_id,
                    "title": "Top 2 Compilation",
                    "meta": json.dumps({
                        "composite": True,
                        "source_clip_ids": clip_ids,
                    }),
                },
            )

        storage_key = f"clips/{tenant_id}/{composite_id}.mp4"
        from shared.storage.base import get_storage

        async def _upload() -> str:
            _storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
            with open(output_path, "rb") as f:
                return await _storage.upload(f, storage_key, "video/mp4")

        storage_url = asyncio.run(_upload())

        with _get_session(tenant_id) as session:
            session.execute(
                text("UPDATE clips SET status='ready', storage_url=:url, updated_at=NOW() WHERE id = CAST(:id AS uuid)"),
                {"url": storage_url, "id": composite_id},
            )

        return composite_id

    finally:
        import shutil as _shutil
        _shutil.rmtree(tmp_dir, ignore_errors=True)


@celery_app.task(
    bind=True,
    name="workers.tasks.video.merge_ai_clips",
    queue="viralo.video.generate",
    acks_late=True,
    max_retries=2,
    default_retry_delay=60,
    time_limit=900,
    soft_time_limit=870,
)
def merge_ai_clips(self, tenant_id: str, clip_ids: list) -> list:
    """LLM-assisted merge: groups clips by narrative coherence, re-renders from source."""
    import json as _json
    import shutil as _shutil
    import tempfile as _tempfile
    import uuid as _uuid_mod
    from collections import defaultdict
    from pathlib import Path as _Path

    if len(clip_ids) < 2:
        raise ValueError("merge_ai_clips requires at least 2 clips")

    with _get_session(tenant_id) as session:
        rows = session.execute(
            text("""
                SELECT c.id::text, c.video_id::text, c.start_sec, c.end_sec, c.duration_ms,
                       c.score, c.caption_srt, c.title,
                       c.clip_metadata->>'reason' as reason,
                       v.original_storage_key
                FROM clips c
                JOIN videos v ON c.video_id = v.id
                WHERE c.id = ANY(CAST(:ids AS uuid[]))
                  AND c.tenant_id = CAST(:tid AS uuid)
                ORDER BY c.start_sec
            """),
            {"ids": clip_ids, "tid": tenant_id},
        ).fetchall()

    if len(rows) < 2:
        raise ValueError(f"Found only {len(rows)} clips for tenant {tenant_id}")

    # Group clips by video_id (can only merge clips from same source)
    by_video: dict = defaultdict(list)
    for r in rows:
        by_video[r[1]].append(r)

    all_new_clip_ids: list = []

    for video_id, clips in by_video.items():
        original_storage_key = clips[0][9]
        if not original_storage_key:
            logging.warning("No original_storage_key for video %s — skipping merge", video_id)
            continue

        t_start = min(float(c[2] or 0) for c in clips)
        t_end = max(float(c[3] or 0) for c in clips)

        with _get_session(tenant_id) as session:
            t_row = session.execute(
                text("SELECT segments FROM transcripts WHERE video_id = CAST(:vid AS uuid) LIMIT 1"),
                {"vid": video_id},
            ).fetchone()

        transcript_segs = []
        if t_row and t_row[0]:
            segs = t_row[0] if isinstance(t_row[0], list) else _json.loads(t_row[0])
            transcript_segs = [s for s in segs if float(s.get("end", 0)) >= t_start and float(s.get("start", 0)) <= t_end]

        transcript_text = " ".join(s.get("text", "") for s in transcript_segs).strip() or "(no transcript)"

        clips_summary = "\n".join(
            f"Clip {i+1}: [{float(c[2] or 0):.1f}s–{float(c[3] or 0):.1f}s] score={c[5]} title=\"{c[7] or ''}\" reason=\"{c[8] or ''}\""
            for i, c in enumerate(clips)
        )

        merge_prompt = f"""You are a professional video editor. Given these clips from the same video, decide which should be merged into a single clip for maximum narrative coherence and virality.

CLIPS (sorted by time):
{clips_summary}

TRANSCRIPT (covering this time range):
{transcript_text}

MERGE RULES:
- Merge clips that form a single coherent thought, story beat, or joke setup+punchline
- Merge clips whose combined duration is ≤90 seconds
- Do NOT merge clips that are about different topics or have a narrative break between them
- Clips separated by >15 seconds of dead time should NOT be merged unless transcript shows continuity
- A single strong clip should stay as-is (group of 1)

Return JSON — groups of clip indices (1-based) to merge:
{{
  "groups": [
    {{
      "clip_indices": [1, 2],
      "reason": "<why these merge well, 1 sentence>",
      "merged_title": "<punchy title for the merged clip>"
    }}
  ]
}}

Every clip index must appear in exactly one group. Use a group of [N] for clips that should stay solo."""

        try:
            merge_decision = _call_llm_json(
                [{"role": "user", "content": merge_prompt}],
                temperature=0.15,
                max_tokens=1000,
            )
            groups = merge_decision.get("groups", [])
        except Exception as e:
            logging.warning("MergeAI LLM failed for video %s: %s — using solo groups", video_id, e)
            groups = [{"clip_indices": [i + 1], "reason": "solo", "merged_title": clips[i][7]} for i in range(len(clips))]

        tmp_dir = _Path(_tempfile.mkdtemp(prefix=f"viralo-merge-{video_id[:8]}-"))
        try:
            source_path = str(tmp_dir / "source.mp4")
            from shared.storage.base import get_storage
            _storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
            asyncio.run(_storage.download(original_storage_key, source_path))

            if not _Path(source_path).exists() or _Path(source_path).stat().st_size == 0:
                raise RuntimeError(f"Downloaded source for video {video_id} is empty")

            for group in groups:
                indices = [i - 1 for i in group.get("clip_indices", []) if 0 < i <= len(clips)]
                if not indices:
                    continue

                group_clips = [clips[i] for i in indices]
                merged_start = min(float(c[2] or 0) for c in group_clips)
                merged_end = max(float(c[3] or 0) for c in group_clips)
                merged_dur = merged_end - merged_start
                merged_score = max(float(c[5] or 0) for c in group_clips)
                merged_title = group.get("merged_title") or group_clips[0][7] or "Merged Clip"
                source_clip_ids = [c[0] for c in group_clips]

                new_id = str(_uuid_mod.uuid4())
                out_path = str(tmp_dir / f"{new_id}.mp4")

                result = subprocess.run(
                    ["ffmpeg", "-y", "-ss", str(merged_start), "-i", source_path,
                     "-t", str(merged_dur), "-c", "copy", "-movflags", "+faststart", out_path],
                    capture_output=True, text=True, timeout=300,
                )
                if result.returncode != 0:
                    logging.error("ffmpeg merge failed for group %s: %s", source_clip_ids, result.stderr[-1000:])
                    continue

                if _Path(out_path).stat().st_size == 0:
                    logging.error("ffmpeg produced empty file for group %s", source_clip_ids)
                    continue

                storage_key = f"clips/{tenant_id}/{new_id}.mp4"

                async def _upload_merge(p=out_path, k=storage_key) -> str:
                    _s = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
                    with open(p, "rb") as f:
                        return await _s.upload(f, k, "video/mp4")

                storage_url = asyncio.run(_upload_merge())

                with _get_session(tenant_id) as session:
                    session.execute(
                        text("""
                            INSERT INTO clips (id, tenant_id, video_id, title, start_sec, end_sec,
                                duration_ms, score, status, clip_metadata, created_at, updated_at)
                            VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:vid AS uuid),
                                :title, :start, :end, :dur, :score,
                                'ready', CAST(:meta AS jsonb), NOW(), NOW())
                        """),
                        {
                            "id": new_id, "tid": tenant_id, "vid": video_id,
                            "title": merged_title,
                            "start": merged_start, "end": merged_end,
                            "dur": int(merged_dur * 1000),
                            "score": merged_score,
                            "meta": _json.dumps({
                                "merged_from": source_clip_ids,
                                "merge_reason": group.get("reason", ""),
                                "is_merge_ai": True,
                            }),
                        },
                    )

                with _get_session(tenant_id) as session:
                    session.execute(
                        text("UPDATE clips SET storage_url = :url, updated_at = NOW() WHERE id = CAST(:id AS uuid)"),
                        {"url": storage_url, "id": new_id},
                    )

                all_new_clip_ids.append(new_id)
                logging.info("MergeAI: created merged clip %s from %s", new_id, source_clip_ids)

        finally:
            _shutil.rmtree(tmp_dir, ignore_errors=True)

    return all_new_clip_ids


def _download_stored_video(video_id: str, tenant_id: str, out_path: str) -> None:
    """Resolve an uploaded video_id to its source file in storage and download it."""
    with _get_session(tenant_id) as session:
        row = session.execute(
            text("SELECT original_storage_key FROM videos WHERE id = CAST(:vid AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
            {"vid": video_id, "tid": tenant_id},
        ).fetchone()
    if not row or not row[0]:
        raise ValueError(f"Video {video_id} has no stored source")
    from shared.storage.base import get_storage
    storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
    asyncio.run(storage.download(row[0], out_path))
    if not Path(out_path).exists() or Path(out_path).stat().st_size == 0:
        raise RuntimeError(f"Downloaded source for video {video_id} is empty")


@celery_app.task(
    bind=True,
    name="workers.tasks.video.generate_video_ranking",
    queue="viralo.video.generate",
    acks_late=True,
    soft_time_limit=1800,
    time_limit=2100,
)
def generate_video_ranking(self, tenant_id: str, video_id: str, segments: list,
                           title: str, theme: str, order: str,
                           template_config: dict | None = None) -> dict:
    """Build a ranking compilation video from 2-5 segments with rank-number overlays.

    segments: list of {source_type, url?, video_id?, start_sec, end_sec}
    order: "countdown" (badge n→1) or "ascending" (badge 1→n)
    """
    import tempfile
    import shutil
    import uuid as _uuid_mod
    from concurrent.futures import ThreadPoolExecutor, as_completed

    job_id = self.request.id
    _publish_progress(job_id, "starting", 2, "processing", "Preparing ranking video...")

    n = len(segments)
    badges = list(range(n, 0, -1)) if order == "countdown" else list(range(1, n + 1))

    tmpdir = tempfile.mkdtemp(prefix="viralo_ranking_")
    try:
        _publish_progress(job_id, "downloading", 10, "processing", "Resolving sources...")
        source_paths = []
        for i, seg in enumerate(segments):
            src_path = os.path.join(tmpdir, f"src_{i}.mp4")
            if seg.get("source_type") == "upload" and seg.get("video_id"):
                _download_stored_video(seg["video_id"], tenant_id, src_path)
            elif seg.get("url"):
                _download_youtube(seg["url"], src_path)  # handles YouTube, TikTok, Instagram via yt-dlp
            else:
                raise ValueError(f"Segment {i} has no url or video_id")
            source_paths.append(src_path)

        _publish_progress(job_id, "rendering", 20, "processing", "Rendering segments...")
        seg_paths = [os.path.join(tmpdir, f"seg_{i}.mp4") for i in range(n)]

        # Build label list indexed by rank number (1-based): all_labels[0] = label for rank#1
        # Fall back to "Video N" if user left segment_title blank
        all_labels_by_rank = [""] * (n + 1)
        for idx, badge in enumerate(badges):
            seg_title = (segments[idx].get("segment_title") or "").strip()
            if not seg_title:
                seg_title = f"Video {idx + 1}"
            if badge <= n:
                all_labels_by_rank[badge] = seg_title
        all_labels = all_labels_by_rank[1:]  # 0-indexed: [label_for_1, label_for_2, ...]

        def render_one(idx):
            seg = segments[idx]
            # Cumulative reveal: show ranks introduced up to and including this segment
            revealed = set(badges[: idx + 1])
            _render_ranking_segment(
                source_path=source_paths[idx],
                start_sec=float(seg.get("start_sec", 0)),
                end_sec=float(seg.get("end_sec", 30)),
                rank_number=badges[idx],
                title_text=title,
                theme_name=theme,
                out_path=seg_paths[idx],
                total=n,
                all_labels=all_labels,
                revealed_ranks=revealed,
                template_config=template_config,
            )
            pct = 20 + int((idx + 1) / n * 50)
            _publish_progress(job_id, f"rendered_{idx+1}", pct, "processing", f"Rendered segment {idx+1}/{n}")

        with ThreadPoolExecutor(max_workers=min(n, 4)) as pool:
            futs = {pool.submit(render_one, i): i for i in range(n)}
            for fut in as_completed(futs):
                fut.result()

        _publish_progress(job_id, "concatenating", 75, "processing", "Joining segments...")
        concat_list = os.path.join(tmpdir, "concat.txt")
        with open(concat_list, "w") as f:
            for p in seg_paths:
                f.write(f"file '{p}'\n")
        out_path = os.path.join(tmpdir, "ranking_out.mp4")
        result = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
             "-c", "copy", "-movflags", "+faststart", out_path],
            capture_output=True, timeout=120,
        )
        if result.returncode != 0 or not Path(out_path).exists() or Path(out_path).stat().st_size < 1000:
            raise RuntimeError(f"ffmpeg concat failed: {result.stderr.decode()[-500:]}")

        _publish_progress(job_id, "uploading", 88, "processing", "Uploading...")
        clip_id = str(_uuid_mod.uuid4())
        storage_key = f"clips/{tenant_id}/{clip_id}.mp4"
        from shared.storage.base import get_storage

        async def _upload() -> str:
            _storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
            with open(out_path, "rb") as f:
                return await _storage.upload(f, storage_key, "video/mp4")

        storage_url = asyncio.run(_upload())

        with _get_session(tenant_id) as session:
            session.execute(
                text("""
                    INSERT INTO clips (id, tenant_id, video_id, title, status, storage_url, metadata, created_at, updated_at)
                    VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:vid AS uuid), :title, 'ready',
                            :url, CAST(:meta AS jsonb), NOW(), NOW())
                """),
                {
                    "id": clip_id, "tid": tenant_id, "vid": video_id, "title": title,
                    "url": storage_url,
                    "meta": json.dumps({
                        "ranking": True, "source_count": n, "order": order,
                        "theme": theme, "title": title, "composite": True,
                    }),
                },
            )
            session.execute(
                text("UPDATE videos SET status='ready', storage_url=:url, updated_at=NOW() WHERE id = CAST(:vid AS uuid)"),
                {"url": storage_url, "vid": video_id},
            )

        # Generate platform captions (same as clip pipeline)
        _publish_progress(job_id, "captions", 95, "processing", "Generating platform captions...")
        try:
            segment_labels = [s.get("segment_title", "") for s in segments]
            topic_hint = f"{title}. Segments: {', '.join(l for l in segment_labels if l)}"
            from collections import namedtuple as _nt
            _ClipResult = _nt("ClipResult", ["title", "reason"])
            fake_clip = _ClipResult(title=title, reason=topic_hint)
            platforms = ["tiktok", "reels", "shorts", "youtube"]
            content = _ai_generate_clip_content(fake_clip, topic_hint, platforms)
            if content and content.get("platforms"):
                ai_title = (content.get("title") or title)[:100].strip()
                # Use same `platforms` key as regular clip pipeline so ClipsPage reads it
                platforms_data = {
                    plat: {"description": data.get("description", ""), "tags": data.get("tags", [])}
                    for plat, data in content["platforms"].items()
                }
                with _get_session(tenant_id) as session:
                    session.execute(
                        text("""
                            UPDATE clips
                            SET metadata = metadata || CAST(:patch AS jsonb), updated_at = NOW()
                            WHERE id = CAST(:id AS uuid)
                        """),
                        {"patch": json.dumps({"platforms": platforms_data, "ai_title": ai_title}), "id": clip_id},
                    )
        except Exception as _cap_err:
            logging.warning(f"generate_video_ranking: caption generation failed (non-fatal): {_cap_err}")

        _publish_progress(job_id, "complete", 100, "complete", "Ranking video ready")
        _publish_clip_event(job_id, "clip_ready", {"clip_id": clip_id, "video_id": video_id})
        return {"clip_id": clip_id, "storage_key": storage_key}

    except Exception:
        logging.exception("generate_video_ranking failed")
        try:
            with _get_session(tenant_id) as session:
                session.execute(
                    text("UPDATE videos SET status='error', updated_at=NOW() WHERE id = CAST(:vid AS uuid)"),
                    {"vid": video_id},
                )
        except Exception:
            pass
        raise
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

# ── Editor server-side render ─────────────────────────────────────────────────

SOUNDS_DIR = Path(__file__).parent.parent / "assets" / "sounds"

QUALITY_PRESETS = {
    "draft":  ["-crf", "32", "-preset", "ultrafast"],
    "720p":   ["-crf", "26", "-preset", "fast", "-vf", "scale=-2:720"],
    "1080p":  ["-crf", "22", "-preset", "fast", "-vf", "scale=-2:1080"],
}


def _build_caption_filter(captions: list[dict]) -> str:
    """Build ffmpeg drawtext filter chain for captions."""
    parts = []
    pos_map = {"top": "h*0.10", "center": "h*0.50", "bottom": "h*0.88"}
    for cap in captions:
        text = cap["text"].replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
        y = pos_map.get(cap.get("position", "bottom"), "h*0.88")
        color = cap.get("color", "#ffffff").lstrip("#")
        size = cap.get("font_size", 24)
        t0 = cap["start_sec"]
        t1 = cap["end_sec"]
        parts.append(
            f"drawtext=text='{text}':fontsize={size}:fontcolor=0x{color}:"
            f"x=(w-text_w)/2:y={y}:enable='between(t,{t0},{t1})'"
        )
    return ",".join(parts) if parts else ""


def _mix_sound_markers(
    source_path: str,
    markers: list[dict],
    output_path: str,
    base_cmd_prefix: list[str],
) -> list[str]:
    """
    Build ffmpeg command that mixes source video with sound WAV files.
    Returns full ffmpeg argv list.
    """
    valid = [m for m in markers if (SOUNDS_DIR / f"{m['sound']}.wav").exists()]
    if not valid:
        return []

    inputs = ["-i", source_path]
    for m in valid:
        inputs += ["-i", str(SOUNDS_DIR / f"{m['sound']}.wav")]

    n_audio = len(valid)
    # Build adelay filter for each sound input (stream index 1..n)
    filter_parts = []
    for i, m in enumerate(valid):
        delay_ms = int(m["time_ms"])
        filter_parts.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms}[sfx{i}]")

    sfx_labels = "".join(f"[sfx{i}]" for i in range(n_audio))
    filter_parts.append(f"[0:a]{sfx_labels}amix=inputs={n_audio+1}:normalize=0[aout]")
    filter_str = ";".join(filter_parts)

    return inputs + [
        "-filter_complex", filter_str,
        "-map", "0:v", "-map", "[aout]",
    ] + base_cmd_prefix + [output_path]


@celery_app.task(bind=True, name="workers.tasks.video.render_clip_with_edits", max_retries=2)
def render_clip_with_edits(
    self,
    tenant_id: str,
    clip_id: str,
    render_id: str,
    storage_url: str,
    trim_start_sec: float,
    trim_end_sec: float | None,
    captions: list[dict],
    markers: list[dict],
    quality: str,
):
    import json as _json
    import tempfile

    import psycopg2

    _db_url = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")
    _storage_root = os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage")

    def _update_meta(conn, status: str, progress: int, download_url: str | None = None, error: str | None = None):
        with conn.cursor() as cur:
            cur.execute("SELECT metadata->'renders' FROM clips WHERE id = %s::uuid", (clip_id,))
            row = cur.fetchone()
            existing_renders = list(row[0] or []) if row else []
            renders = [r for r in existing_renders if r.get("render_id") != render_id]
            renders.append({
                "render_id": render_id,
                "status": status,
                "progress_pct": progress,
                "download_url": download_url,
                "error_message": error,
            })
            cur.execute(
                "UPDATE clips SET metadata = jsonb_set(coalesce(metadata,'{}'), '{renders}', %s::jsonb) WHERE id = %s::uuid",
                (_json.dumps(renders), clip_id),
            )
        conn.commit()

    conn = psycopg2.connect(_db_url)
    try:
        import shutil as _shutil
        if not _shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg binary not found in worker PATH")

        _update_meta(conn, "processing", 5)

        # Resolve local path from storage_url (/storage/<relative>)
        if storage_url.startswith("/storage/"):
            rel = storage_url[len("/storage/"):]
        else:
            raise ValueError(f"Cannot resolve storage path from: {storage_url}")

        source_path = os.path.join(_storage_root, rel)
        if not os.path.realpath(source_path).startswith(os.path.realpath(_storage_root) + os.sep):
            raise ValueError(f"storage_url escapes storage root: {storage_url!r}")

        with tempfile.TemporaryDirectory() as tmp:
            trimmed = os.path.join(tmp, "trimmed.mp4")
            final = os.path.join(tmp, f"render_{render_id}.mp4")

            # ── Step 1: Trim ──────────────────────────────────────────
            trim_cmd = ["ffmpeg", "-y", "-threads", "2"]
            trim_cmd += ["-ss", str(trim_start_sec)]
            if trim_end_sec:
                trim_cmd += ["-to", str(trim_end_sec)]
            trim_cmd += ["-i", source_path, "-c", "copy", trimmed]
            r = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=300)
            if r.returncode != 0:
                raise RuntimeError(f"Trim failed: {r.stderr[-300:]}")

            _update_meta(conn, "processing", 30)

            # ── Step 2: Caption filter ────────────────────────────────
            caption_filter = _build_caption_filter(captions)
            quality_flags = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["1080p"])

            # ── Step 3: Build + run encode command ────────────────────
            # Compose vf filters: merge scale (from quality preset) with caption drawtext
            vf_filters = []
            qf = list(quality_flags)
            if "-vf" in qf:
                vf_idx = qf.index("-vf")
                vf_filters.append(qf[vf_idx + 1])
                qf = qf[:vf_idx] + qf[vf_idx + 2:]  # remove -vf + value from quality flags
            if caption_filter:
                vf_filters.append(caption_filter)
            combined_vf = ",".join(vf_filters) if vf_filters else None

            sound_cmd = _mix_sound_markers(trimmed, markers, final, qf)

            if sound_cmd:
                # Has sound markers — build combined command
                cmd = ["ffmpeg", "-y", "-threads", "2"] + sound_cmd
                if combined_vf:
                    # Insert -vf before output path
                    cmd.insert(-1, "-vf")
                    cmd.insert(-1, combined_vf)
            else:
                # No sound markers
                cmd = ["ffmpeg", "-y", "-threads", "2", "-i", trimmed]
                if combined_vf:
                    cmd += ["-vf", combined_vf]
                cmd += qf + [final]

            _update_meta(conn, "processing", 50)
            r2 = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if r2.returncode != 0:
                raise RuntimeError(f"Render failed: {r2.stderr[-500:]}")

            _update_meta(conn, "processing", 85)

            # ── Step 4: Upload result ─────────────────────────────────
            out_key = f"renders/{tenant_id}/{clip_id}/{render_id}.mp4"
            out_path = os.path.join(_storage_root, out_key)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(final, "rb") as src_fh, open(out_path, "wb") as dst_fh:
                _shutil.copyfileobj(src_fh, dst_fh, length=1024 * 1024)

            download_url = f"/storage/{out_key}"
            _update_meta(conn, "done", 100, download_url=download_url)

    except Exception as exc:
        logging.error("render_clip_with_edits failed: %s", exc)
        try:
            _update_meta(conn, "error", 0, error=str(exc)[:500])
        except Exception:
            pass
        if isinstance(exc, (subprocess.TimeoutExpired, OSError)):
            raise self.retry(exc=exc, countdown=30)
        raise  # permanent failures (ValueError, RuntimeError from ffmpeg, etc.) don't retry
    finally:
        conn.close()
