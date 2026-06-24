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

__all__ = [
    '_AD_PHRASES',
    '_detect_ad_segments',
    '_youtube_chapter_signals',
    '_SCORE_CALIBRATION',
    '_multi_agent_viral_signals',
    '_ai_score_clips',
    '_heuristic_clips',
    '_multi_agent_clip_content',
    '_ai_generate_clip_content',
    '_ai_generate_video_metadata',
    '_batch_ai_content',
    '_hook_score',
    '_topic_coherence_score',
]

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


_HOOK_POWER_WORDS = {
    "why", "what", "how", "when", "who", "which",
    "nobody", "never", "always", "worst", "best", "secret", "truth",
    "mistake", "wrong", "dangerous", "shocking", "surprising", "unbelievable",
    "finally", "actually", "honestly", "literally", "seriously",
    "but", "however", "except", "unless", "imagine", "stop", "wait",
    "most", "least", "every", "only",
}


def _hook_score(words: list, start: float, window: float = 3.0) -> float:
    """Score 0–1 based on power-word density in the first `window` seconds of clip."""
    import math
    hook_words = [w for w in words if start <= w.start <= start + window]
    if not hook_words:
        return 0.0
    hits = sum(1 for w in hook_words if w.word.lower().strip(".,!?") in _HOOK_POWER_WORDS)
    ratio = hits / len(hook_words)
    return round(min(1.0, math.log1p(ratio * 10) / math.log1p(10)), 3)


def _topic_coherence_score(clip, topic_blocks: list) -> float:
    """Score 0–1: 1.0 if clip is fully within one topic block, lower if it crosses boundaries."""
    if not topic_blocks:
        return 0.5
    clip_dur = clip.end - clip.start
    if clip_dur <= 0:
        return 0.5
    overlap_total = 0.0
    max_overlap = 0.0
    for tb in topic_blocks:
        ol = max(0.0, min(clip.end, tb.end_sec) - max(clip.start, tb.start_sec))
        overlap_total += ol
        max_overlap = max(max_overlap, ol)
    if overlap_total <= 0:
        return 0.5
    return round(max_overlap / overlap_total, 3)


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
    topic_blocks: list | None = None,
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
        for s in signals:
            clip_start = float(s.get("timestamp_sec", 0))
            hook_s = _hook_score(words, clip_start)
            s["hook_score"] = hook_s
        signals_str = "\n".join(
            f"- t={s.get('timestamp_sec', 0):.1f}s  score={s.get('score', 5)}/10  [{s.get('signal_type', '?')}]  \"{s.get('trigger_words', '')}\"  → {s.get('stop_scroll_reason', '')}  Hook strength: {s.get('hook_score', 0.0):.2f}"
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
                # Target the midpoint of the user's window so direct-from-signal
                # clips respect duration_max instead of an arbitrary 30s cap.
                target_len = min(max_dur, max(min_dur, (min_dur + max_dur) // 2))
                end = min(duration, start + target_len)
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
            hook_s = _hook_score(words, start)
            clips.append(ClipResult(
                start=round(start, 2),
                end=round(end, 2),
                score=score,
                title=(c.get("title") or f"Clip {len(clips)+1}")[:100],
                reason=c.get("reason", ""),
                platform=plat,
                hook_score=hook_s,
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

def _multi_agent_clip_content(
    clip: "ClipResult",
    transcript_snippet: str,
    platforms: list[str],
    content_type: str,
    topic_focus: str | None = None,
) -> dict:
    """Generate viral description, trending hashtags and an optimized title.

    Single combined LLM call (was 3 parallel calls). With clips also processed in
    parallel upstream, 3 calls/clip produced a burst of ~12 concurrent requests that
    tripped free-tier 429s and forced slow fallbacks. One call/clip cuts that load 3×
    and keeps work on the fast primary provider.
    """
    topic_ctx = f"Topic: {topic_focus}\n" if topic_focus else ""
    clip_ctx = f"Clip reason: {clip.reason}\nClip title hint: {clip.title}"

    prompt = f"""You are a viral social media expert for {content_type} content. For this clip,
produce THREE things in one JSON object: platform descriptions, trending hashtags, and the best title.

{topic_ctx}{clip_ctx}
Transcript excerpt:
{transcript_snippet[:3000]}

1) DESCRIPTIONS — per platform, each: open with a HOOK (first 5 words stop the scroll),
   build curiosity/emotion in 2-3 sentences, end with a CTA/cliffhanger. Tone:
   TikTok=casual/punchy, Reels=visual/trendy, Shorts=direct/fast.
2) HASHTAGS — REAL trending tags (not invented). 4-5 mega (#viral #trending #fyp #foryou #explore),
   4-5 topic, 3-4 niche, 2-3 engagement. ALL lowercase, no spaces/special chars, include # prefix.
3) TITLE — generate 5 options (score 1-10) and return the single best. Under 80 chars, curiosity
   gap / bold claim / emotion, must reflect the actual clip (no false clickbait).

Return JSON:
{{
  "platforms": {{
    "tiktok": {{"description": "<150 char hook-first caption>", "cta": "<comment bait question>"}},
    "reels": {{"description": "<visual storytelling caption 100-200 chars>", "cta": "<save/share prompt>"}},
    "shorts": {{"description": "<direct punchy caption under 100 chars>", "cta": "<subscribe hook>"}}
  }},
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
  }},
  "titles": [{{"text": "<title>", "score": <1-10>, "hook_type": "<curiosity|emotion|bold|reveal>"}}],
  "best_title": "<the highest scoring title>"
}}"""

    desc_result, hashtag_result, title_result = {}, {}, {}
    try:
        data = _call_llm_json([{"role": "user", "content": prompt}], temperature=0.7, max_tokens=1500)
        if isinstance(data, dict):
            desc_result = {"platforms": data.get("platforms", {})}
            hashtag_result = {"hashtags": data.get("hashtags", {})}
            title_result = {"best_title": data.get("best_title"), "titles": data.get("titles", [])}
    except Exception as e:
        logging.warning("_multi_agent_clip_content combined call failed: %s", e)

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

