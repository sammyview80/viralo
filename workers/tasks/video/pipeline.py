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
from datetime import UTC, datetime, timedelta
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
from workers.tasks.video.scene import _extract_scene_frames, _save_scene_frames
from workers.tasks.video.diarize import _diarize_audio, _assign_speakers_to_words, _save_speaker_segments
from workers.tasks.video.segment import _segment_topics, _save_topic_blocks
from workers.tasks.video.repair import _repair_all_clips

__all__ = [
    '_auto_schedule_clips',
    '_auto_publish_content',
    '_build_auto_publish_schedule',
    'run_video_pipeline',
    '_segments_to_words',
    '_gvc_inner',
    '_handle_timeout',
    '_reexport_clip_from_source',
    '_download_stored_video',
]


def _auto_publish_content(
    title: str,
    metadata: dict | str | None,
    platform: str,
    caption_template: str = "",
) -> tuple[str, list[str], dict]:
    """Reuse the clip's AI-generated social copy for a scheduled platform."""
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (TypeError, ValueError):
            metadata = {}
    metadata = metadata if isinstance(metadata, dict) else {}
    social = metadata.get("platforms")
    if not isinstance(social, dict):
        social = metadata.get("social")
    social = social if isinstance(social, dict) else {}
    platform_key = platform.lower()
    aliases = {
        "instagram": ("instagram", "reels"),
        "reels": ("reels", "instagram"),
        "youtube": ("youtube", "shorts", "youtube_shorts"),
        "youtube_shorts": ("youtube_shorts", "shorts", "youtube"),
        "shorts": ("shorts", "youtube", "youtube_shorts"),
        "x": ("x", "twitter"),
        "twitter": ("twitter", "x"),
    }.get(platform_key, (platform_key,))
    content = next(
        (social[key] for key in aliases if isinstance(social.get(key), dict)),
        {},
    )
    if not content:
        content = next(
            (value for value in social.values() if isinstance(value, dict)),
            {},
        )
    resolved_title = str(metadata.get("ai_title") or title or "").strip()
    description = str(content.get("description") or "").strip()
    raw_tags = content.get("tags") or metadata.get("trending_hashtags") or []
    raw_tags = raw_tags if isinstance(raw_tags, (list, tuple)) else []
    tags = list(dict.fromkeys(
        tag
        for item in raw_tags
        if (tag := str(item).strip().lstrip("#").lower())
    ))[:20]
    caption = (
        str(caption_template or "").strip()
        or description
        or str(metadata.get("viral_reason") or metadata.get("reason") or "").strip()
        or resolved_title
    )
    platform_kwargs = {}
    if platform_key in {"youtube", "youtube_shorts", "shorts"}:
        platform_kwargs = {
            "title": resolved_title[:100],
            "description": caption,
            "tags": tags,
        }
    return caption, tags, platform_kwargs


def _build_auto_publish_schedule(
    clip_count: int,
    ap_cfg: dict,
    now: datetime | None = None,
) -> list[datetime]:
    """Return bounded publish times, accepting legacy unvalidated configs."""
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)

    def bounded_int(key: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(ap_cfg.get(key, default))
        except (TypeError, ValueError):
            value = default
        return min(maximum, max(minimum, value))

    publish_per_day = bounded_int("publish_per_day", 3, 1, 10)
    interval_hours = bounded_int("publish_interval_hours", 8, 1, 24)
    interval_hours = min(interval_hours, max(1, 24 // publish_per_day))
    requested_start = current
    raw_start = ap_cfg.get("publish_start_at")
    if raw_start:
        try:
            requested_start = (
                raw_start
                if isinstance(raw_start, datetime)
                else datetime.fromisoformat(str(raw_start).replace("Z", "+00:00"))
            )
            if requested_start.tzinfo is None:
                requested_start = current
        except (TypeError, ValueError):
            requested_start = current

    base = max(current, requested_start)
    return [
        base + timedelta(days=day, hours=slot * interval_hours)
        for day, slot in (divmod(index, publish_per_day) for index in range(max(0, clip_count)))
    ]


def _auto_schedule_clips(tenant_id: str, clip_ids: list, ap_cfg: dict) -> None:
    """Create ScheduledPost records for auto-publish after a WebSub-triggered pipeline."""
    import uuid as _uuid

    platforms = ap_cfg.get("platforms", [])
    social_account_ids = ap_cfg.get("social_account_ids", [])
    caption_template = ap_cfg.get("caption_template", "")

    if not platforms and not social_account_ids:
        logging.info("_auto_schedule_clips: no platforms/accounts configured, skipping")
        return

    with _get_session(tenant_id) as db:
        # Resolve social_account_ids — fetch matching accounts for this tenant
        if social_account_ids:
            try:
                account_ids = [str(uuid.UUID(str(sid))) for sid in social_account_ids if sid]
            except (TypeError, ValueError):
                logging.warning("_auto_schedule_clips: invalid social account id, skipping")
                return
            rows = db.execute(
                text("""SELECT id, platform FROM social_accounts
                        WHERE tenant_id = CAST(:tid AS uuid) AND is_active = true
                          AND id = ANY(CAST(:account_ids AS uuid[]))"""),
                {"tid": tenant_id, "account_ids": account_ids},
            ).fetchall()
        elif platforms:
            platform_names = [str(platform).lower() for platform in platforms if platform]
            rows = db.execute(
                text("""SELECT id, platform FROM social_accounts
                        WHERE tenant_id = CAST(:tid AS uuid) AND is_active = true
                          AND platform = ANY(CAST(:platforms AS text[]))"""),
                {"tid": tenant_id, "platforms": platform_names},
            ).fetchall()
        else:
            rows = []

        if not rows:
            logging.info("_auto_schedule_clips: no active social accounts found for tenant %s", tenant_id)
            return

        now = datetime.now(UTC)
        posts_created = 0
        scheduled_times = _build_auto_publish_schedule(len(clip_ids), ap_cfg, now)
        clip_rows = db.execute(
            text("""SELECT id, title, metadata FROM clips
                    WHERE tenant_id = CAST(:tid AS uuid)
                      AND id = ANY(CAST(:clip_ids AS uuid[]))"""),
            {"tid": tenant_id, "clip_ids": [str(clip_id) for clip_id in clip_ids]},
        ).fetchall()
        clip_content = {
            str(clip_id): (title or "", metadata)
            for clip_id, title, metadata in clip_rows
        }

        # Spread ALL clips at publish_per_day/day: clip i lands on day i//per_day,
        # spaced interval_hours apart within the day. Every selected account gets
        # the clip at the same time.
        for clip_id, scheduled_at in zip(clip_ids, scheduled_times, strict=True):
            for account_id, platform in rows:
                title, metadata = clip_content.get(str(clip_id), ("", {}))
                caption, hashtags, platform_kwargs = _auto_publish_content(
                    title, metadata, platform, caption_template
                )
                db.execute(
                    text("""
                        INSERT INTO scheduled_posts
                            (id, tenant_id, clip_id, social_account_id, platform,
                             status, scheduled_at, caption, hashtags, platform_kwargs,
                             created_at, updated_at)
                        VALUES
                            (:id, :tid, :clip_id, :acct_id, :platform,
                             'scheduled', :scheduled_at, :caption,
                             CAST(:hashtags AS jsonb), CAST(:platform_kwargs AS jsonb),
                             now(), now())
                    """),
                    {
                        "id": _uuid.uuid4(),
                        "tid": tenant_id,
                        "clip_id": clip_id,
                        "acct_id": account_id,
                        "platform": platform,
                        "scheduled_at": scheduled_at,
                        "caption": caption or None,
                        "hashtags": json.dumps(hashtags),
                        "platform_kwargs": json.dumps(platform_kwargs),
                    },
                )
                posts_created += 1
    logging.info("_auto_schedule_clips: created %d scheduled posts for tenant %s", posts_created, tenant_id)


def _clamp_clip_durations(
    clips: list[ClipResult],
    min_dur: int,
    max_dur: int,
    video_duration: float,
) -> list[ClipResult]:
    """Hard-enforce the user's [min_dur, max_dur] length window.

    Scoring/repair are best-effort; this is the final guarantee that no persisted
    or exported clip violates the frontend-supplied bounds:
      - trim over-long clips to max_dur
      - extend too-short clips up to min_dur when the source has room
      - drop clips that still can't reach min_dur (source too short)
    """
    out: list[ClipResult] = []
    for c in clips:
        start = max(0.0, float(c.start))
        end = min(float(video_duration), float(c.end)) if video_duration else float(c.end)

        if end - start > max_dur:
            end = start + max_dur

        if end - start < min_dur:
            # try to grow forward, then backward, bounded by the source
            end = min(start + min_dur, video_duration) if video_duration else start + min_dur
            if end - start < min_dur:
                start = max(0.0, end - min_dur)
            if end - start < min_dur:
                logging.info(
                    "_clamp_clip_durations: dropping clip %.1f-%.1f — source too short for min %ds",
                    c.start, c.end, min_dur,
                )
                continue

        out.append(dataclass_replace(c, start=round(start, 3), end=round(end, 3)))
    return out


def run_video_pipeline(tenant_id: str, video_id: str, source_path: str, job_id: str, cfg: dict | None = None, yt_url: str | None = None, yt_meta: dict | None = None) -> None:
    cfg = cfg or {}
    work_dir = Path(VIDEO_TEMP_DIR) / video_id
    work_dir.mkdir(parents=True, exist_ok=True)

    language = cfg.get("language", "auto")
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

    # Stage 4b: Scene frame extraction
    _publish_progress(job_id, "scene_extraction", 12, "processing", "Extracting scene frames…")
    scene_frames = _extract_scene_frames(source_path, meta.duration, n_frames=10, tmp_dir=str(work_dir))

    words: list[WordTimestamp] = []
    speaker_segments: list[SpeakerSegment] = []
    topic_blocks: list[TopicBlock] = []

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
            # Burned karaoke captions need acoustic word-precision: Whisper aligns to the
            # audio waveform, while YouTube auto-caption timing is display-timed and drifts
            # noticeably on burn-in. So only use YT captions here when captions are NOT
            # being burned (then they're just transcript/analysis input — fast & fine).
            # Override with YT_CAPTIONS_FOR_BURN=1 to trade sync precision for speed.
            burn = bool(cfg.get("add_captions", False))
            force_yt = os.getenv("YT_CAPTIONS_FOR_BURN") == "1"
            words = _fetch_youtube_captions(yt_url, language) if (not burn or force_yt) else []
            if words:
                _publish_progress(job_id, "transcribe", 35, "processing",
                                  f"Using YouTube captions ({len(words)} words) — skipping AI transcription")
            else:
                _publish_progress(job_id, "transcribe", 20, "processing",
                                  "Transcribing with Groq Whisper for precise caption sync...")
                words, whisper_lang = _transcribe(source_path, meta.duration, language)
                if whisper_lang and language == "auto":
                    language = whisper_lang
                    logging.info("[Whisper] Auto-detected language: %s", language)
                _publish_progress(job_id, "transcribe", 35, "processing",
                                  f"Transcribed {len(words)} words via Whisper (lang={language})")
        else:
            _publish_progress(job_id, "transcribe", 20, "processing",
                              "Extracting audio + transcribing with Groq Whisper...")
            words, whisper_lang = _transcribe(source_path, meta.duration, language)
            if whisper_lang and language == "auto":
                language = whisper_lang
                logging.info("[Whisper] Auto-detected language: %s", language)
            _publish_progress(job_id, "transcribe", 35, "processing",
                              f"Transcribed {len(words)} words (lang={language})")

        if words:
            _save_transcript(tenant_id, video_id, words)

            # Stage 6: Speaker diarization
            _publish_progress(job_id, "diarization", 36, "processing", "Identifying speakers…")
            audio_path = str(work_dir / "audio.mp3")
            speaker_segments = _diarize_audio(audio_path if Path(audio_path).exists() else source_path, meta.duration)

            # Stage 7: Topic segmentation
            _publish_progress(job_id, "topic_segmentation", 38, "processing", "Segmenting topics…")
            topic_blocks = _segment_topics(words, llm_fn=_call_llm_json, max_topics=8)

        _update_video(tenant_id, video_id, pipeline_step="transcribe", pipeline_pct=38)
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
                # Auto-detect language from metadata when user didn't set one explicitly
                detected_lang = vid_meta.get("language_detected", "")
                if detected_lang and cfg.get("language") is None:
                    language = detected_lang
                    logging.info("Language auto-detected from transcript: %s", language)

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
        topic_blocks=topic_blocks,
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

    # Stage 10: Clip boundary repair — honor the user's requested length window
    # (defaults baked into repair.py are only used when bounds aren't supplied).
    clips = _repair_all_clips(clips, words, topic_blocks, float(min_dur), float(max_dur))
    clips = _clamp_clip_durations(clips, min_dur, max_dur, meta.duration)

    _update_video(tenant_id, video_id, pipeline_step="scoring", pipeline_pct=55)
    _publish_progress(job_id, "scoring", 55, "processing",
                      f"Selected {len(clips)} clips (aspect={cfg.get('aspect_ratio','9:16')})")

    # Step 4: Captions (60%)
    _publish_progress(job_id, "captions", 60, "processing", "Generating captions...")
    style = _effective_caption_style(cfg)
    words_per_line = 5 if style == "tiktok" else (3 if style in CAPCUT_STYLES else 6)
    all_captions: dict[int, list[CaptionSegment]] = {}
    for idx, clip in enumerate(clips):
        segs = _generate_captions(words, clip, max_words=words_per_line)
        all_captions[idx] = segs

    if _check_cancelled(tenant_id, video_id):
        return

    # Generate AI content for all clips in parallel before export
    _publish_progress(job_id, "ai_content", 58, "processing", f"Generating AI content for {len(clips)} clips...")
    all_ai_content = _batch_ai_content(clips, words, all_captions, platforms,
                                       content_type=_content_type, topic_focus=topic_focus,
                                       language=language)

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
                    from workers.tasks.video.tasks import upload_clip_to_storage
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

    # Persist new pipeline stage results to DB (best-effort)
    try:
        _save_scene_frames(tenant_id, video_id, scene_frames, engine)
        _save_speaker_segments(tenant_id, video_id, speaker_segments, engine)
        _save_topic_blocks(tenant_id, video_id, topic_blocks, engine)
    except Exception:
        logging.exception("Failed to persist pipeline stage results for video %s", video_id)

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


def _gvc_inner(self, tenant_id, video_id, job_id, cfg):
    num_clips   = int(cfg.get("max_clips", 5))
    min_dur     = int(cfg.get("duration_min", 15))
    max_dur     = int(cfg.get("duration_max", 60))
    min_score   = float(cfg.get("min_score", 0.5))
    topic_focus = cfg.get("topic_focus") or ""
    platforms   = cfg.get("platforms") or ["tiktok", "reels", "shorts"]
    language    = cfg.get("language", "auto")
    style       = _effective_caption_style(cfg)
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
            # See note above: burned captions use Whisper for acoustic sync; YT captions
            # only when not burning (or forced via YT_CAPTIONS_FOR_BURN=1).
            burn = bool(cfg.get("add_captions", False))
            force_yt = os.getenv("YT_CAPTIONS_FOR_BURN") == "1"
            words = _fetch_youtube_captions(yt_url, language) if (not burn or force_yt) else []
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
            words, whisper_lang = _transcribe(source_path, meta.duration, language)
            if whisper_lang and language == "auto":
                language = whisper_lang
                logging.info("[Whisper/_gvc] Auto-detected language: %s", language)
            transcript_source = "whisper"
            _publish_progress(job_id, "transcribe", 30, "processing",
                              f"Transcribed {len(words)} words via Whisper (lang={language})")

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
            # Use language from stored metadata when user didn't set one explicitly
            detected_lang = _meta.get("language_detected", "")
            if detected_lang and cfg.get("language") is None:
                language = detected_lang
                logging.info("_gvc_inner: language from stored metadata: %s", language)
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

    # Hard-enforce the user's requested length window before persisting.
    clips = _clamp_clip_durations(clips, min_dur, max_dur, duration)

    _publish_progress(job_id, "scoring", 60, "processing",
                      f"Found {len(clips)} viral clips (source={transcript_source})")

    # ── Step 3: Captions per clip ──────────────────────────────────────────────
    words_per_line = 5 if style == "tiktok" else (3 if style in CAPCUT_STYLES else 6)
    all_captions: dict[int, list[CaptionSegment]] = {}
    for idx, clip in enumerate(clips):
        all_captions[idx] = _generate_captions(words, clip, max_words=words_per_line)

    # ── Step 4: AI social content per clip (parallel) ─────────────────────────
    _publish_progress(job_id, "ai_content", 65, "processing",
                      f"Generating social content for {len(clips)} clips across {len(platforms)} platforms...")
    all_ai_content = _batch_ai_content(clips, words, all_captions, platforms,
                                       content_type=_gvc_content_type, topic_focus=topic_focus,
                                       language=language)

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

    subprocess.run(
        _build_precise_trim_command(
            source_path=source_path,
            output_path=out_path,
            start_sec=float(start_sec),
            end_sec=float(end_sec),
            has_audio=_media_has_audio_stream(source_path),
        ),
        check=True, capture_output=True,
    )


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
