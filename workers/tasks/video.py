import json
import os
import random
import subprocess
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://viralo:viralo@postgres:5432/viralo")
SYNC_DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")
VIDEO_TEMP_DIR = os.getenv("VIDEO_TEMP_DIR", "/tmp/viralo-video")

redis_client = redis.from_url(REDIS_URL)
engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)


@contextmanager
def _get_session(tenant_id: str):
    with Session(engine) as session:
        session.execute(text(f"SET LOCAL app.current_tenant = '{tenant_id}'"))
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


def _extract_metadata(source_path: str) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", source_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        return {"duration": 0, "resolution": "unknown"}
    try:
        data = json.loads(result.stdout)
        fmt = data.get("format", {})
        duration = float(fmt.get("duration", 0))
        video_stream = next(
            (s for s in data.get("streams", []) if s.get("codec_type") == "video"), {}
        )
        w = video_stream.get("width", 0)
        h = video_stream.get("height", 0)
        fps_raw = video_stream.get("r_frame_rate", "0/1")
        try:
            num, den = fps_raw.split("/")
            fps = round(int(num) / int(den), 2)
        except Exception:
            fps = 0
        return {
            "duration": duration,
            "resolution": f"{w}x{h}" if w and h else "unknown",
            "codec": video_stream.get("codec_name", "unknown"),
            "fps": fps,
        }
    except Exception:
        return {"duration": 0, "resolution": "unknown"}


def _extract_audio(source_path: str, output_path: str) -> None:
    subprocess.run(
        ["ffmpeg", "-i", source_path, "-vn", "-acodec", "mp3",
         "-ar", "16000", "-ac", "1", "-ab", "64k", output_path, "-y"],
        capture_output=True, timeout=300, check=True,
    )


def _transcribe_audio(audio_path: str) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        # Dev mock — generate fake word-level segments
        return {
            "text": "This is a mock transcript for development without an OpenAI API key.",
            "language": "en",
            "segments": [
                {"id": 0, "start": 0.0, "end": 5.0,
                 "text": "This is a mock transcript for development without an OpenAI API key.",
                 "words": [
                     {"word": "This", "start": 0.0, "end": 0.3},
                     {"word": "is", "start": 0.3, "end": 0.5},
                     {"word": "a", "start": 0.5, "end": 0.6},
                     {"word": "mock", "start": 0.6, "end": 0.9},
                     {"word": "transcript", "start": 0.9, "end": 1.4},
                 ]},
            ],
        }
    import openai
    client = openai.OpenAI(api_key=api_key)
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )
    return result.model_dump()


def _detect_scenes(source_path: str, duration: float) -> list[float]:
    """
    Return scene-change timestamps using low-res thumbnail extraction.
    Extracts 1 frame/sec as JPEG and compares frame brightness delta — fast on any arch.
    Falls back to evenly spaced timestamps on failure.
    """
    try:
        # Extract 1 fps thumbnails to detect scene changes via ffmpeg scene filter
        # Use scale=160:-1 so only tiny frames are decoded — very fast
        result = subprocess.run(
            [
                "ffmpeg", "-i", source_path,
                "-vf", "scale=160:-1,select='gt(scene,0.35)',showinfo",
                "-vsync", "vfr", "-frames:v", "200",
                "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=60,
        )
        timestamps = []
        for line in result.stderr.splitlines():
            if "pts_time:" in line and "showinfo" in line:
                for part in line.split():
                    if part.startswith("pts_time:"):
                        try:
                            t = float(part.split(":")[1])
                            if 0 < t < duration:
                                timestamps.append(round(t, 2))
                        except (ValueError, IndexError):
                            pass
        if len(timestamps) >= 2:
            return sorted(timestamps)
    except subprocess.TimeoutExpired:
        pass
    except Exception:
        pass

    # Fallback: evenly spaced every 30s
    if duration <= 0:
        duration = 60.0
    step = min(30.0, duration / 3)
    return [round(i * step, 2) for i in range(1, int(duration / step))]


def _build_candidate_clips(
    transcript: dict,
    scenes: list[float],
    metadata: dict,
    cfg: dict,
) -> list[dict]:
    """
    Build candidate clip windows from scene + sentence boundaries,
    respecting duration_min / duration_max from config.
    Returns list of {start_sec, end_sec, text}.
    """
    duration = float(metadata.get("duration", 60))
    segments = transcript.get("segments", [])
    dur_min = cfg.get("duration_min", 15)
    dur_max = cfg.get("duration_max", 60)

    sentence_ends = [seg.get("end", 0.0) for seg in segments if seg.get("end")]
    if not sentence_ends:
        sentence_ends = [duration / 2]

    cut_points = sorted(set([0.0] + [
        min(sentence_ends, key=lambda s: abs(s - t), default=t)
        for t in scenes
    ] + [duration]))

    candidates = []
    i = 0
    while i < len(cut_points) - 1:
        start = cut_points[i]
        j = i + 1
        while j < len(cut_points) - 1 and (cut_points[j] - start) < dur_min:
            j += 1
        end = min(cut_points[j], start + dur_max)
        clip_dur = end - start
        if clip_dur >= max(5, dur_min * 0.5):
            window_text = " ".join(
                seg.get("text", "").strip()
                for seg in segments
                if seg.get("start", 0) >= start - 1 and seg.get("end", 0) <= end + 1
            )
            candidates.append({"start_sec": round(start, 2), "end_sec": round(end, 2), "text": window_text})
        i = j
    return candidates


def _ai_score_clips(candidates: list[dict], cfg: dict, full_text: str) -> list[dict]:
    """
    Use Groq llama3 to score each candidate clip for virality/engagement.
    Returns candidates enriched with score, title, platform.
    Falls back to heuristic scoring if Groq unavailable.
    """
    import os, json as _json
    groq_key = os.getenv("GROQ_API_KEY", "")
    platforms = cfg.get("platforms", ["tiktok", "reels", "shorts"])
    topic_focus = cfg.get("topic_focus", "")
    max_clips = cfg.get("max_clips", 10)
    min_score = cfg.get("min_score", 0.5)

    if groq_key and candidates:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)

            # Send up to 30 candidates to AI — truncate text to save tokens
            batch = candidates[:30]
            items_json = _json.dumps([
                {"i": idx, "start": c["start_sec"], "end": c["end_sec"],
                 "text": c["text"][:300]}
                for idx, c in enumerate(batch)
            ])

            topic_line = f"Topic focus: {topic_focus}\n" if topic_focus else ""
            prompt = f"""You are a viral video editor. Score each clip segment for short-form social media virality.
{topic_line}Full transcript summary: {full_text[:500]}

Clips JSON:
{items_json}

Return ONLY a JSON array (no markdown) with one object per clip:
[{{"i": 0, "score": 0.87, "title": "Hook title under 60 chars", "platform": "tiktok", "reason": "one line"}}]

Rules:
- score 0.0-1.0 (hooks, emotional moments, surprising facts = high score)
- platform must be one of: {platforms}
- title: punchy, no hashtags
- keep only clips with genuine viral potential
- respond with valid JSON only"""

            resp = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=2000,
            )
            raw = resp.choices[0].message.content.strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            scores = _json.loads(raw)

            scored = []
            for s in scores:
                idx = s.get("i", 0)
                if idx < len(batch):
                    c = dict(batch[idx])
                    c["score"] = round(float(s.get("score", 0.5)), 2)
                    c["title"] = s.get("title") or c["text"][:50] or f"Clip {idx+1}"
                    c["platform"] = s.get("platform", platforms[idx % len(platforms)])
                    c["ai_reason"] = s.get("reason", "")
                    scored.append(c)

            # Filter by min_score, sort by score desc, cap at max_clips
            scored = sorted([c for c in scored if c["score"] >= min_score],
                            key=lambda x: x["score"], reverse=True)
            if scored:
                return scored[:max_clips]
        except Exception as e:
            pass  # fall through to heuristic

    # Heuristic fallback — score by text density + position bias
    scored = []
    for idx, c in enumerate(candidates):
        text = c.get("text", "")
        word_count = len(text.split())
        dur = c["end_sec"] - c["start_sec"]
        density = min(word_count / max(dur, 1) / 3, 1.0)  # words/sec normalized
        position_bias = 0.1 if c["start_sec"] < 30 else 0.0  # opening hook bonus
        score = round(min(density + position_bias + random.uniform(0.0, 0.15), 1.0), 2)
        words = text.split()
        title = " ".join(words[:6]) + ("..." if len(words) > 6 else "") or f"Clip {idx+1}"
        scored.append({**c, "score": score, "title": title,
                       "platform": platforms[idx % len(platforms)]})

    scored = sorted([c for c in scored if c["score"] >= min_score],
                    key=lambda x: x["score"], reverse=True)
    return scored[:max_clips] if scored else candidates[:max_clips]


def _smart_split(transcript: dict, scenes: list[float], metadata: dict, cfg: dict | None = None) -> list[dict]:
    """AI-powered clip selection respecting user config."""
    if cfg is None:
        cfg = {}
    candidates = _build_candidate_clips(transcript, scenes, metadata, cfg)
    full_text = transcript.get("text", "")
    clips = _ai_score_clips(candidates, cfg, full_text)

    if not clips:
        duration = float(metadata.get("duration", 60))
        clips = [{
            "start_sec": 0.0,
            "end_sec": min(float(cfg.get("duration_max", 60)), duration),
            "title": "Clip 1", "score": 0.75,
            "platform": cfg.get("platforms", ["tiktok"])[0],
        }]
    return clips


def _save_transcript(tenant_id: str, video_id: str, transcript: dict) -> None:
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
                "id": str(uuid.uuid4()),
                "tid": tenant_id,
                "vid": video_id,
                "lang": transcript.get("language", "en"),
                "segs": json.dumps(transcript.get("segments", [])),
                "txt": transcript.get("text", ""),
            },
        )


def _generate_srt(transcript: dict, start_sec: float, end_sec: float) -> str:
    """Generate SRT subtitle string for a clip window."""
    segments = transcript.get("segments", [])
    window_segs = [
        s for s in segments
        if s.get("end", 0) > start_sec and s.get("start", 0) < end_sec
    ]
    if not window_segs:
        dur = end_sec - start_sec
        return f"1\n00:00:00,000 --> {_fmt_srt(dur)}\n{transcript.get('text', '')[:100]}\n\n"

    lines = []
    for idx, seg in enumerate(window_segs, 1):
        t_start = max(0, seg.get("start", 0) - start_sec)
        t_end = max(t_start + 0.5, seg.get("end", 0) - start_sec)
        lines.append(f"{idx}\n{_fmt_srt(t_start)} --> {_fmt_srt(t_end)}\n{seg.get('text','').strip()}\n")
    return "\n".join(lines)


def _fmt_srt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _export_clip(
    tenant_id: str, video_id: str, clip_data: dict,
    source_path: str, work_dir: Path, transcript: dict,
) -> str | None:
    clip_id = str(uuid.uuid4())
    start = clip_data["start_sec"]
    end = clip_data["end_sec"]
    duration = end - start
    clip_path = str(work_dir / f"clip_{clip_id}.mp4")

    try:
        subprocess.run(
            [
                "ffmpeg", "-i", source_path,
                "-ss", str(start), "-t", str(duration),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,"
                       "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
                clip_path, "-y",
            ],
            capture_output=True, timeout=300, check=True,
        )
    except subprocess.CalledProcessError as e:
        # Try without forced aspect ratio if it fails
        subprocess.run(
            ["ffmpeg", "-i", source_path,
             "-ss", str(start), "-t", str(duration),
             "-c:v", "libx264", "-preset", "fast", "-c:a", "aac",
             clip_path, "-y"],
            capture_output=True, timeout=300, check=True,
        )

    srt_content = _generate_srt(transcript, start, end)

    # Upload to storage
    from shared.storage.base import get_storage
    storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))
    import asyncio
    storage_key = f"clips/{tenant_id}/{clip_id}.mp4"
    with open(clip_path, "rb") as f:
        storage_url = asyncio.run(storage.upload(f, storage_key, "video/mp4"))

    with _get_session(tenant_id) as session:
        session.execute(
            text("""
                INSERT INTO clips
                  (id, tenant_id, video_id, title, start_sec, end_sec,
                   start_ms, end_ms, duration_ms, platform, score, status,
                   storage_url, caption_srt, created_at, updated_at)
                VALUES
                  (:id, CAST(:tid AS uuid), CAST(:vid AS uuid), :title, :ss, :es,
                   :sms, :ems, :dur, :plat, :score, 'ready',
                   :url, :srt, NOW(), NOW())
            """),
            {
                "id": clip_id, "tid": tenant_id, "vid": video_id,
                "title": clip_data["title"],
                "ss": start, "es": end,
                "sms": int(start * 1000), "ems": int(end * 1000),
                "dur": int(duration * 1000),
                "plat": clip_data["platform"],
                "score": float(clip_data["score"]),
                "url": storage_url,
                "srt": srt_content,
            },
        )

    # Cleanup temp clip
    try:
        Path(clip_path).unlink(missing_ok=True)
    except Exception:
        pass

    return clip_id


def _download_youtube(url: str, out_path: str, job_id: str) -> None:
    """Download YouTube video with yt-dlp → pytubefix fallback chain."""
    errors = []

    # ── Strategy 1: yt-dlp with android player client (bypasses most 429s) ──
    ytdlp_strategies = [
        # Android client — most reliable bypass
        ["yt-dlp",
         "--js-runtimes", "node",
         "--extractor-args", "youtube:player_client=android",
         "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
         "--merge-output-format", "mp4",
         "--no-check-certificate",
         "--retries", "3",
         "-o", out_path, url],
        # mweb client fallback
        ["yt-dlp",
         "--js-runtimes", "node",
         "--extractor-args", "youtube:player_client=mweb",
         "-f", "best[ext=mp4]/best",
         "--merge-output-format", "mp4",
         "--no-check-certificate",
         "--retries", "3",
         "-o", out_path, url],
        # No JS runtime, no player override — bare minimal
        ["yt-dlp",
         "-f", "best[ext=mp4]/best",
         "--merge-output-format", "mp4",
         "--no-check-certificate",
         "--retries", "3",
         "--user-agent", "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36",
         "-o", out_path, url],
    ]

    for cmd in ytdlp_strategies:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
                return
            errors.append(f"yt-dlp ({cmd[3] if len(cmd) > 3 else 'bare'}): {result.stderr[:200]}")
        except subprocess.TimeoutExpired:
            errors.append("yt-dlp: timeout")
        except Exception as e:
            errors.append(f"yt-dlp: {e}")

    # ── Strategy 2: pytubefix ─────────────────────────────────────────────────
    try:
        from pytubefix import YouTube
        from pytubefix.cli import on_progress

        yt = YouTube(url, on_progress_callback=on_progress, use_oauth=False, allow_oauth_cache=False)
        stream = (
            yt.streams.filter(progressive=True, file_extension="mp4")
            .order_by("resolution").desc().first()
        )
        if not stream:
            stream = yt.streams.filter(file_extension="mp4").order_by("resolution").desc().first()
        if stream:
            out_dir = str(Path(out_path).parent)
            downloaded = stream.download(output_path=out_dir, filename="source.mp4")
            if Path(downloaded).exists() and Path(downloaded).stat().st_size > 0:
                return
        errors.append("pytubefix: no suitable stream found")
    except Exception as e:
        errors.append(f"pytubefix: {e}")

    # ── All strategies failed ─────────────────────────────────────────────────
    raise RuntimeError(
        f"YouTube download failed after all strategies.\n" + "\n".join(errors)
    )


def run_video_pipeline(tenant_id: str, video_id: str, source_path: str, job_id: str) -> None:
    work_dir = Path(VIDEO_TEMP_DIR) / video_id
    work_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Metadata (10%)
    _publish_progress(job_id, "metadata", 10, "processing", "Extracting video metadata...")
    metadata = _extract_metadata(source_path)
    _update_video(tenant_id, video_id,
                  duration_sec=int(metadata.get("duration", 0)),
                  resolution=metadata.get("resolution"),
                  pipeline_step="metadata", pipeline_pct=10)
    _save_step_artifact(tenant_id, video_id, "metadata", metadata)

    # Step 2: Audio (20%)
    _publish_progress(job_id, "audio", 20, "processing", "Extracting audio track...")
    audio_path = str(work_dir / "audio.mp3")
    _extract_audio(source_path, audio_path)
    _update_video(tenant_id, video_id, pipeline_step="audio", pipeline_pct=20)

    # Step 3: Transcribe (40%)
    _publish_progress(job_id, "transcribe", 30, "processing", "Transcribing with Whisper...")
    transcript = _transcribe_audio(audio_path)
    _save_transcript(tenant_id, video_id, transcript)
    _save_step_artifact(tenant_id, video_id, "transcript",
                        {"segments_count": len(transcript.get("segments", [])),
                         "language": transcript.get("language", "en")})
    _update_video(tenant_id, video_id, pipeline_step="transcribe", pipeline_pct=40)
    _publish_progress(job_id, "transcribe", 40, "processing",
                      f"Transcribed {len(transcript.get('text', ''))} chars in {transcript.get('language','en')}")

    # Step 4: Scene detection (55%)
    _publish_progress(job_id, "scenes", 50, "processing", "Detecting scene changes...")
    duration = float(metadata.get("duration", 60))
    scenes = _detect_scenes(source_path, duration)
    _update_video(tenant_id, video_id, pipeline_step="scenes", pipeline_pct=55)
    _publish_progress(job_id, "scenes", 55, "processing", f"Found {len(scenes)} scene change points")

    # Step 5: Smart split (65%)
    _publish_progress(job_id, "split", 60, "processing", "Generating clip boundaries...")
    clips = _smart_split(transcript, scenes, metadata)
    _update_video(tenant_id, video_id, pipeline_step="split", pipeline_pct=65)
    _publish_progress(job_id, "split", 65, "processing", f"Generated {len(clips)} clips")

    # Step 6: Export clips (65→95%)
    clip_ids = []
    for i, clip_data in enumerate(clips):
        pct = 65 + int((i / max(len(clips), 1)) * 30)
        _publish_progress(job_id, "export", pct, "processing",
                          f"Exporting clip {i+1}/{len(clips)}: {clip_data['title']}")
        try:
            clip_id = _export_clip(tenant_id, video_id, clip_data, source_path, work_dir, transcript)
            if clip_id:
                clip_ids.append(clip_id)
        except Exception as e:
            _publish_progress(job_id, "export", pct, "processing",
                              f"Clip {i+1} failed: {str(e)[:100]}, continuing...")

    # Done
    _update_video(tenant_id, video_id, status="ready", pipeline_step="complete", pipeline_pct=100)
    _publish_progress(job_id, "complete", 100, "complete",
                      f"Done! {len(clip_ids)}/{len(clips)} clips ready.")


@celery_app.task(bind=True, name="workers.tasks.video.process_uploaded_video",
                 queue="viralo.video.generate", acks_late=True, max_retries=3,
                 time_limit=1800, soft_time_limit=1700)
def process_uploaded_video(self, tenant_id: str, video_id: str, file_path: str | None):
    job_id = self.request.id or video_id
    try:
        if not file_path or not Path(file_path).exists():
            raise FileNotFoundError(f"Source file not found: {file_path}")
        _update_video(tenant_id, video_id, status="processing",
                      celery_task_id=job_id, pipeline_step="upload", pipeline_pct=5)
        _publish_progress(job_id, "upload", 5, "processing", "File received, starting pipeline...")
        run_video_pipeline(tenant_id, video_id, file_path, job_id)
    except Exception as exc:
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed")
        _publish_progress(job_id, "failed", 0, "failed", str(exc)[:300])
        raise self.retry(exc=exc, countdown=30)


@celery_app.task(bind=True, name="workers.tasks.video.process_youtube_video",
                 queue="viralo.video.generate", acks_late=True, max_retries=3,
                 time_limit=1800, soft_time_limit=1700)
def process_youtube_video(self, tenant_id: str, video_id: str, url: str):
    job_id = self.request.id or video_id
    try:
        _update_video(tenant_id, video_id, status="processing",
                      celery_task_id=job_id, pipeline_step="download", pipeline_pct=5)
        _publish_progress(job_id, "download", 5, "processing", "Downloading YouTube video...")

        work_dir = Path(VIDEO_TEMP_DIR) / video_id
        work_dir.mkdir(parents=True, exist_ok=True)
        out_path = str(work_dir / "source.mp4")

        _download_youtube(url, out_path, job_id)
        _publish_progress(job_id, "download", 15, "processing", "Download complete, processing...")
        run_video_pipeline(tenant_id, video_id, out_path, job_id)
    except Exception as exc:
        _update_video(tenant_id, video_id, status="failed", pipeline_step="failed")
        _publish_progress(job_id, "failed", 0, "failed", str(exc)[:300])
        raise self.retry(exc=exc, countdown=30)
