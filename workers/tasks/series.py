"""Faceless-video Series — recurring AI-generated vertical videos, auto-posted.

A Series holds content config (niche/voice/music/art style/caption style) plus a
publish schedule. A beat task finds due series and enqueues generation; videos
are generated GENERATION_LEAD_HOURS before publish time so the user can review,
then scheduled_posts rows feed the existing publisher worker.

Generation pipeline (all free-tier / existing infra):
  script  -> shared LLM hierarchy (_call_llm_json)
  voice   -> edge-tts (per-scene, series.voice)
  visuals -> Pollinations image API per scene (free, no key), Pillow fallback
  video   -> ffmpeg Ken-Burns zoompan per scene + concat + music mix
  captions/thumbnail/clip row/upload -> existing _export_clip machinery
"""
import asyncio
import json
import logging
import math
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

GENERATION_LEAD_HOURS = int(os.getenv("SERIES_GENERATION_LEAD_HOURS", "6"))

# Art style key -> prompt suffix fed to the image generator
ART_STYLES = {
    "comic":          "comic book illustration, bold ink outlines, halftone shading, dramatic",
    "creepy-comic":   "dark horror comic illustration, heavy shadows, unsettling atmosphere, muted palette",
    "modern-cartoon": "modern flat cartoon illustration, vibrant colors, clean shapes",
    "disney":         "3d animated movie still, expressive characters, cinematic lighting, family-friendly",
    "anime":          "anime key visual, detailed background, cinematic composition",
    "realistic":      "photorealistic cinematic photo, shallow depth of field, dramatic lighting",
    "pixel":          "retro pixel art scene, 16-bit, detailed sprite work",
    "watercolor":     "soft watercolor painting, textured paper, gentle gradients",
}

# Preset niches: detailed prompt + house-style example script. The example teaches
# the LLM the pacing (cold-open hook question, short punchy lines, twist, button
# ending). Series-level example_script overrides the preset example.
_HEIST_EXAMPLE = (
    "Did you know one engineer spent 18 months infiltrating a rival company just to "
    "destroy it from within?\n"
    "He walked through the gates with fake credentials and a deadly plan.\n"
    "Posing as a quality control specialist, he had complete access to their production lines.\n"
    "For months, he introduced microscopic flaws invisible to standard inspection.\n"
    "Each sabotaged part was a ticking time bomb waiting to fail.\n"
    "The recall started small, then exploded into a 23 million dollar nightmare.\n"
    "But he wasn't done.\n"
    "During a fire drill, he slipped into the restricted R&D facility and photographed "
    "classified blueprints.\n"
    "The forensic team found his weakness: a distinctive welding signature on every part.\n"
    "At the airport, police arrested him with drives containing 12,000 stolen documents.\n"
    "His perfect infiltration was undone by the very craft that got him inside."
)

NICHE_PROMPTS: dict[str, dict] = {
    "crime-heists": {
        "prompt": (
            "a DOCUMENTED REAL criminal case or heist with dramatic execution and shocking "
            "aftermath. Rotate across: elaborate bank heists / vault penetrations / armored car "
            "robberies; art thefts / museum break-ins; jewel and diamond heists; casino robberies "
            "and money laundering schemes; corporate embezzlement and white-collar fraud; prison "
            "escapes and fugitive manhunts; organized crime operations; kidnapping and ransom "
            "cases; smuggling networks; counterfeiting and forgery rings; cybercrime and hacking "
            "operations; insurance fraud and staged-death schemes; cold cases with breakthrough "
            "investigations; undercover operations gone wrong; international crime syndicates. "
            "Emphasize meticulous planning, reconnaissance and inside information; sophisticated "
            "tools and professional execution; the law-enforcement response, forensic "
            "breakthroughs and courtroom outcomes; recovered goods, financial losses and long-term "
            "consequences. Feature cat-and-mouse detective work, betrayals and double-crosses, "
            "criminal ingenuity vs investigative excellence. Include specific methodology details, "
            "the security vulnerabilities exploited, the breakthrough moment, and the sentence. "
            "IT IS EXTREMELY IMPORTANT THAT THE STORY IS BASED ON REAL, DOCUMENTED EVENTS — real "
            "names, real dates, real outcomes. Never invent a case."
        ),
        "example": _HEIST_EXAMPLE,
    },
    "scary-stories": {
        "prompt": (
            "a short original scary story with a chilling twist ending. Build dread through "
            "specific sensory details and an escalating sense of wrongness; end on a twist that "
            "recontextualizes everything before it."
        ),
        "example": (
            "The last text my sister ever sent me was a photo of her empty hallway.\n"
            "She lived alone.\n"
            "I zoomed in, like she asked. That's when I saw it.\n"
            "A shape at the edge of the closet door — too tall, too still.\n"
            "I called her. Straight to voicemail.\n"
            "Nine minutes later she picked up, laughing. Said she was fine. Said she never sent a photo.\n"
            "We stayed on the line while she checked the hallway.\n"
            "The closet door was open now.\n"
            "And on my phone, a new message appeared: the same hallway — taken from inside the closet."
        ),
    },
    "history": {
        "prompt": (
            "a fascinating little-known TRUE history story with a shocking or ironic outcome. "
            "Real events, real people, real dates — pick underexposed stories, not textbook "
            "staples. Include one or two concrete numbers or details that make it feel vivid."
        ),
        "example": (
            "Did you know a single wrong turn started World War One?\n"
            "June 28, 1914. Archduke Franz Ferdinand's convoy had already survived a bomb that morning.\n"
            "The route was changed for safety. Nobody told the drivers.\n"
            "His car turned onto Franz Joseph Street — the old route — and stalled while reversing.\n"
            "Directly in front of a café stood Gavrilo Princip, who had given up on the plot minutes earlier.\n"
            "He was five feet from the man he'd failed to kill all day.\n"
            "Two shots. Thirty-seven days later, all of Europe was at war.\n"
            "Sixteen million people died because a driver missed a memo."
        ),
    },
    "greek-mythology": {
        "prompt": (
            "a dramatic retelling of a Greek mythology story with modern punchy pacing. Lean into "
            "the brutality, irony and hubris; make the gods feel dangerous and petty."
        ),
        "example": (
            "Arachne was the greatest weaver in Greece — and it destroyed her.\n"
            "She boasted she was better than Athena herself.\n"
            "The goddess came to her disguised as an old woman and offered one chance to take it back.\n"
            "Arachne doubled down. So Athena revealed herself, and the contest began.\n"
            "Athena wove the glory of the gods.\n"
            "Arachne wove their crimes — every mortal they'd deceived and ruined. And it was flawless.\n"
            "That was the problem. She wasn't just better. She was right.\n"
            "Athena tore the tapestry to shreds and struck her down.\n"
            "When Arachne hanged herself in despair, the goddess 'spared' her —\n"
            "by turning her into the first spider, doomed to weave forever."
        ),
    },
    "historical-figures": {
        "prompt": (
            "a gripping TRUE story about a famous or fascinating historical figure — focus on one "
            "dramatic episode of their life, not a biography. Real documented events only."
        ),
        "example": (
            "The most decorated woman in military history was a Soviet sniper the Nazis tried to bribe.\n"
            "Lyudmila Pavlichenko had 309 confirmed kills.\n"
            "German radio broadcast offers: defect, and become a German officer.\n"
            "When she refused, they switched to threats — they'd tear her into 309 pieces.\n"
            "She later toured America, where reporters asked about her nail polish.\n"
            "Her answer became legendary: 'I am 25 years old and I have killed 309 fascist invaders. "
            "Don't you think, gentlemen, you have been hiding behind my back too long?'\n"
            "Eleanor Roosevelt became her lifelong friend.\n"
            "The woman the Nazis couldn't buy, couldn't kill, and couldn't silence."
        ),
    },
    "true-crime": {
        "prompt": (
            "a TRUE-crime mystery story based on real, documented cases (no graphic violence "
            "details). Focus on the investigation, the twist, and the resolution or chilling lack "
            "of one. Real names and dates; never invent a case."
        ),
        "example": _HEIST_EXAMPLE,
    },
    "stoic-motivation": {
        "prompt": (
            "a stoic motivational message with a memorable lesson, anchored to a real stoic "
            "philosopher's life or a concrete historical anecdote — not generic platitudes."
        ),
        "example": (
            "The most powerful man in Rome kept a slave whose only job was to whisper one sentence.\n"
            "When a general returned in triumph — crowds screaming his name, an empire at his feet —\n"
            "a slave stood behind him in the chariot, repeating:\n"
            "'Memento mori.' Remember, you will die.\n"
            "At the peak of glory, Rome built in a reminder of the grave.\n"
            "Marcus Aurelius, the emperor-philosopher, went further.\n"
            "He wrote to himself: 'You could leave life right now. Let that determine what you do, say and think.'\n"
            "Not as a threat. As a filter.\n"
            "Most of what stresses you today would not survive that filter.\n"
            "Use it."
        ),
    },
    "good-morals": {
        "prompt": (
            "a short fable-like story with a strong moral lesson and an emotionally satisfying "
            "ending. Can be an original fable or a retold classic with fresh, modern pacing."
        ),
        "example": (
            "A farmer's only horse ran away, and the whole village came to pity him.\n"
            "'Such bad luck,' they said.\n"
            "'Maybe,' said the farmer.\n"
            "A week later the horse returned — leading three wild horses home.\n"
            "'Such good luck!' the village cheered.\n"
            "'Maybe,' said the farmer.\n"
            "His son tried to ride one, was thrown, and shattered his leg.\n"
            "'Such bad luck,' the village mourned.\n"
            "'Maybe,' said the farmer.\n"
            "The next month, the army came to draft every able-bodied young man for a brutal war.\n"
            "They passed over the boy with the broken leg.\n"
            "You never know which chapter of your story you're in.\n"
            "Judge the day less. Live it more."
        ),
    },
}


# ── Scheduling helpers ────────────────────────────────────────────────────────

CADENCE_DAYS = {"daily": 1, "3x_week": 2, "weekly": 7}  # 3x_week ≈ every 2-3 days


def _next_publish_at(cadence: str, publish_time: str, after: datetime) -> datetime:
    """Next publish datetime (UTC) strictly after `after` at HH:MM, per cadence."""
    try:
        hh, mm = (int(x) for x in publish_time.split(":"))
    except Exception:
        hh, mm = 18, 0
    candidate = after.replace(hour=hh, minute=mm, second=0, microsecond=0)
    step = CADENCE_DAYS.get(cadence, 1)
    while candidate <= after:
        candidate += timedelta(days=step)
    return candidate


def _engine():
    from workers.tasks.video._core import engine
    return engine


@celery_app.task(name="workers.tasks.series.process_due_series")
def process_due_series() -> dict:
    """Beat task: enqueue generation for every active series whose run is due."""
    now = datetime.now(timezone.utc)
    claimed = []
    with Session(_engine()) as db:
        rows = db.execute(
            text("""SELECT id, tenant_id, cadence, publish_time, next_run_at, dispatch_pending_at
                    FROM series
                    WHERE is_active = true AND (
                        dispatch_pending_at IS NOT NULL
                        OR (next_run_at IS NOT NULL AND next_run_at <= :now)
                    )
                    FOR UPDATE SKIP LOCKED"""),
            {"now": now},
        ).fetchall()
        for row in rows:
            publish_at = row.dispatch_pending_at or _next_publish_at(row.cadence, row.publish_time, now)
            if row.dispatch_pending_at is None:
                next_run_at = (
                    publish_at
                    + timedelta(days=CADENCE_DAYS.get(row.cadence, 1))
                    - timedelta(hours=GENERATION_LEAD_HOURS)
                )
                db.execute(
                    text("""UPDATE series SET last_run_at = :now,
                            next_run_at = :next, dispatch_pending_at = :publish_at,
                            updated_at = now() WHERE id = :id"""),
                    {"now": now, "next": next_run_at, "publish_at": publish_at, "id": row.id},
                )
            else:
                next_run_at = row.next_run_at
            claimed.append((row.id, publish_at, next_run_at))
        db.commit()

    launched = 0
    for series_id, publish_at, next_run_at in claimed:
        try:
            task_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"viralo-series:{series_id}:{publish_at.isoformat()}"))
            generate_series_video.apply_async(
                args=[str(series_id), publish_at.isoformat()], task_id=task_id
            )
            with Session(_engine()) as db:
                db.execute(
                    text("""UPDATE series SET dispatch_pending_at = NULL, updated_at = now()
                            WHERE id = :id AND dispatch_pending_at = :publish_at"""),
                    {"id": series_id, "publish_at": publish_at},
                )
                db.commit()
            launched += 1
        except Exception:
            logging.exception("process_due_series: enqueue failed for series %s", series_id)
    if launched:
        logging.info("process_due_series: launched %d generation jobs", launched)
    return {"launched": launched}


# ── Generation pipeline ───────────────────────────────────────────────────────

def _generate_script(series: dict) -> dict:
    """LLM: niche → {title, description, hashtags, scenes:[{narration, image_prompt}]}."""
    from workers.tasks.video._core import _call_llm_json

    preset = NICHE_PROMPTS.get(series["niche"], {})
    niche_desc = series.get("custom_prompt") or preset.get("prompt") or series["niche"]
    duration = int(series.get("duration_sec") or 65)
    n_scenes = max(4, min(10, duration // 8))
    # User-provided example wins; otherwise use the preset's house-style example.
    example = (series.get("example_script") or "").strip() or preset.get("example", "")
    lang = series.get("language") or "en"

    sys_prompt = (
        "You write scripts for faceless vertical short-form videos (TikTok/Reels). "
        "Respond ONLY with valid JSON."
    )
    user_prompt = (
        f"Write a {duration}-second faceless video about: {niche_desc}.\n"
        f"Language: {lang}. Split the narration into exactly {n_scenes} scenes.\n"
        "Open with a strong hook in the first sentence. Keep sentences short and punchy.\n"
        + (f"Match the tone/style of this example script:\n{example[:1500]}\n" if example else "")
        + 'Return JSON: {"title": str (<=90 chars, clickable), '
        '"description": str (1-2 sentence social caption), '
        '"hashtags": [str, 5 items, no # symbol], '
        '"scenes": [{"narration": str (2-3 sentences), '
        '"image_prompt": str (visual description of the scene, no text in image)}]}'
    )
    result = _call_llm_json(
        [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}],
        temperature=0.8, max_tokens=2500,
    )
    scenes = result.get("scenes") or []
    if not scenes or not all((s.get("narration") or "").strip() for s in scenes):
        raise RuntimeError("Script generation returned no usable scenes")
    return result


def _tts_scene(narration: str, voice: str, out_path: str) -> float:
    """edge-tts one scene; returns audio duration sec."""
    from workers.tasks.video.render import _media_duration_sec
    cmd = ["edge-tts", "--voice", voice, "--rate", "+10%", "--text", narration,
           "--write-media", out_path]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if r.returncode != 0 or not Path(out_path).exists() or Path(out_path).stat().st_size < 100:
        raise RuntimeError(f"edge-tts failed: {r.stderr[:200]}")
    return _media_duration_sec(out_path)


def _fetch_scene_image(prompt: str, art_style: str, out_path: str, seed: int) -> None:
    """Pollinations (free, keyless) → fallback: styled gradient card via Pillow."""
    import urllib.parse, urllib.request
    style_suffix = ART_STYLES.get(art_style, ART_STYLES["comic"])
    full = f"{prompt}, {style_suffix}, vertical composition, no text, no watermark"
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(full[:800])
           + f"?width=1080&height=1920&nologo=true&seed={seed}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = resp.read()
        if len(data) > 5000:
            Path(out_path).write_bytes(data)
            return
        raise ValueError("image too small")
    except Exception as e:
        logging.warning("series image gen failed (%s) — using gradient fallback", e)
        from PIL import Image
        img = Image.new("RGB", (1080, 1920))
        px = img.load()
        c1, c2 = (24, 22, 46), (96, 40, 128)
        for y in range(1920):
            t = y / 1920
            px_row = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
            for x in range(1080):
                px[x, y] = px_row
        img.save(out_path, "JPEG", quality=88)


def _render_scene_clip(image_path: str, audio_path: str, duration: float,
                       out_path: str, zoom_in: bool) -> None:
    """Ken-Burns: slow zoom over a still + scene voiceover audio."""
    frames = max(2, int(duration * 30))
    if zoom_in:
        zexpr = f"min(1.0+0.10*on/{frames},1.10)"
    else:
        zexpr = f"max(1.10-0.10*on/{frames},1.0)"
    vf = (
        "scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,"
        f"zoompan=z='{zexpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d={frames}:s=1080x1920:fps=30"
    )
    cmd = [
        "ffmpeg", "-y", "-loop", "1", "-i", image_path, "-i", audio_path,
        "-vf", vf, "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-shortest", out_path,
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=300)
    if r.returncode != 0 or not Path(out_path).exists():
        raise RuntimeError(f"scene render failed: {r.stderr[-300:].decode(errors='ignore')}")


def _words_from_scenes(scenes: list[dict], scene_durations: list[float]) -> list:
    """Approximate per-word timestamps: words evenly spaced within each scene's audio."""
    from workers.tasks.video._core import WordTimestamp
    words = []
    t = 0.0
    for scene, dur in zip(scenes, scene_durations):
        toks = (scene.get("narration") or "").split()
        if toks:
            step = dur / len(toks)
            for i, w in enumerate(toks):
                ws = t + i * step
                words.append(WordTimestamp(word=w, start=round(ws, 3), end=round(ws + step, 3)))
        t += dur
    return words


@celery_app.task(bind=True, name="workers.tasks.series.generate_series_video",
                 soft_time_limit=1500, time_limit=1800, max_retries=1)
def generate_series_video(self, series_id: str, publish_at_iso: str | None = None) -> dict:
    """Generate one faceless video for a series and (optionally) schedule posts."""
    from workers.tasks.video._core import ClipResult, VideoMeta, _get_session
    from workers.tasks.video.render import (
        _generate_captions, _export_clip, _mix_audio_tracks, _media_duration_sec,
    )
    from workers.tasks.templates import MUSIC_TRACKS

    with Session(_engine()) as db:
        row = db.execute(text("SELECT * FROM series WHERE id = CAST(:id AS uuid)"),
                         {"id": series_id}).mappings().first()
    if not row:
        raise RuntimeError(f"series {series_id} not found")
    series = dict(row)
    tenant_id = str(series["tenant_id"])
    run_key = f"{series_id}:{publish_at_iso or 'manual'}"
    video_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"viralo-series-run:{run_key}"))
    work_dir = Path(os.getenv("VIDEO_TEMP_DIR", "/tmp/viralo-video")) / f"series_{video_id}"
    work_dir.mkdir(parents=True, exist_ok=True)

    def _set_status(status: str, **extra):
        sets = ", ".join(f"{k} = :{k}" for k in extra)
        with _get_session(tenant_id) as db:
            db.execute(
                text(f"UPDATE videos SET status = :st{', ' + sets if sets else ''}, updated_at = now() "
                     "WHERE id = CAST(:vid AS uuid)"),
                {"st": status, "vid": video_id, **extra},
            )

    try:
        # 1. Script
        script = _generate_script(series)
        scenes = script["scenes"]
        full_script = " ".join(s["narration"].strip() for s in scenes)

        with _get_session(tenant_id) as db:
            inserted = db.execute(
                text("""INSERT INTO videos (id, tenant_id, title, topic, source_type, status,
                                            pipeline_step, script_text, metadata, series_run_key,
                                            created_at, updated_at)
                        VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), :title, :topic, 'series',
                                'processing', 'generate', :script, CAST(:meta AS jsonb), :run_key,
                                now(), now())
                        ON CONFLICT (series_run_key) DO NOTHING
                        RETURNING id"""),
                {"id": video_id, "tid": tenant_id, "title": (script.get("title") or series["name"])[:255],
                 "topic": series["niche"], "script": full_script,
                 "run_key": run_key,
                 "meta": json.dumps({"series_id": series_id,
                                     "publish_at": publish_at_iso,
                                     "description": script.get("description", ""),
                                     "hashtags": script.get("hashtags", [])})},
            )
            if inserted.scalar_one_or_none() is None:
                reclaimed = db.execute(
                    text("""UPDATE videos
                            SET status = 'processing', pipeline_step = 'generate',
                                script_text = :script, metadata = CAST(:meta AS jsonb),
                                error_message = NULL, updated_at = now()
                            WHERE series_run_key = :run_key AND status = 'failed'
                            RETURNING id"""),
                    {"run_key": run_key, "script": full_script,
                     "meta": json.dumps({"series_id": series_id, "publish_at": publish_at_iso})},
                ).scalar_one_or_none()
                if reclaimed is None:
                    return {"skipped": True, "reason": "series run already active or complete"}
                db.execute(
                    text("""DELETE FROM scheduled_posts WHERE clip_id IN
                            (SELECT id FROM clips WHERE video_id = CAST(:vid AS uuid))"""),
                    {"vid": video_id},
                )
                db.execute(
                    text("DELETE FROM clips WHERE video_id = CAST(:vid AS uuid)"),
                    {"vid": video_id},
                )

        # 2. Per-scene TTS + image + Ken-Burns clip
        voice = series.get("voice") or "en-US-GuyNeural"
        scene_files, scene_durations = [], []
        for i, scene in enumerate(scenes):
            audio_p = str(work_dir / f"scene_{i}.mp3")
            image_p = str(work_dir / f"scene_{i}.jpg")
            clip_p = str(work_dir / f"scene_{i}.mp4")
            dur = _tts_scene(scene["narration"].strip(), voice, audio_p)
            dur = max(1.5, dur + 0.25)  # small breathing gap between scenes
            _fetch_scene_image(scene.get("image_prompt") or scene["narration"], series["art_style"],
                               image_p, seed=abs(hash(video_id)) % 100000 + i)
            _render_scene_clip(image_p, audio_p, dur, clip_p, zoom_in=(i % 2 == 0))
            scene_files.append(clip_p)
            scene_durations.append(dur)

        # 3. Concat scenes
        concat_list = work_dir / "concat.txt"
        concat_list.write_text("".join(f"file '{p}'\n" for p in scene_files))
        assembled = str(work_dir / "assembled.mp4")
        r = subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
                            "-c", "copy", assembled], capture_output=True, timeout=300)
        if r.returncode != 0:
            raise RuntimeError(f"concat failed: {r.stderr[-300:].decode(errors='ignore')}")

        # 4. Background music (ducked under the voiceover)
        source_path = assembled
        music_path = MUSIC_TRACKS.get(series.get("music_track") or "")
        if music_path and Path(music_path).exists():
            mixed = str(work_dir / "assembled_music.mp4")
            source_path = _mix_audio_tracks(assembled, mixed, music_path=music_path)

        total = _media_duration_sec(source_path) or sum(scene_durations)

        # 5. Captions + thumbnail + clip row + upload via existing export machinery
        words = _words_from_scenes(scenes, scene_durations)
        clip = ClipResult(start=0.0, end=total, score=0.9,
                          title=script.get("title") or series["name"],
                          reason="series auto-generation", platform="tiktok")
        captions = _generate_captions(words, clip)
        meta = VideoMeta(duration=total, width=1080, height=1920, fps=30.0,
                         codec="h264", has_audio=True)
        cfg = {
            "aspect_ratio": "9:16", "output_quality": "1080p",
            "add_captions": True, "caption_style": series.get("caption_style") or "capcut",
            "music": False, "voiceover": False, "template_id": "generic",
        }
        ai_content = {"title": script.get("title", ""),
                      "description": script.get("description", ""),
                      "all_hashtags": script.get("hashtags", [])}
        exported = _export_clip(tenant_id, video_id, clip, captions, source_path,
                                work_dir, meta, cfg, words=words, ai_content=ai_content)
        if not exported:
            raise RuntimeError("clip export failed")
        clip_id, clip_path = exported

        from workers.tasks.video.tasks import upload_clip_to_storage
        upload_clip_to_storage.delay(clip_id, clip_path, tenant_id, "")

        # 6. Schedule posts on the connected accounts at publish time
        posts = 0
        try:
            account_ids = [
                str(uuid.UUID(str(account_id)))
                for account_id in (series.get("social_account_ids") or [])
                if account_id
            ]
        except (TypeError, ValueError):
            logging.warning("series %s has an invalid social account id; skipping auto-publish", series_id)
            account_ids = []
        if series.get("auto_publish") and account_ids and publish_at_iso:
            publish_at = datetime.fromisoformat(publish_at_iso)
            caption_text = (script.get("description") or script.get("title") or "")[:2000]
            hashtags = script.get("hashtags") or []
            with _get_session(tenant_id) as db:
                accounts = db.execute(
                    text("""SELECT id, platform FROM social_accounts
                             WHERE tenant_id = CAST(:tid AS uuid) AND is_active = true
                               AND id = ANY(CAST(:account_ids AS uuid[]))"""),
                    {"tid": tenant_id, "account_ids": account_ids},
                ).fetchall()
                for acct_id, platform in accounts:
                    db.execute(
                        text("""INSERT INTO scheduled_posts
                                  (id, tenant_id, clip_id, social_account_id, platform, status,
                                   scheduled_at, caption, hashtags, created_at, updated_at)
                                VALUES (:id, CAST(:tid AS uuid), CAST(:cid AS uuid), :aid, :plat,
                                        'scheduled', :at, :cap, CAST(:tags AS jsonb), now(), now())"""),
                        {"id": uuid.uuid4(), "tid": tenant_id, "cid": clip_id, "aid": acct_id,
                         "plat": platform, "at": publish_at, "cap": caption_text,
                         "tags": json.dumps(hashtags)},
                    )
                    posts += 1

        _set_status("completed", pipeline_step="completed", duration_sec=int(total))

        logging.info("generate_series_video: series=%s video=%s clip=%s posts=%d",
                     series_id, video_id, clip_id, posts)
        return {"video_id": video_id, "clip_id": clip_id, "posts_scheduled": posts}

    except Exception as e:
        logging.exception("generate_series_video failed for series %s", series_id)
        try:
            _set_status("failed", pipeline_step="failed", error_message=str(e)[:500])
        except Exception:
            pass
        raise
    finally:
        # scene/work files no longer needed; exported clip file is owned by the upload task
        for f in work_dir.iterdir() if work_dir.exists() else []:
            if not f.name.startswith("clip_"):
                try:
                    f.unlink()
                except Exception:
                    pass
