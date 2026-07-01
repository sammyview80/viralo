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


from workers.tasks.video._core import *
from workers.tasks.video.cookies import *

__all__ = [
    '_probe_video',
    '_extract_audio_bytes',
    '_prepare_audio_chunks',
    '_get_attr',
    '_parse_words',
    '_transcribe_chunk',
    '_transcribe',
    '_audio_energy_signals',
    '_speech_rate_signals',
    '_build_timed_transcript',
    '_CONTENT_TYPE_SIGNALS',
]

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


def _transcribe_chunk(groq_client, audio_bytes: bytes, filename: str, offset: float, language: str) -> tuple[list[WordTimestamp], str]:
    """Returns (words, detected_language). detected_language is ISO 639-1 or empty string."""
    detected_lang = ""
    try:
        response = groq_client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=GROQ_WHISPER_MODEL,
            language=language if language != "auto" else None,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )
        detected_lang = getattr(response, "language", "") or ""
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
                return [], ""
            tokens = text_val.split()
            dpw = max(0.3, 30.0 / max(len(tokens), 1))
            return [
                WordTimestamp(word=t, start=round(i * dpw + offset, 3), end=round((i + 1) * dpw + offset, 3))
                for i, t in enumerate(tokens)
            ], ""
        except Exception:
            return [], ""
    return _parse_words(response, offset), detected_lang


def _transcribe(source_path: str, duration: float, language: str = "auto") -> tuple[list[WordTimestamp], str]:
    """Returns (words, detected_language). detected_language is ISO 639-1 from Whisper or empty string."""
    from groq import Groq, RateLimitError as GroqRateLimitError

    groq_keys: list[str] = []
    for env in ["GROQ_API_KEY"] + [f"GROQ_API_KEY_{i}" for i in range(2, 20)]:
        k = os.getenv(env, "")
        if k and k not in groq_keys:
            groq_keys.append(k)

    if not groq_keys:
        return [], ""

    audio_chunks = _prepare_audio_chunks(source_path, duration)
    last_exc: Exception | None = None

    for key_idx, groq_key in enumerate(groq_keys):
        client = Groq(api_key=groq_key)
        label = "GROQ_API_KEY" if key_idx == 0 else f"GROQ_API_KEY_{key_idx + 1}"
        try:
            all_words: list[WordTimestamp] = []
            detected_lang = ""
            for i, (audio_bytes, offset) in enumerate(audio_chunks):
                fname = f"audio_chunk_{i}.mp3"
                words, chunk_lang = _transcribe_chunk(client, audio_bytes, fname, offset, language)
                all_words.extend(words)
                # Use first chunk's detected language (most reliable — full audio context)
                if not detected_lang and chunk_lang:
                    detected_lang = chunk_lang

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

            logging.info(f"[Whisper] Transcribed {len(all_words)} words via {label} (language={detected_lang or 'unknown'})")
            return all_words, detected_lang

        except GroqRateLimitError as e:
            logging.warning(f"[Whisper] {label} rate-limited — trying next key: {str(e)[:120]}")
            last_exc = e
            continue
        except Exception as e:
            logging.warning(f"[Whisper] {label} failed: {str(e)[:120]}")
            last_exc = e
            break

    logging.error(f"[Whisper] All Groq keys exhausted. Last error: {last_exc}")
    return [], ""


# ── LLM helpers: multi-provider fallback ─────────────────────────────────────

# ── LLM: delegate to shared.llm (Groq → Cloudflare → Cerebras → OpenRouter → SambaNova → Groq-small)
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

