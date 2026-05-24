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
import subprocess
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Optional

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

# ── Config ────────────────────────────────────────────────────────────────────

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
VIDEO_TEMP_DIR = os.getenv("VIDEO_TEMP_DIR", "/tmp/viralo-video")

GROQ_WHISPER_MODEL = "whisper-large-v3-turbo"
GROQ_LLM_MODEL = "llama-3.3-70b-versatile"
GROQ_MAX_AUDIO_MB = 24
VIDEO_CRF = 23
AUDIO_BITRATE = 128_000
CAPTION_BURN_MAX_SECONDS = 120

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

redis_client = redis.from_url(REDIS_URL)
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)


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
    full_audio = _extract_audio_bytes(source_path)
    size_mb = len(full_audio) / (1024 * 1024)
    if size_mb <= GROQ_MAX_AUDIO_MB:
        return [(full_audio, 0.0)]
    num_chunks = int(size_mb / GROQ_MAX_AUDIO_MB) + 1
    chunk_dur = duration / num_chunks
    chunks = []
    for i in range(num_chunks):
        start = i * chunk_dur
        end = min((i + 1) * chunk_dur + 2.0, duration)
        chunk = _extract_audio_bytes(source_path, start=start, end=end)
        chunks.append((chunk, start))
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

    # 3. Approximate: evenly split segment text over segment duration
    for seg in (getattr(response, "segments", None) or []):
        seg_text = (_get_attr(seg, "text") or "").strip()
        seg_start = float(_get_attr(seg, "start") or 0)
        seg_end = float(_get_attr(seg, "end") or 0)
        tokens = seg_text.split()
        if not tokens:
            continue
        dpw = (seg_end - seg_start) / len(tokens)
        for i, token in enumerate(tokens):
            words.append(WordTimestamp(
                word=token,
                start=round(seg_start + i * dpw + offset, 3),
                end=round(seg_start + (i + 1) * dpw + offset, 3),
            ))
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
    groq_key = os.getenv("GROQ_API_KEY", "")
    if not groq_key:
        return []

    from groq import Groq
    client = Groq(api_key=groq_key)

    audio_chunks = _prepare_audio_chunks(source_path, duration)
    all_words = []
    for i, (audio_bytes, offset) in enumerate(audio_chunks):
        fname = f"audio_chunk_{i}.mp3"
        words = _transcribe_chunk(client, audio_bytes, fname, offset, language)
        all_words.extend(words)

    # Deduplicate overlapping chunk boundaries
    if len(audio_chunks) > 1:
        seen, deduped = set(), []
        for w in sorted(all_words, key=lambda x: x.start):
            key = round(w.start, 1)
            if key not in seen:
                deduped.append(w)
                seen.add(key)
        all_words = deduped

    return all_words


# ── Stage 4: AI clip scoring via Groq LLaMA ───────────────────────────────────

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


def _ai_score_clips(
    words: list[WordTimestamp],
    duration: float,
    num_clips: int,
    min_dur: int,
    max_dur: int,
    min_score_10: float,
    topic_focus: str = "",
    platforms: list[str] = None,
) -> list[ClipResult]:
    if platforms is None:
        platforms = ["tiktok", "reels", "shorts"]
    if not words:
        return []

    groq_key = os.getenv("GROQ_API_KEY", "")
    if not groq_key:
        return []

    transcript = _build_timed_transcript(words)
    topic_line = f"Topic focus: {topic_focus}\n" if topic_focus else ""
    platforms_str = ", ".join(platforms)

    # Step 1 — identify viral signal moments in the transcript
    analysis_prompt = f"""You are an expert viral content analyst for TikTok, Reels, and Shorts.

{topic_line}Full transcript with timestamps (M:SS):
{transcript}

Analyze this transcript and identify ALL moments with high viral potential.

Viral signals to look for:
- Strong hooks / pattern interrupts (surprising opening statements)
- Shocking facts, statistics, or revelations
- Emotional peaks (anger, joy, fear, inspiration, humor)
- Controversy or bold opinions
- Relatable pain points or "aha" moments
- Quotable one-liners or memorable phrases
- Story climaxes or turning points
- Call-to-action moments

For each viral signal found, output:
- timestamp (seconds from start)
- signal type (hook/shock/emotion/controversy/insight/quote/climax)
- virality score (0-10)
- the exact words that make it viral

Return JSON:
{{
  "signals": [
    {{
      "timestamp_sec": <number>,
      "signal_type": "<type>",
      "score": <0.0-10.0>,
      "trigger_words": "<exact quote>"
    }}
  ]
}}"""

    try:
        from groq import Groq
        client = Groq(api_key=groq_key)

        # Step 1: get viral signals
        r1 = client.chat.completions.create(
            model=GROQ_LLM_MODEL,
            messages=[{"role": "user", "content": analysis_prompt}],
            temperature=0.2,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        signals_data = json.loads(r1.choices[0].message.content)
        signals = signals_data.get("signals", [])

        if not signals:
            # fallback to single-step if signal detection failed
            signals = [{"timestamp_sec": i * (duration / max(num_clips, 1)), "score": 5.0} for i in range(num_clips)]

        # Step 2 — build clips around viral signals
        signals_str = "\n".join(
            f"- t={s.get('timestamp_sec', 0):.1f}s  score={s.get('score', 5)}/10  type={s.get('signal_type', '?')}  quote: {s.get('trigger_words', '')}"
            for s in sorted(signals, key=lambda x: x.get("score", 0), reverse=True)
        )

        clip_prompt = f"""You are a viral video editor. Using the viral signals identified below, create exactly {num_clips} non-overlapping clips optimized for {platforms_str}.

Viral signals found (sorted by score):
{signals_str}

Full transcript:
{transcript}

Rules:
- Create EXACTLY {num_clips} clips — use top signals first, fill remaining with next-best moments
- Each clip MUST be {min_dur}–{max_dur} seconds long
- Start each clip a few seconds BEFORE the viral signal so it builds context
- End after the payoff/punchline
- No overlapping clips
- Score reflects the viral signal strength

Return ONLY JSON:
{{
  "clips": [
    {{
      "start_seconds": <number>,
      "end_seconds": <number>,
      "score": <0.0-10.0>,
      "title": "<punchy 6-word title>",
      "reason": "<why this goes viral, max 12 words>",
      "platform": "<best from: {platforms_str}>"
    }}
  ]
}}"""

        resp = client.chat.completions.create(
            model=GROQ_LLM_MODEL,
            messages=[{"role": "user", "content": clip_prompt}],
            temperature=0.2,
            max_tokens=max(2000, num_clips * 350),
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content.strip()
        # response_format=json_object ensures valid JSON — parse directly
        try:
            data = json.loads(content)
        except Exception:
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if not match:
                return []
            data = json.loads(match.group())
        clips = []
        for c in data.get("clips", []):
            start = float(c.get("start_seconds", 0))
            end = float(c.get("end_seconds", 0))
            # Clamp end to video duration
            if end > duration:
                end = duration
            clip_dur = end - start
            # Clamp to requested duration window — adjust end if slightly over
            if end - start > max_dur:
                end = start + max_dur
                clip_dur = max_dur
            # Skip if still under min or start is invalid
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
                title=c.get("title", f"Clip {len(clips)+1}"),
                reason=c.get("reason", ""),
                platform=plat,
            ))

        clips.sort(key=lambda c: c.score, reverse=True)
        # Apply min_score filter — but only if enough clips survive; otherwise keep all
        filtered = [c for c in clips if c.score >= min_score_10]
        if len(filtered) >= num_clips:
            clips = filtered
        # Remove overlapping clips — keep higher score, greedy
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

    except Exception:
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
            score = density * pos_bonus * dur_bonus
            candidates.append((score, start, end, " ".join(w.word for w in window[:8])))

    candidates.sort(key=lambda c: c[0], reverse=True)
    selected: list[ClipResult] = []
    for score, start, end, preview in candidates:
        if not any(start < s.end and end > s.start for s in selected):
            selected.append(ClipResult(
                start=round(start, 2), end=round(end, 2),
                score=round(score, 2), title=f"Clip {len(selected)+1}",
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

def _generate_captions(words: list[WordTimestamp], clip: ClipResult, max_words: int = 3) -> list[CaptionSegment]:
    clip_words = [w for w in words if w.start >= clip.start - 0.1 and w.end <= clip.end + 0.1]
    if not clip_words:
        return []
    segments, current = [], []
    for w in clip_words:
        current.append(w)
        is_break = len(current) >= max_words or w.word.endswith((".", "!", "?", ","))
        if is_break:
            segments.append(CaptionSegment(
                text=" ".join(cw.word for cw in current),
                start=max(0.0, current[0].start - clip.start),
                end=max(0.0, current[-1].end - clip.start),
                words=[WordTimestamp(cw.word, max(0.0, cw.start - clip.start), max(0.0, cw.end - clip.start)) for cw in current],
            ))
            current = []
    if current:
        segments.append(CaptionSegment(
            text=" ".join(cw.word for cw in current),
            start=max(0.0, current[0].start - clip.start),
            end=max(0.0, current[-1].end - clip.start),
            words=[WordTimestamp(cw.word, max(0.0, cw.start - clip.start), max(0.0, cw.end - clip.start)) for cw in current],
        ))
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
                for cs in range(int(t_start * 100), int(t_end * 100)):
                    # Store (word_list, active_index) for inline per-word highlight
                    timeline[cs] = (list(words), i)
        else:
            for cs in range(int(seg.start * 100), int(seg.end * 100)):
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
        img = img.resize((target_w, target_h), resample=3)
    return img


def _draw_caption(img, t: float, caption_timeline: dict, style: str, width: int, height: int, font_main, font_highlight, cfg):
    from PIL import ImageDraw
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

    draw = ImageDraw.Draw(img, "RGBA")

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
        """Draw words in a single row; active word gets yellow pill, others white."""
        GAP = 8
        PAD_X, PAD_Y = 14, 8
        RADIUS = 10
        font = font_highlight if bold else font_main
        word_sizes = []
        for w in words:
            bb = draw.textbbox((0, 0), w, font=font)
            word_sizes.append((bb[2] - bb[0], bb[3] - bb[1]))

        total_w = sum(ws[0] + PAD_X * 2 for ws in word_sizes) + GAP * (len(words) - 1)
        x = (width - total_w) // 2
        row_h = max(ws[1] for ws in word_sizes) if word_sizes else font_size

        for i, (w, (tw, th)) in enumerate(zip(words, word_sizes)):
            pill_w = tw + PAD_X * 2
            pill_h = th + PAD_Y * 2
            pill_y = y + (row_h - pill_h) // 2

            if i == active_idx:
                draw.rounded_rectangle([x, pill_y, x + pill_w, pill_y + pill_h],
                                       radius=RADIUS, fill=(245, 197, 24, 240))
                txt_color = (0, 0, 0, 255)
            else:
                txt_color = (255, 255, 255, 230)

            wx = x + PAD_X
            wy = pill_y + PAD_Y
            if i != active_idx:
                draw.text((wx + 2, wy + 2), w, font=font, fill=(0, 0, 0, 120))
            draw.text((wx, wy), w, font=font, fill=txt_color)
            x += pill_w + GAP

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

    with av.open(output_path, "w", format="mp4") as dst:
        out_v = dst.add_stream("h264", rate=int(fps))
        out_v.width = target_width
        out_v.height = target_height
        out_v.pix_fmt = "yuv420p"
        out_v.options = {"crf": str(VIDEO_CRF), "preset": "fast"}

        ch_layout = "stereo" if meta.audio_channels >= 2 else "mono"
        out_a = None
        if meta.has_audio:
            out_a = dst.add_stream("aac", rate=meta.audio_sample_rate, layout=ch_layout)
            out_a.bit_rate = AUDIO_BITRATE

        # Video pass
        with av.open(source_path) as src:
            v_stream = next((s for s in src.streams if s.type == "video"), None)
            if v_stream:
                src.seek(int(clip.start * 1_000_000))
                for frame in src.decode(v_stream):
                    t = float(frame.pts * v_stream.time_base)
                    if t < clip.start - 0.05:
                        continue
                    if t > clip.end + 0.05:
                        break
                    t_in_clip = t - clip.start
                    img = frame.to_image().convert("RGB")
                    if crop_mode:
                        img = _crop_frame(img, crop_mode, target_width, target_height)
                    if caption_timeline:
                        img = _draw_caption(img, max(t_in_clip, 0), caption_timeline, style,
                                            target_width, target_height, font_main, font_highlight, cfg)
                    new_frame = av.VideoFrame.from_image(img)
                    new_frame.pts = frame_idx
                    new_frame.time_base = Fraction(1, int(fps))
                    frame_idx += 1
                    for pkt in out_v.encode(new_frame):
                        dst.mux(pkt)
        for pkt in out_v.encode(None):
            dst.mux(pkt)

        # Audio pass
        if out_a:
            audio_sample_idx = 0
            with av.open(source_path) as src:
                a_stream = next((s for s in src.streams if s.type == "audio"), None)
                if a_stream:
                    src.seek(int(clip.start * 1_000_000))
                    for frame in src.decode(a_stream):
                        t = float(frame.pts * a_stream.time_base)
                        if t < clip.start - 0.1:
                            continue
                        if t > clip.end + 0.1:
                            break
                        frame.pts = audio_sample_idx
                        frame.dts = audio_sample_idx
                        frame.time_base = Fraction(1, meta.audio_sample_rate)
                        audio_sample_idx += frame.samples
                        for pkt in out_a.encode(frame):
                            dst.mux(pkt)
            for pkt in out_a.encode(None):
                dst.mux(pkt)

    if not Path(output_path).exists() or Path(output_path).stat().st_size < 1000:
        raise RuntimeError(f"Clip render produced empty file: {output_path}")


def _generate_thumbnail(source_path: str, clip: ClipResult, output_path: str) -> None:
    import av
    midpoint = clip.start + (clip.end - clip.start) / 2
    with av.open(source_path) as src:
        v_stream = next((s for s in src.streams if s.type == "video"), None)
        if not v_stream:
            return
        src.seek(int(midpoint * 1_000_000))
        for frame in src.decode(v_stream):
            img = frame.to_image()
            img.save(output_path, "JPEG", quality=90)
            break


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


def _ai_generate_clip_content(
    clip: "ClipResult",
    transcript_snippet: str,
    platforms: list[str],
    captions_srt: str = "",
) -> dict:
    """Return {title, description, tags} per platform using Groq LLM."""
    groq_key = os.getenv("GROQ_API_KEY", "")
    if not groq_key:
        return {}

    # Prefer SRT-derived text (always available) over word-window snippet
    transcript = _srt_to_plain(captions_srt) if captions_srt else transcript_snippet
    if not transcript.strip():
        transcript = f"[Hook: {clip.reason}]" if clip.reason else "[no transcript]"

    platforms_str = ", ".join(platforms) if platforms else "tiktok, reels, shorts"
    prompt = f"""You are a viral social media content strategist. Generate platform-optimized content for this video clip.

Clip hook: {clip.reason or clip.title}
Transcript: {transcript[:600]}

Platforms to generate for: {platforms_str}

Rules:
- Title: punchy, 6-10 words, no hashtags, creates curiosity or urgency
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
  "title": "<viral clip title>",
  "platforms": {{
    "<platform_name>": {{
      "description": "<description>",
      "tags": ["tag1", "tag2"]
    }}
  }}
}}"""

    try:
        from groq import Groq
        client = Groq(api_key=groq_key)
        resp = client.chat.completions.create(
            model=GROQ_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=max(1500, len(platforms) * 400),
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content)
        # Validate structure
        if "platforms" not in result or not result["platforms"]:
            raise ValueError("empty platforms in response")
        return result
    except Exception as e:
        logging.warning(f"_ai_generate_clip_content failed: {e}")
        return {}


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
) -> str | None:
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
    quality_tier = cfg.get("output_quality", "1080p")
    cap = QUALITY_CAP.get(quality_tier)
    if cap is not None:
        long_edge = max(target_w, target_h)
        if long_edge > cap:
            scale = cap / long_edge
            target_w = int(target_w * scale) & ~1  # keep even
            target_h = int(target_h * scale) & ~1

    burn_captions = cfg.get("add_captions", True)
    style = cfg.get("caption_style", "capcut")
    if style not in CAPTION_STYLE_CFG:
        style = "capcut"

    _render_clip(
        source_path=source_path,
        clip=clip,
        output_path=clip_path,
        captions=captions,
        style=style,
        target_width=target_w,
        target_height=target_h,
        crop_mode=crop_mode,
        meta=meta,
        burn_captions=burn_captions,
    )

    try:
        _generate_thumbnail(source_path, clip, thumb_path)
    except Exception:
        pass

    from shared.storage.base import get_storage
    storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
    storage_key = f"clips/{tenant_id}/{clip_id}.mp4"
    with open(clip_path, "rb") as f:
        storage_url = asyncio.run(storage.upload(f, storage_key, "video/mp4"))

    thumb_url = None
    if Path(thumb_path).exists():
        thumb_key = f"clips/{tenant_id}/{clip_id}_thumb.jpg"
        with open(thumb_path, "rb") as f:
            thumb_url = asyncio.run(storage.upload(f, thumb_key, "image/jpeg"))

    srt_content = _generate_srt(captions)

    # Build transcript snippet from words in clip window (fallback if no SRT)
    snippet = ""
    if words:
        clip_words = [w.word for w in words if clip.start <= w.start <= clip.end]
        snippet = " ".join(clip_words[:80])

    platforms = cfg.get("platforms", ["tiktok", "reels", "shorts"])
    ai_content = _ai_generate_clip_content(clip, snippet, platforms, captions_srt=srt_content or "")
    ai_title = ai_content.get("title") or clip.title
    clip_meta = {
        "ai_title": ai_title,
        "platforms": ai_content.get("platforms", {}),
    }

    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                INSERT INTO clips
                  (id, tenant_id, video_id, title, start_sec, end_sec,
                   start_ms, end_ms, duration_ms, platform, score, status,
                   storage_url, thumbnail_url, caption_srt, metadata, created_at, updated_at)
                VALUES
                  (:id, CAST(:tid AS uuid), CAST(:vid AS uuid), :title, :ss, :es,
                   :sms, :ems, :dur, :plat, :score, 'ready',
                   :url, :thumb, :srt, CAST(:meta AS jsonb), NOW(), NOW())
            """),
            {
                "id": clip_id, "tid": tenant_id, "vid": video_id,
                "title": ai_title,
                "ss": clip.start, "es": clip.end,
                "sms": int(clip.start * 1000), "ems": int(clip.end * 1000),
                "dur": int((clip.end - clip.start) * 1000),
                "plat": clip.platform,
                "score": float(clip.score),
                "url": storage_url,
                "thumb": thumb_url,
                "srt": srt_content,
                "meta": json.dumps(clip_meta),
            },
        )

    try:
        Path(clip_path).unlink(missing_ok=True)
        Path(thumb_path).unlink(missing_ok=True)
    except Exception:
        pass

    return clip_id


# ── YouTube download ──────────────────────────────────────────────────────────

def _download_youtube(url: str, out_path: str, quality: str = "1080p") -> None:
    errors = []
    # For source quality use uncapped best; otherwise cap to requested resolution
    if quality == "source":
        fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    else:
        cap = {"1080p": 1080, "720p": 720, "480p": 480}.get(quality, 1080)
        fmt = (
            f"bestvideo[height<={cap}][ext=mp4]+bestaudio[ext=m4a]"
            f"/best[height<={cap}][ext=mp4]/best[ext=mp4]/best"
        )
    ytdlp_strategies = [
        ["yt-dlp", "--js-runtimes", "node",
         "--extractor-args", "youtube:player_client=android",
         "-f", fmt,
         "--merge-output-format", "mp4", "--no-check-certificate",
         "--retries", "3", "-o", out_path, url],
        ["yt-dlp", "--js-runtimes", "node",
         "--extractor-args", "youtube:player_client=mweb",
         "-f", "best[ext=mp4]/best", "--merge-output-format", "mp4",
         "--no-check-certificate", "--retries", "3", "-o", out_path, url],
        ["yt-dlp", "-f", "best[ext=mp4]/best", "--merge-output-format", "mp4",
         "--no-check-certificate", "--retries", "3",
         "--user-agent", "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36",
         "-o", out_path, url],
    ]
    for cmd in ytdlp_strategies:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
                return
            errors.append(f"yt-dlp: {result.stderr[:200]}")
        except subprocess.TimeoutExpired:
            errors.append("yt-dlp: timeout")
        except Exception as e:
            errors.append(f"yt-dlp: {e}")

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
                    result = subprocess.run(
                        ["yt-dlp", "--skip-download", sub_type,
                         "--sub-lang", lang, "--sub-format", "vtt",
                         "--no-check-certificate", "-o", out_tmpl, url],
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


def run_video_pipeline(tenant_id: str, video_id: str, source_path: str, job_id: str, cfg: dict | None = None, yt_url: str | None = None) -> None:
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

    output_quality = cfg.get("output_quality", "1080p")
    if output_quality == "source":
        _publish_progress(job_id, "metadata", 5, "processing",
                          "Full resolution selected — export will take longer than usual.")

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

    if _check_cancelled(tenant_id, video_id):
        return

    # Step 3: AI clip selection (50%)
    _publish_progress(job_id, "scoring", 40, "processing", "Step 1: AI analyzing transcript for viral signals...")
    _update_video(tenant_id, video_id, pipeline_step="scoring", pipeline_pct=40)

    clips = _ai_score_clips(
        words, meta.duration, num_clips, min_dur, max_dur,
        min_score_10=min_score_10,
        topic_focus=topic_focus,
        platforms=platforms,
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
    all_captions: dict[str, list[CaptionSegment]] = {}
    for clip in clips:
        segs = _generate_captions(words, clip, max_words=words_per_line)
        all_captions[clip.title] = segs

    if _check_cancelled(tenant_id, video_id):
        return

    # Step 5: Export clips (60→95%)
    if output_quality == "source":
        _publish_progress(job_id, "export", 60, "processing",
                          f"Exporting {len(clips)} clips at full source resolution — this may take a while...")
    clip_ids = []
    for i, clip in enumerate(clips):
        if _check_cancelled(tenant_id, video_id):
            _publish_progress(job_id, "cancelled", 0, "cancelled", "Job cancelled by user.")
            return
        pct = 60 + int((i / max(len(clips), 1)) * 35)
        _publish_progress(job_id, "export", pct, "processing",
                          f"Rendering clip {i+1}/{len(clips)}: {clip.title}")
        _update_video(tenant_id, video_id, pipeline_step="export", pipeline_pct=pct)
        try:
            captions = all_captions.get(clip.title, [])
            clip_id = _export_clip(
                tenant_id=tenant_id, video_id=video_id,
                clip=clip, captions=captions,
                source_path=source_path, work_dir=work_dir,
                meta=meta, cfg=cfg, words=words,
            )
            if clip_id:
                clip_ids.append(clip_id)
        except Exception as e:
            _publish_progress(job_id, "export", pct, "processing",
                              f"Clip {i+1} failed: {str(e)[:120]}, continuing...")

    _update_video(tenant_id, video_id, status="ready", pipeline_step="complete", pipeline_pct=100)
    _publish_progress(job_id, "complete", 100, "complete",
                      f"Done! {len(clip_ids)}/{len(clips)} clips ready.")


# ── Celery tasks ──────────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="workers.tasks.video.process_uploaded_video",
                 queue="viralo.video.generate", acks_late=True, max_retries=3,
                 time_limit=1800, soft_time_limit=1700)
def process_uploaded_video(self, tenant_id: str, video_id: str, file_path: str | None, cfg: dict | None = None):
    job_id = self.request.id or video_id
    cfg = cfg or {}
    try:
        if not file_path or not Path(file_path).exists():
            raise FileNotFoundError(f"Source file not found: {file_path}")
        _update_video(tenant_id, video_id, status="processing",
                      celery_task_id=job_id, pipeline_step="upload", pipeline_pct=5)
        _publish_progress(job_id, "upload", 5, "processing", "File received, starting pipeline...")
        run_video_pipeline(tenant_id, video_id, file_path, job_id, cfg)
    except Exception as exc:
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed")
        _publish_progress(job_id, "failed", 0, "failed", str(exc)[:300])
        raise self.retry(exc=exc, countdown=30)


@celery_app.task(bind=True, name="workers.tasks.video.process_youtube_video",
                 queue="viralo.video.generate", acks_late=True, max_retries=3,
                 time_limit=1800, soft_time_limit=1700)
def process_youtube_video(self, tenant_id: str, video_id: str, url: str, cfg: dict | None = None):
    job_id = self.request.id or video_id
    cfg = cfg or {}
    try:
        _update_video(tenant_id, video_id, status="processing",
                      celery_task_id=job_id, pipeline_step="download", pipeline_pct=5)
        _publish_progress(job_id, "download", 5, "processing", "Downloading YouTube video...")

        work_dir = Path(VIDEO_TEMP_DIR) / video_id
        work_dir.mkdir(parents=True, exist_ok=True)
        out_path = str(work_dir / "source.mp4")

        _download_youtube(url, out_path, quality=cfg.get("output_quality", "1080p"))
        _publish_progress(job_id, "download", 15, "processing", "Download complete, processing...")
        run_video_pipeline(tenant_id, video_id, out_path, job_id, cfg, yt_url=url)
    except Exception as exc:
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed")
        _publish_progress(job_id, "failed", 0, "failed", str(exc)[:300])
        raise self.retry(exc=exc, countdown=30)
