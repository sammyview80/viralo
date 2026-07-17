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
from workers.tasks.video.transcribe import *
from workers.tasks.video.ai import *
from workers.tasks.video.render import *
from workers.tasks.video.download import *
from workers.tasks.video.pipeline import *

__all__ = [
    'generate_viral_clips',
    'upload_clip_to_storage',
    'process_uploaded_video',
    'process_youtube_video',
    'concat_top_clips',
    'merge_ai_clips',
    'generate_video_ranking',
    'render_clip_with_edits',
    '_COOKIE_WARM_URL',
    '_alert_dead_cookies',
    'prune_source_cache',
    'refresh_youtube_cookies',
]

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

        # Trim to max duration instead of failing, then notify user
        try:
            probe = _probe_video(source)
            if probe.duration > MAX_VIDEO_DURATION_SEC and not _is_unlimited(tenant_id):
                mins = probe.duration / 60
                _publish_progress(job_id, "upload", 10, "processing",
                                   f"Video is {mins:.0f} min long, trimming to "
                                   f"{MAX_VIDEO_DURATION_SEC // 60} min...")
                trimmed_path = str(Path(source).with_name(f"{video_id}_trimmed.mp4"))
                has_audio = _media_has_audio_stream(source)
                cmd = _build_precise_trim_command(
                    source, trimmed_path, 0.0, float(MAX_VIDEO_DURATION_SEC), has_audio
                )
                subprocess.run(cmd, check=True, capture_output=True, timeout=300)
                os.replace(trimmed_path, source)  # keep original filename so downstream cleanup still finds it
                _notify_video(
                    tenant_id, video_id, "video_trimmed", "Video trimmed",
                    f"Your video was {mins:.0f} minutes long. We trimmed it to the first "
                    f"{MAX_VIDEO_DURATION_SEC // 60} minutes (max supported length)."
                )
        except Exception:
            pass  # probe/trim failure is non-fatal; pipeline will probe again

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
    # Quality is no longer user-selectable — always fetch & render the highest
    # available source. Override whatever the client sent.
    cfg["output_quality"] = "source"
    # Strip playlist params — yt-dlp hangs enumerating playlists
    _p = urlparse(url)
    _qs = {k: v[0] for k, v in parse_qs(_p.query).items() if k not in ("list", "index", "start_radio")}
    url = _urlunparse(_p._replace(query=urlencode(_qs)))
    # Idempotency: a redelivered task (worker crash + acks_late requeue) must not
    # re-process a video that already finished or was cancelled.
    try:
        with _get_session(tenant_id) as _s:
            _row = _s.execute(
                text("SELECT status FROM videos WHERE id = CAST(:vid AS uuid)"),
                {"vid": video_id}).fetchone()
        if _row and _row[0] in ("ready", "completed", "cancelled"):
            logging.info("process_youtube_video: video %s already %s — skipping redelivery",
                         video_id, _row[0])
            return
    except Exception as _e:
        logging.warning("idempotency check failed for %s: %s", video_id, _e)
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

        # Source cache: a public video is byte-identical across tenants/jobs, so reuse
        # a previously downloaded source instead of re-running the 8-tier client dance.
        from workers.tasks import source_cache
        yt_id = source_cache.youtube_id(url)
        won_client = None
        _cache_thread = None
        cache_meta = source_cache.fetch_to(yt_id, out_path)
        if cache_meta:
            won_client = cache_meta.get("won_client")
            _publish_progress(job_id, "download", 14, "processing",
                              "Source found in cache — skipping download.")
        else:
            # Per-id lock so two concurrent jobs for the same URL don't both download.
            got_lock = source_cache.acquire_lock(yt_id)
            try:
                if not got_lock:
                    cache_meta = source_cache.wait_for(yt_id, out_path)
                if cache_meta:
                    won_client = cache_meta.get("won_client")
                    _publish_progress(job_id, "download", 14, "processing",
                                      "Source found in cache — skipping download.")
                else:
                    won_client = _download_youtube(
                        url, out_path, quality=cfg.get("output_quality", "source"),
                        progress_cb=_on_download_progress, tenant_id=str(tenant_id))
                    # Cache upload (often 100MB+ to Cloudinary, ~15s) off the critical
                    # path: a background thread overlaps the transcribe/score/render
                    # pipeline below instead of blocking before it. Joined after the
                    # pipeline (the source file lives through the whole task).
                    import threading as _thr
                    _cache_thread = _thr.Thread(
                        target=source_cache.store, args=(yt_id, out_path),
                        kwargs={"won_client": won_client}, daemon=True)
                    _cache_thread.start()
            finally:
                if got_lock:
                    source_cache.release_lock(yt_id)
        # tv / mweb / web_safari / android_vr all carry the full HD/4K adaptive ladder.
        # Only web / ios / pytubefix are 360p-capped fallbacks that win when every HD
        # client failed — warn the user only in that case.
        _HD_CLIENTS = {"tv", "mweb", "web_safari", "android_vr"}
        if won_client and won_client not in _HD_CLIENTS:
            warn = ("High-quality (TV) source was unavailable for this video — "
                    f"downloaded a standard-quality stream via the {won_client} client.")
            logging.warning(warn)
            _publish_progress(job_id, "download", 15, "processing", warn)
            try:
                _notify_video(tenant_id, video_id, "video_quality_downgraded",
                              "Standard quality used", warn)
            except Exception:
                pass
        _publish_progress(job_id, "download", 15, "processing", "Download complete, processing...")
        run_video_pipeline(tenant_id, video_id, out_path, job_id, cfg, yt_url=url, yt_meta=meta)
        # Ensure the backgrounded source-cache upload finished before the task ends
        # (and the work dir is reclaimed). It has been overlapping the pipeline above.
        if _cache_thread is not None:
            _cache_thread.join(timeout=120)
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
                    _build_precise_trim_command(
                        source_path=source_path,
                        output_path=out_path,
                        start_sec=merged_start,
                        end_sec=merged_end,
                        has_audio=_media_has_audio_stream(source_path),
                    ),
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

    job_id = self.request.id or video_id
    last_pct = 0

    def emit_progress(step: str, pct: int, status: str, message: str, **video_fields) -> None:
        nonlocal last_pct
        last_pct = max(last_pct, pct)
        _update_video(
            tenant_id,
            video_id,
            status="ready" if status == "complete" else status,
            pipeline_step=step,
            pipeline_pct=last_pct,
            **video_fields,
        )
        _publish_progress(job_id, step, last_pct, status, message)

    tmpdir = None
    try:
        emit_progress(
            "starting",
            2,
            "processing",
            "Preparing ranking video...",
            celery_task_id=job_id,
            error_message=None,
        )

        n = len(segments)
        badges = list(range(n, 0, -1)) if order == "countdown" else list(range(1, n + 1))
        tmpdir = tempfile.mkdtemp(prefix="viralo_ranking_")
        source_paths = []
        for i, seg in enumerate(segments):
            emit_progress(
                "downloading",
                5 + int(i / n * 15),
                "processing",
                f"Loading source {i + 1}/{n}...",
            )
            src_path = os.path.join(tmpdir, f"src_{i}.mp4")
            if seg.get("source_type") == "upload" and seg.get("video_id"):
                _download_stored_video(seg["video_id"], tenant_id, src_path)
            elif seg.get("url"):
                _download_youtube(seg["url"], src_path)  # handles YouTube, TikTok, Instagram via yt-dlp
            else:
                raise ValueError(f"Segment {i} has no url or video_id")
            source_paths.append(src_path)

        emit_progress("rendering", 20, "processing", f"Rendering 0/{n} segments...")
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
        with ThreadPoolExecutor(max_workers=min(n, 4)) as pool:
            futs = {pool.submit(render_one, i): i for i in range(n)}
            for completed, fut in enumerate(as_completed(futs), start=1):
                fut.result()
                emit_progress(
                    f"rendered_{completed}",
                    20 + int(completed / n * 50),
                    "processing",
                    f"Rendered {completed}/{n} segments",
                )

        emit_progress("concatenating", 75, "processing", "Joining ranking segments...")
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

        emit_progress("uploading", 88, "processing", "Uploading ranking video...")
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
                text("UPDATE videos SET storage_url=:url, updated_at=NOW() WHERE id = CAST(:vid AS uuid)"),
                {"url": storage_url, "vid": video_id},
            )

        # Generate platform captions (same as clip pipeline)
        emit_progress("captions", 95, "processing", "Generating platform captions...")
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

        emit_progress("complete", 100, "complete", "Ranking video ready")
        _publish_clip_event(job_id, "clip_ready", {"clip_id": clip_id, "video_id": video_id})
        return {"clip_id": clip_id, "storage_key": storage_key}

    except Exception as exc:
        logging.exception("generate_video_ranking failed")
        message = f"Ranking video generation failed: {str(exc)[:250]}"
        try:
            emit_progress("failed", last_pct, "failed", message, error_message=message)
        except Exception as update_exc:
            logging.warning("Could not persist ranking failure for %s: %s", video_id, update_exc)
            _publish_progress(job_id, "failed", last_pct, "failed", message)
        raise
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

# ── Editor server-side render ─────────────────────────────────────────────────

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
            trimmed_has_audio = _media_has_audio_stream(source_path)
            trim_cmd = _build_precise_trim_command(
                source_path=source_path,
                output_path=trimmed,
                start_sec=trim_start_sec,
                end_sec=trim_end_sec,
                has_audio=trimmed_has_audio,
            )
            r = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=300)
            if r.returncode != 0:
                raise RuntimeError(f"Trim failed: {r.stderr[-300:]}")

            _update_meta(conn, "processing", 30)

            # ── Step 2: Caption filter ────────────────────────────────
            render_captions, render_markers = _normalize_editor_timeline(
                captions,
                markers,
                trim_start_sec,
                trim_end_sec,
            )
            caption_filter = _build_caption_filter(render_captions)
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

            sound_cmd = _mix_sound_markers(
                trimmed,
                render_markers,
                final,
                qf,
                source_has_audio=trimmed_has_audio,
            )

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


# ── Cookie keep-warm ──────────────────────────────────────────────────────────

_COOKIE_WARM_URL = os.getenv("YT_COOKIE_WARM_URL", "https://www.youtube.com/watch?v=aqz-KE-bpKQ")


def _alert_dead_cookies(detail: str) -> None:
    """Loud, multi-channel alert when cookies are dead and need manual re-export."""
    logging.error(
        "YOUTUBE COOKIES DEAD — re-export yt-cookies.txt from a logged-in browser and "
        "redeploy. tv_embedded/web downloads will fail until then. Detail: %s", detail[:300]
    )
    hook = os.getenv("COOKIE_ALERT_WEBHOOK", "")
    if not hook:
        return
    try:
        import json as _json
        import urllib.request as _u
        body = _json.dumps({"text": f":warning: Viralo YouTube cookies are dead — re-export needed. {detail[:200]}"}).encode()
        req = _u.Request(hook, data=body, headers={"Content-Type": "application/json"})
        _u.urlopen(req, timeout=10).read()
    except Exception as e:
        logging.warning("_alert_dead_cookies webhook failed: %s", e)


@celery_app.task(
    bind=True,
    name="workers.tasks.video.prune_source_cache",
    queue="viralo.video.pipeline",
    acks_late=True,
    soft_time_limit=300,
    time_limit=360,
)
def prune_source_cache(self) -> dict:
    """Evict source-cache entries older than the TTL from storage + Redis index."""
    from workers.tasks import source_cache
    return {"pruned": source_cache.prune()}


@celery_app.task(
    bind=True,
    name="workers.tasks.video.reconcile_stuck_videos",
    queue="viralo.video.pipeline",
    acks_late=True,
    soft_time_limit=120,
    time_limit=150,
)
def reconcile_stuck_videos(self) -> dict:
    """Backstop for jobs orphaned by a worker crash / restart / OOM.

    task_reject_on_worker_lost requeues a killed task immediately, so this only
    catches the rare cases that slipped through (broker lost the message, the
    startup-race wedge, etc.). It re-enqueues faithfully from the row's own
    source_url + clip_config, bounded by a retry counter so it can't loop forever.

    Thresholds avoid false positives:
      - 'processing': only >65 min stale — PAST the 60-min hard time limit, so a
        still-running long job is never mistaken for dead.
      - 'queued'/'pending': >15 min — a task that never started executing.
    Runs tenantless (worker DB role owns the tables → RLS bypassed; if not, the
    query simply returns no rows and this is a safe no-op).
    """
    requeued = failed = 0
    try:
        with Session(engine) as s:
            rows = s.execute(text("""
                SELECT id, tenant_id, source_url, clip_config, status,
                       COALESCE((metadata->>'reconcile_retries')::int, 0) AS retries,
                       source_type
                FROM videos
                WHERE (status = 'processing' AND updated_at < NOW() - INTERVAL '65 minutes')
                   OR (status IN ('queued','pending') AND updated_at < NOW() - INTERVAL '15 minutes')
            """)).fetchall()
            for vid, tid, src_url, cfg, status_, retries, source_type in rows:
                if source_type == "ranking" and status_ in ("queued", "pending"):
                    continue
                if src_url and retries < 2:
                    s.execute(text("""
                        UPDATE videos
                        SET metadata = COALESCE(metadata,'{}'::jsonb)
                                       || jsonb_build_object('reconcile_retries', :r),
                            status='queued', pipeline_step='download', pipeline_pct=0,
                            error_message=NULL, updated_at=NOW()
                        WHERE id = :vid
                    """), {"r": retries + 1, "vid": vid})
                    s.commit()
                    celery_app.send_task(
                        "workers.tasks.video.process_youtube_video",
                        args=[str(tid), str(vid), src_url, cfg or {}])
                    requeued += 1
                    logging.warning("reconcile_stuck_videos: requeued video %s (was %s, retry %d)",
                                    vid, status_, retries + 1)
                else:
                    s.execute(text("""
                        UPDATE videos SET status='failed', pipeline_step='failed',
                            error_message='Processing was interrupted and could not be auto-recovered. Please retry.',
                            updated_at=NOW()
                        WHERE id = :vid
                    """), {"vid": vid})
                    s.commit()
                    failed += 1
                    logging.error("reconcile_stuck_videos: gave up on video %s (was %s, retries=%d)",
                                  vid, status_, retries)
    except Exception as e:
        logging.warning("reconcile_stuck_videos failed: %s", e)
    if requeued or failed:
        logging.info("reconcile_stuck_videos: requeued=%d failed=%d", requeued, failed)
    return {"requeued": requeued, "failed": failed}


@celery_app.task(
    bind=True,
    name="workers.tasks.video.refresh_youtube_cookies",
    queue="viralo.video.pipeline",
    acks_late=True,
    soft_time_limit=120,
    time_limit=150,
)
def refresh_youtube_cookies(self) -> dict:
    """Keep YouTube cookies alive. Runs a lightweight authenticated request directly
    against the live cookie store so yt-dlp writes the rotated cookies back, extending
    the session indefinitely. Alerts loudly if the cookies are truly dead.

    Returns {"status": "ok"|"dead"|"skip"|"locked", ...}.
    """
    # Serialize: only one keep-warm at a time (writeback must not race itself).
    lock = redis_client.set("yt:cookie-warm:lock", "1", nx=True, ex=140)
    if not lock:
        return {"status": "locked"}
    try:
        path = _active_cookies_path()
        if not path:
            logging.warning("refresh_youtube_cookies: no valid cookie store to refresh")
            return {"status": "skip", "reason": "no valid cookies"}
        # always refresh the live store (seed it from bundled if needed)
        if path == _COOKIES_BUNDLED:
            _seed_live_cookies()
            path = _COOKIES_LIVE if _is_valid_cookie_file(_COOKIES_LIVE) else _COOKIES_BUNDLED

        # Write back ATOMICALLY: yt-dlp rewrites the --cookies file in place
        # (non-atomic), so point it at a temp copy and os.replace() only on
        # success. Otherwise concurrent download readers see a half-written file
        # ("does not look like a Netscape format cookies file").
        import tempfile as _tf
        tmp = _tf.NamedTemporaryFile(suffix=".txt", delete=False, dir="/var/lib/yt", prefix=".warm-")
        tmp.write(Path(path).read_bytes())
        tmp.close()
        # --simulate: no download, just a metadata request that refreshes the session.
        # tv_embedded + PO token mirrors the real download path.
        cmd = (["yt-dlp", "--simulate", "--no-warnings",
                "--socket-timeout", "20", "--retries", "1",
                "--cookies", tmp.name]
               + _pot_args("tv_embedded")
               + ["--extractor-args", "youtube:player_client=tv_embedded",
                  "-f", "bestvideo+bestaudio/best", _COOKIE_WARM_URL])
        proxy = (_ytdlp_proxies() or [None])[0]
        if proxy:
            cmd += ["--proxy", proxy]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
            stderr = proc.stderr or ""
            if proc.returncode == 0 and Path(tmp.name).stat().st_size >= _MIN_COOKIE_BYTES:
                os.replace(tmp.name, path)  # atomic publish of refreshed cookies
                logging.info("refresh_youtube_cookies: session warm, cookies refreshed (%s)", path)
                return {"status": "ok"}
        finally:
            try:
                Path(tmp.name).unlink(missing_ok=True)
            except Exception:
                pass
        if _is_bad_cookies(stderr):
            _alert_dead_cookies(stderr.strip().splitlines()[-1] if stderr.strip() else "")
            return {"status": "dead", "detail": stderr[-200:]}
        # Non-cookie failure (bot block on this IP, dead proxy) — cookies may still be fine.
        logging.warning("refresh_youtube_cookies: non-cookie failure rc=%s: %s",
                        proc.returncode, stderr[-200:])
        return {"status": "ok", "note": "warm request failed but cookies not flagged dead"}
    except subprocess.TimeoutExpired:
        logging.warning("refresh_youtube_cookies: warm request timed out")
        return {"status": "ok", "note": "timeout"}
    except Exception as e:
        logging.warning("refresh_youtube_cookies: %s", e)
        return {"status": "error", "detail": str(e)[:200]}
    finally:
        try:
            redis_client.delete("yt:cookie-warm:lock")
        except Exception:
            pass
