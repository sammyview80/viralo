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

__all__ = [
    '_smooth_word_timestamps',
    '_generate_captions',
    '_load_font',
    '_build_caption_timeline',
    '_crop_frame',
    '_draw_caption',
    '_make_hook_text',
    '_draw_hook_overlay',
    'RANKING_THEMES',
    '_hex_to_rgb',
    '_draw_ranking_overlay',
    '_render_ranking_segment',
    '_suggest_ranking_title',
    '_generate_voiceover_script',
    '_voiceover_script_to_captions',
    '_synthesize_voiceover',
    '_enhance_clip_quality',
    '_detect_action_centroid',
    '_mix_audio_tracks',
    '_render_clip_streamcopy',
    '_render_clip_ffmpeg_captions',
    '_render_clip',
    '_generate_thumbnail',
    '_export_clip',
    'SOUNDS_DIR',
    'QUALITY_PRESETS',
    '_media_has_audio_stream',
    '_build_precise_trim_command',
    '_normalize_editor_timeline',
    '_build_caption_filter',
    '_mix_sound_markers',
]

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


def _load_font(size: int):
    from PIL import ImageFont
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


from functools import lru_cache as _lru_cache


@_lru_cache(maxsize=64)
def _load_font_cached(size: int):
    return _load_font(size)



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
    elif style == "word-pop":
        y_base = int(height * 0.48)  # one big word, centered like TikTok word-pop edits
    else:
        y_base = int(height * (0.76 if is_vertical else 0.80))

    draw = ImageDraw.Draw(img)

    def fit_font(text: str, font, max_w: int):
        """Step the font size down until the text fits max_w (captions must never overflow the frame)."""
        bb = draw.textbbox((0, 0), text, font=font)
        if bb[2] - bb[0] <= max_w:
            return font
        size = int(getattr(font, "size", font_size))
        while size > 24:
            size = int(size * 0.9)
            f = _load_font_cached(size)
            bb = draw.textbbox((0, 0), text, font=f)
            if bb[2] - bb[0] <= max_w:
                return f
        return _load_font_cached(24)

    def draw_centered_outline(text, y, font, color, stroke_width=4, stroke_color=(0, 0, 0, 255), bg=None, pad=16):
        font = fit_font(text, font, int(width * 0.92))
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
        if words:
            font = fit_font(max(words, key=len), font, MAX_W - PAD_X * 2)
        pill_fill = (*highlight_color[:3], 240)
        # Black text on bright pills, white on dark ones (perceived luminance)
        lum = 0.299 * highlight_color[0] + 0.587 * highlight_color[1] + 0.114 * highlight_color[2]
        pill_txt = (0, 0, 0, 255) if lum > 140 else (255, 255, 255, 255)
        def _pill_w(tw): return tw + PAD_X * 2

        # Width-aware greedy packing into at most 2 rows; shrink font until it fits
        size = int(getattr(font, "size", font_size))
        while True:
            word_sizes = []
            for w in words:
                bb = draw.textbbox((0, 0), w, font=font)
                word_sizes.append((bb[2] - bb[0], bb[3] - bb[1]))
            rows_idx: list[list[int]] = [[]]
            row_w = 0
            for i, (tw, _) in enumerate(word_sizes):
                pw = _pill_w(tw) + (GAP if rows_idx[-1] else 0)
                if row_w + pw > MAX_W and rows_idx[-1]:
                    rows_idx.append([i])
                    row_w = _pill_w(tw)
                else:
                    rows_idx[-1].append(i)
                    row_w += pw
            if len(rows_idx) <= 2 or size <= 24:
                break
            size = int(size * 0.9)
            font = _load_font_cached(size)
        rows = [[(words[i], word_sizes[i]) for i in r] for r in rows_idx]
        active_rows = [r.index(active_idx) if active_idx in r else -1 for r in rows_idx]

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
                                           radius=RADIUS, fill=pill_fill)
                    txt_color = pill_txt
                else:
                    txt_color = (255, 255, 255, 230)

                wx = x + PAD_X
                wy = pill_y + PAD_Y
                if i != act_idx:
                    draw.text((wx + 2, wy + 2), w, font=font, fill=(0, 0, 0, 120))
                draw.text((wx, wy), w, font=font, fill=txt_color)
                x += pw + GAP

    def draw_karaoke_line(words: list, active_idx: int, y: int):
        """Full line with outline; the active word is tinted with the highlight color."""
        GAP = 12
        font = fit_font(" ".join(words), font_main, int(width * 0.88) - GAP * (len(words) - 1))
        sizes = []
        for w in words:
            bb = draw.textbbox((0, 0), w, font=font)
            sizes.append((bb[2] - bb[0], bb[3] - bb[1]))
        total_w = sum(s[0] for s in sizes) + GAP * (len(words) - 1)
        th = max((s[1] for s in sizes), default=font_size)
        x = (width - total_w) // 2
        if bg_color[3] > 0:
            draw.rounded_rectangle([x - 16, y - 8, x + total_w + 16, y + th + 8],
                                   radius=8, fill=bg_color)
        for i, (w, (tw, _)) in enumerate(zip(words, sizes)):
            color = highlight_color if i == active_idx else text_color
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    if dx == 0 and dy == 0:
                        continue
                    draw.text((x + dx, y + dy), w, font=font, fill=(0, 0, 0, 255))
            draw.text((x, y), w, font=font, fill=color)
            x += tw + GAP

    def draw_tiktok_reveal(words: list, active_idx: int, y: int):
        """TikTok native auto-caption look: words appear as spoken, each line on
        a rounded translucent dark box hugging the text width."""
        PAD_X, PAD_Y = 16, 9
        LINE_GAP = 6
        MAX_W = width - int(width * 0.08) - PAD_X * 2
        shown = words[:active_idx + 1]
        lines: list[str] = []
        cur = ""
        for w in shown:
            cand = (cur + " " + w).strip()
            bb = draw.textbbox((0, 0), cand, font=font_main)
            if bb[2] - bb[0] > MAX_W and cur:
                lines.append(cur)
                cur = w
            else:
                cur = cand
        if cur:
            lines.append(cur)
        lines = lines[-2:]  # keep at most the 2 latest lines
        metrics = []
        for ln in lines:
            bb = draw.textbbox((0, 0), ln, font=font_main)
            metrics.append((ln, bb[2] - bb[0], bb[3] - bb[1]))
        line_h = max((m[2] for m in metrics), default=font_size) + PAD_Y * 2
        for i, (ln, tw, th) in enumerate(metrics):
            x = (width - tw) // 2
            ly = y + i * (line_h + LINE_GAP)
            draw.rounded_rectangle([x - PAD_X, ly - PAD_Y, x + tw + PAD_X, ly + th + PAD_Y],
                                   radius=12, fill=bg_color)
            draw.text((x, ly), ln, font=font_main, fill=text_color)

    def _line_layout(words: list, font, gap: int = 12):
        """Common word-row measure: returns (font, sizes, x_start, row_height)."""
        font = fit_font(" ".join(words), font, int(width * 0.88) - gap * (len(words) - 1))
        sizes = []
        for w in words:
            bb = draw.textbbox((0, 0), w, font=font)
            sizes.append((bb[2] - bb[0], bb[3] - bb[1]))
        total_w = sum(s[0] for s in sizes) + gap * (len(words) - 1)
        th = max((s[1] for s in sizes), default=font_size)
        return font, sizes, (width - total_w) // 2, th

    def draw_bounce_line(words: list, active_idx: int, y: int):
        """Active word 'pops' — drawn bigger in the highlight color (CapCut bounce look)."""
        GAP = 12
        font = fit_font(" ".join(words), font_main, int(width * 0.78) - GAP * (len(words) - 1))
        big = _load_font_cached(int(getattr(font, "size", font_size) * 1.35))
        sizes = []
        for i, w in enumerate(words):
            bb = draw.textbbox((0, 0), w, font=big if i == active_idx else font)
            sizes.append((bb[2] - bb[0], bb[3] - bb[1]))
        total_w = sum(s[0] for s in sizes) + GAP * (len(words) - 1)
        max_h = max((s[1] for s in sizes), default=font_size)
        x = (width - total_w) // 2
        for i, (w, (tw, th)) in enumerate(zip(words, sizes)):
            f = big if i == active_idx else font
            color = highlight_color if i == active_idx else text_color
            wy = y + (max_h - th)  # bottom-align: the big word pops upward
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    if dx or dy:
                        draw.text((x + dx, wy + dy), w, font=f, fill=(0, 0, 0, 255))
            draw.text((x, wy), w, font=f, fill=color)
            x += tw + GAP

    def draw_glow_line(words: list, active_idx: int, y: int):
        """Neon glow: soft halo in the highlight color. The halo is drawn on its own
        layer so overlapping strokes don't stack to a solid block, then pasted onto
        the frame at ~45% via an alpha mask (in-place — works on RGB frames too)."""
        from PIL import Image as _PILImage, ImageDraw as _PILDraw
        GAP = 12
        font, sizes, x0, _ = _line_layout(words, font_main, GAP)
        halo_layer = _PILImage.new("RGBA", img.size, (0, 0, 0, 0))
        hdraw = _PILDraw.Draw(halo_layer)
        x = x0
        for w, (tw, _h) in zip(words, sizes):
            for r in (6, 4, 2):
                for dx in (-r, 0, r):
                    for dy in (-r, 0, r):
                        if dx or dy:
                            hdraw.text((x + dx, y + dy), w, font=font, fill=(*highlight_color[:3], 255))
            x += tw + GAP
        from PIL import ImageFilter as _PILFilter
        mask = halo_layer.getchannel("A").filter(_PILFilter.GaussianBlur(5))
        mask = mask.point(lambda a: int(a * 0.55))
        solid = _PILImage.new(img.mode, img.size, tuple(highlight_color[:3]))
        img.paste(solid, (0, 0), mask=mask)
        x = x0
        for i, (w, (tw, _h)) in enumerate(zip(words, sizes)):
            draw.text((x + 1, y + 1), w, font=font, fill=(0, 0, 0, 140))
            draw.text((x, y), w, font=font, fill=highlight_color if i == active_idx else text_color)
            x += tw + GAP

    def draw_highlighter_line(words: list, active_idx: int, y: int):
        """Marker swipe: the spoken word gets a highlighter bar, rest of the line stays plain."""
        GAP = 12
        font, sizes, x, _ = _line_layout(words, font_main, GAP)
        lum = 0.299 * highlight_color[0] + 0.587 * highlight_color[1] + 0.114 * highlight_color[2]
        marker_txt = (0, 0, 0, 255) if lum > 140 else (255, 255, 255, 255)
        for i, (w, (tw, th)) in enumerate(zip(words, sizes)):
            if i == active_idx:
                draw.rounded_rectangle([x - 6, y - 4, x + tw + 6, y + th + 6],
                                       radius=6, fill=(*highlight_color[:3], 235))
                draw.text((x, y), w, font=font, fill=marker_txt)
            else:
                draw.text((x + 2, y + 2), w, font=font, fill=(0, 0, 0, 170))
                draw.text((x, y), w, font=font, fill=text_color)
            x += tw + GAP

    _RAINBOW = [(255, 82, 82, 255), (255, 165, 40, 255), (250, 220, 50, 255),
                (85, 230, 120, 255), (70, 200, 255, 255), (190, 130, 255, 255)]

    def draw_rainbow_line(words: list, active_idx: int, y: int):
        """Every word a different bright color; the spoken word gets an underline bar."""
        GAP = 12
        font, sizes, x, _ = _line_layout(words, font_main, GAP)
        for i, (w, (tw, th)) in enumerate(zip(words, sizes)):
            color = _RAINBOW[i % len(_RAINBOW)]
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    if dx or dy:
                        draw.text((x + dx, y + dy), w, font=font, fill=(0, 0, 0, 255))
            draw.text((x, y), w, font=font, fill=color)
            if i == active_idx:
                draw.rounded_rectangle([x, y + th + 6, x + tw, y + th + 11], radius=2, fill=color)
            x += tw + GAP

    if style in ("classic", "impact"):
        ctx_text = entry[0] if isinstance(entry[0], str) else " ".join(entry[0])
        if style == "impact":
            ctx_text = ctx_text.upper()
        ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
        draw_centered_outline(ctx_text, y_base, font_main, ctx_color,
                              stroke_width=6 if style == "impact" else 4,
                              bg=bg_color if bg_color[3] > 0 else None)

    elif style == "shadow":
        # Hard offset drop-shadow caps — bold Reels/poster look
        ctx_text = (entry[0] if isinstance(entry[0], str) else " ".join(entry[0])).upper()
        font = fit_font(ctx_text, font_main, int(width * 0.90))
        bb = draw.textbbox((0, 0), ctx_text, font=font)
        tw = bb[2] - bb[0]
        x = (width - tw) // 2
        draw.text((x + 6, y_base + 6), ctx_text, font=font, fill=highlight_color)
        for dx in (-2, 2):
            for dy in (-2, 2):
                draw.text((x + dx, y_base + dy), ctx_text, font=font, fill=(0, 0, 0, 220))
        draw.text((x, y_base), ctx_text, font=font, fill=text_color)

    elif style == "bounce" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_bounce_line(words, active_idx, y_base)

    elif style == "glow" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_glow_line(words, active_idx, y_base)

    elif style == "highlighter" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_highlighter_line(words, active_idx, y_base)

    elif style == "rainbow" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_rainbow_line(words, active_idx, y_base)

    elif style == "tiktok" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_tiktok_reveal(words, active_idx, y_base)

    elif style == "word-pop" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_centered_outline(words[active_idx].upper(), y_base, font_highlight,
                              text_color, stroke_width=6)

    elif style == "karaoke" and isinstance(entry[0], list):
        words, active_idx = entry
        draw_karaoke_line(words, active_idx, y_base)

    elif style in CAPCUT_STYLES and style != "capcut":
        if isinstance(entry[0], list):
            words, active_idx = entry
            if style in UPPERCASE_PILL_STYLES:
                words = [w.upper() for w in words]
            draw_capcut_inline(words, active_idx, y_base, bold=style in BOLD_PILL_STYLES)
        else:
            ctx_text, _ = entry
            ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
            draw_centered_outline(ctx_text, y_base, font_main, ctx_color, stroke_width=5)

    elif style == "minimal":
        ctx_text = entry[0] if isinstance(entry[0], str) else " ".join(entry[0])
        ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
        font = fit_font(ctx_text, font_main, int(width * 0.92))
        bbox = draw.textbbox((0, 0), ctx_text, font=font)
        tw = bbox[2] - bbox[0]
        x = (width - tw) // 2
        draw.text((x + 2, y_base + 2), ctx_text, font=font, fill=(0, 0, 0, 100))
        draw.text((x, y_base), ctx_text, font=font, fill=ctx_color)

    else:  # capcut default
        if isinstance(entry[0], list):
            words, active_idx = entry
            draw_capcut_inline(words, active_idx, y_base, bold=False)
        else:
            ctx_text, _ = entry
            ctx_color = (*text_color[:3], int(text_color[3] * ctx_alpha))
            font = fit_font(ctx_text, font_main, int(width * 0.92))
            bbox = draw.textbbox((0, 0), ctx_text, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            x = (width - tw) // 2
            if bg_color[3] > 0:
                draw.rounded_rectangle([x - 16, y_base - 8, x + tw + 16, y_base + th + 8],
                                       radius=8, fill=bg_color)
            draw.text((x + 3, y_base + 3), ctx_text, font=font, fill=(0, 0, 0, 170))
            draw.text((x, y_base), ctx_text, font=font, fill=ctx_color)

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
        words = title.split()
        max_w = int(width * 0.92)  # keep title inside the frame, small side margin

        def _balanced_two_lines(ws: list[str]) -> tuple[str, str]:
            mid = max(1, len(ws) // 2)
            return " ".join(ws[:mid]), " ".join(ws[mid:])

        def _line_w(line: str, font) -> int:
            if not line:
                return 0
            tb = draw.textbbox((0, 0), line, font=font)
            return tb[2] - tb[0]

        # Auto-shrink the title until both lines fit the frame width. Fixed
        # width*0.07 overflowed long titles, pushing text off both edges.
        title_sz = int(width * 0.07)
        min_sz = max(18, int(width * 0.035))
        while title_sz > min_sz:
            title_font = _load_font(title_sz)
            l1, l2 = _balanced_two_lines(words)
            if max(_line_w(l1, title_font), _line_w(l2, title_font)) <= max_w:
                break
            title_sz -= 2
        title_font = _load_font(title_sz)
        line1, line2 = _balanced_two_lines(words)

        ty = int(height * 0.03)
        for line_idx, line in enumerate([line1, line2]):
            if not line:
                continue
            tb = draw.textbbox((0, 0), line, font=title_font)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            tx = max(int((width - max_w) // 2), (width - tw) // 2)   # centered, never off-frame
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
    base_sz   = min(int(width * 0.048), int(height * 0.036))
    active_sz = min(int(width * 0.062), int(height * 0.046))
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

            for packet in src.demux(*([v_stream] + ([a_stream] if a_stream else []))):
                if packet.stream is v_stream:
                    for frame in packet.decode():
                        img = frame.to_image()
                        img = _draw_ranking_overlay(img, rank_number, title_text, theme_name, target_w, target_h, total=total, all_labels=all_labels, revealed_ranks=revealed_ranks, template_config=template_config)
                        img = img.convert("RGB")
                        new_frame = av.VideoFrame.from_image(img)
                        # Preserve each frame's real presentation timestamp instead of
                        # re-gridding onto a synthetic frame_idx/fps clock. The synthetic
                        # clock drifts from the (continuous) audio whenever the intermediate
                        # isn't perfectly CFR — progressively desyncing A/V. Carrying the
                        # source pts/time_base keeps the two streams locked.
                        new_frame.pts = frame.pts
                        new_frame.time_base = frame.time_base
                        for pkt in out_v.encode(new_frame):
                            dst.mux(pkt)
                        del img, new_frame
                elif out_a is not None and packet.stream is a_stream:
                    # Decode every audio packet and keep its decoded pts. Dropping packets
                    # (or nulling pts to let the encoder re-pack sequentially) shortens the
                    # audio track relative to video and desyncs it.
                    for aframe in packet.decode():
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


def _media_duration_sec(path: str) -> float:
    try:
        r = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if r.returncode == 0:
            return max(0.0, float((r.stdout or "0").strip() or 0))
    except Exception:
        pass
    return 0.0


def _media_has_audio_stream(path: str) -> bool:
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


def _build_precise_trim_command(
    source_path: str,
    output_path: str,
    start_sec: float,
    end_sec: float | None,
    has_audio: bool,
) -> list[str]:
    start = max(0.0, float(start_sec or 0.0))
    end = float(end_sec) if end_sec is not None else None
    duration = (end - start) if end is not None and end > start else None
    seek_start = max(0.0, start - 2.0)
    seek_offset = start - seek_start

    duration_expr = f":duration={duration}" if duration is not None else ""
    v_chain = f"[0:v:0]trim=start={seek_offset}{duration_expr},setpts=PTS-STARTPTS[vout]"
    if has_audio:
        filter_complex = (
            f"{v_chain};"
            f"[0:a:0]atrim=start={seek_offset}{duration_expr},asetpts=PTS-STARTPTS[aout]"
        )
        maps = ["-map", "[vout]", "-map", "[aout]"]
        audio_flags = ["-c:a", "aac", "-b:a", "256k"]
    else:
        filter_complex = v_chain
        maps = ["-map", "[vout]"]
        audio_flags = []

    return [
        "ffmpeg", "-y", "-threads", "2",
        "-ss", str(seek_start),
        "-i", source_path,
        "-filter_complex", filter_complex,
        *maps,
        "-c:v", "libx264",
        "-crf", "22",
        "-preset", "veryfast",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        *audio_flags,
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        output_path,
    ]


def _voiceover_script_to_captions(
    script: str,
    voice_duration_sec: float,
    clip_duration_sec: float,
    max_words: int = 3,
) -> list[CaptionSegment]:
    clean_words = [w for w in re.findall(r"[\w'-]+|[^\w\s]", script.strip()) if w.strip()]
    clean_words = [w for w in clean_words if re.search(r"\w", w)]
    if not clean_words:
        return []

    duration = min(max(0.2, voice_duration_sec), max(0.2, clip_duration_sec))
    per_word = duration / len(clean_words)
    word_times = [
        WordTimestamp(
            word=w,
            start=round(i * per_word, 3),
            end=round(min(duration, (i + 1) * per_word), 3),
        )
        for i, w in enumerate(clean_words)
    ]

    captions: list[CaptionSegment] = []
    for i in range(0, len(word_times), max(1, max_words)):
        chunk = word_times[i:i + max(1, max_words)]
        captions.append(CaptionSegment(
            text=" ".join(w.word for w in chunk),
            start=chunk[0].start,
            end=chunk[-1].end,
            words=chunk,
        ))
    return captions


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
        import numpy as np
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

    has_orig_audio = _media_has_audio_stream(clip_path)
    clip_duration = _media_duration_sec(clip_path)
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
    filter_parts.append(f"{mix_inputs}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0[mixed]")
    if clip_duration > 0:
        filter_parts.append(f"[mixed]apad,atrim=0:{clip_duration},asetpts=PTS-STARTPTS[aout]")
    else:
        filter_parts.append("[mixed]apad[aout]")

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
    # Round, never truncate: int(29.97) = 29 stretched video ~3.3% vs the
    # source-clock-anchored audio — progressive A/V and caption drift.
    fps_int = max(1, int(round(fps)))
    last_video_pts = -1
    audio_sample_idx = 0

    with av.open(output_path, "w", format="mp4") as dst:
        out_v = dst.add_stream("h264", rate=fps_int)
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

        with av.open(source_path) as src:
            v_stream = next((s for s in src.streams if s.type == "video"), None)
            a_stream = next((s for s in src.streams if s.type == "audio"), None) if meta.has_audio else None

            out_a = None
            audio_rate = meta.audio_sample_rate
            if a_stream is not None:
                # Use the stream's real rate/channels — meta defaults (44100/stereo)
                # desync audio when the source is e.g. 48 kHz (ffmpeg intermediates).
                audio_rate = a_stream.sample_rate or meta.audio_sample_rate
                src_channels = getattr(a_stream.codec_context, "channels", 0) or meta.audio_channels
                ch_layout = "stereo" if src_channels >= 2 else "mono"
                out_a = dst.add_stream("aac", rate=audio_rate, layout=ch_layout)
                out_a.bit_rate = AUDIO_BITRATE

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
                    # NOTE: packets before clip.start still go to the decoder —
                    # inter-coded frames need them as references. Gate on frame time.
                    for frame in packet.decode():
                        t_frame = float(frame.pts * v_stream.time_base) if frame.pts is not None else t
                        if t_frame < clip.start - 0.005:
                            continue
                        if first_video_t is None:
                            first_video_t = t_frame
                        # Lock output PTS to source time so video can't drift from
                        # the source-clock-anchored audio; drop duplicate-slot frames.
                        out_pts = int(round((t_frame - first_video_t) * fps_int))
                        if out_pts <= last_video_pts:
                            continue
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

                        new_frame.pts = out_pts
                        new_frame.time_base = Fraction(1, fps_int)
                        last_video_pts = out_pts
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
                        if t_frame + frame.samples / audio_rate <= anchor:
                            continue  # frame ends before the first video frame
                        pts_samples = max(0, int((t_frame - anchor) * audio_rate))
                        if audio_sample_idx == 0 and pts_samples > 0:
                            audio_sample_idx = pts_samples
                        frame.pts = audio_sample_idx
                        frame.dts = audio_sample_idx
                        frame.time_base = Fraction(1, audio_rate)
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
    # Explicit user selection always wins; unset (None) = auto from template.
    style = cfg.get("caption_style") or tmpl.get("caption_style") or "capcut"
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

    want_music = cfg.get("music", True) and tmpl.get("music_track")
    # Respect the user-facing voiceover toggle. Templates can suggest a style,
    # but must not force narration when the UI/default config sends false.
    want_vo = bool(cfg.get("voiceover", False))

    music_path: str | None = None
    if want_music:
        track_key = cfg.get("music_track") or tmpl.get("music_track")
        music_path = MUSIC_TRACKS.get(track_key) if track_key else None

    vo_path: str | None = None
    vo_script = ""
    if want_vo:
        _prog("voiceover", 63, f"Clip {clip_index+1}/{clip_total}: generating AI voiceover…")
        vo_script = _generate_voiceover_script(clip, viral_type, cfg.get("content_type", "other"))
        if vo_script:
            _vo_out = str(work_dir / f"clip_{clip_id}_vo.mp3")
            if _synthesize_voiceover(vo_script, _vo_out):
                vo_path = _vo_out

    render_captions = captions
    if burn_captions and vo_path and vo_script:
        voice_duration = _media_duration_sec(vo_path) or max(0.2, clip.end - clip.start)
        words_per_line = 5 if style == "tiktok" else (3 if style in CAPCUT_STYLES else 6)
        render_captions = _voiceover_script_to_captions(
            vo_script,
            voice_duration_sec=voice_duration,
            clip_duration_sec=max(0.2, clip.end - clip.start),
            max_words=words_per_line,
        ) or captions

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
            captions=render_captions if burn_captions else [],
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

    srt_content = _generate_srt(render_captions)

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
        "signals": {
            "hook_score": round(clip.hook_score, 3) if clip.hook_score else 0.0,
            "audio_energy": round(clip.audio_energy, 3) if clip.audio_energy else None,
            "speech_rate": round(clip.speech_rate, 3) if clip.speech_rate else None,
        },
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

SOUNDS_DIR = Path(__file__).parent.parent.parent / "assets" / "sounds"

QUALITY_PRESETS = {
    "draft":  ["-crf", "32", "-preset", "ultrafast"],
    "720p":   ["-crf", "26", "-preset", "fast", "-vf", "scale=-2:720"],
    "1080p":  ["-crf", "22", "-preset", "fast", "-vf", "scale=-2:1080"],
}

EDITOR_CAPTION_TEMPLATES = {
    "modern": ["fontcolor=0xffea00", "box=1", "boxcolor=0x000000@0.92", "boxborderw=18"],
    "bouncy": ["fontcolor=0x7c2dff", "box=1", "boxcolor=0xffffff@0.96", "boxborderw=18"],
    "mr-beast": [
        "fontcolor=0x00a7b7",
        "box=1",
        "boxcolor=0xffd21f",
        "boxborderw=18",
        "shadowcolor=0x000000",
        "shadowx=2",
        "shadowy=2",
    ],
    "business": ["fontcolor=0xffffff", "shadowcolor=0x000000", "shadowx=2", "shadowy=2"],
    "clean": ["fontcolor=0xffffff", "shadowcolor=0x000000", "shadowx=1", "shadowy=1"],
    "neon": [
        "fontcolor=0x39ff14",
        "box=1",
        "boxcolor=0x101026@0.84",
        "boxborderw=16",
        "shadowcolor=0xff00ff",
        "shadowx=2",
        "shadowy=2",
    ],
    "podcast": ["fontcolor=0xffffff", "box=1", "boxcolor=0x111827@0.88", "boxborderw=14"],
    "cinematic": ["fontcolor=0xf5d76e", "shadowcolor=0x000000", "shadowx=2", "shadowy=2"],
    "gaming": [
        "fontcolor=0x00e5ff",
        "box=1",
        "boxcolor=0x4c1d95@0.86",
        "boxborderw=16",
        "shadowcolor=0x000000",
        "shadowx=2",
        "shadowy=2",
    ],
    "news": ["fontcolor=0xffffff", "box=1", "boxcolor=0xe11d48@0.92", "boxborderw=14"],
    "luxury": ["fontcolor=0xd4af37", "box=1", "boxcolor=0x050505@0.80", "boxborderw=18"],
    "karaoke": ["fontcolor=0xfff2a8", "box=1", "boxcolor=0x1d4ed8@0.86", "boxborderw=14"],
    "meme": [
        "fontcolor=0xffffff",
        "box=1",
        "boxcolor=0x000000@0.70",
        "boxborderw=12",
        "shadowcolor=0x000000",
        "shadowx=3",
        "shadowy=3",
    ],
    "documentary": ["fontcolor=0xf5f5dc", "box=1", "boxcolor=0x000000@0.58", "boxborderw=12"],
    "sports": [
        "fontcolor=0xccff00",
        "box=1",
        "boxcolor=0x111111@0.86",
        "boxborderw=16",
        "shadowcolor=0x000000",
        "shadowx=2",
        "shadowy=2",
    ],
    "soft": ["fontcolor=0xffc7d8", "box=1", "boxcolor=0x312e81@0.58", "boxborderw=14"],
}
EDITOR_CAPTION_UPPERCASE_TEMPLATES = {"mr-beast", "news", "meme", "sports"}


def _normalize_editor_timeline(
    captions: list[dict],
    markers: list[dict],
    trim_start_sec: float,
    trim_end_sec: float | None = None,
) -> tuple[list[dict], list[dict]]:
    """Shift editor source-timeline overlays onto the rendered trim timeline."""
    trim_start = max(0.0, float(trim_start_sec or 0.0))
    trim_end = float(trim_end_sec) if trim_end_sec is not None else None
    if trim_end is not None and trim_end <= trim_start:
        trim_end = None

    normalized_captions: list[dict] = []
    for cap in captions or []:
        try:
            start = float(cap["start_sec"])
            end = float(cap["end_sec"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= trim_start or (trim_end is not None and start >= trim_end):
            continue

        shifted = dict(cap)
        shifted["start_sec"] = round(max(0.0, start - trim_start), 3)
        shifted["end_sec"] = round(max(shifted["start_sec"], end - trim_start), 3)
        if trim_end is not None:
            shifted["end_sec"] = min(shifted["end_sec"], round(trim_end - trim_start, 3))
        if shifted["end_sec"] > shifted["start_sec"]:
            normalized_captions.append(shifted)

    normalized_markers: list[dict] = []
    trim_start_ms = int(round(trim_start * 1000))
    trim_end_ms = int(round(trim_end * 1000)) if trim_end is not None else None
    for marker in markers or []:
        try:
            marker_ms = int(marker["time_ms"])
        except (KeyError, TypeError, ValueError):
            continue
        if marker_ms < trim_start_ms or (trim_end_ms is not None and marker_ms > trim_end_ms):
            continue

        shifted = dict(marker)
        shifted["time_ms"] = max(0, marker_ms - trim_start_ms)
        normalized_markers.append(shifted)

    return normalized_captions, normalized_markers


def _build_caption_filter(captions: list[dict]) -> str:
    """Build ffmpeg drawtext filter chain for captions."""
    parts = []
    pos_map = {"top": "h*0.10", "center": "h*0.50", "bottom": "h*0.88"}
    for cap in captions:
        template = cap.get("template", "default")
        raw_text = cap["text"].upper() if template in EDITOR_CAPTION_UPPERCASE_TEMPLATES else cap["text"]
        text = raw_text.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
        y = pos_map.get(cap.get("position", "bottom"), "h*0.88")
        color = cap.get("color", "#ffffff").lstrip("#")
        size = cap.get("font_size", 24)
        t0 = cap["start_sec"]
        t1 = cap["end_sec"]
        opts = [
            f"drawtext=text='{text}'",
            f"fontsize={size}",
            f"x=(w-text_w)/2",
            f"y={y}",
            f"enable='between(t,{t0},{t1})'",
        ]
        if template in EDITOR_CAPTION_TEMPLATES:
            opts += EDITOR_CAPTION_TEMPLATES[template]
        else:
            opts += [f"fontcolor=0x{color}"]
        parts.append(":".join(opts))
    return ",".join(parts) if parts else ""


def _mix_sound_markers(
    source_path: str,
    markers: list[dict],
    output_path: str,
    base_cmd_prefix: list[str],
    source_has_audio: bool | None = None,
) -> list[str]:
    """
    Build ffmpeg command that mixes source video with sound WAV files.
    Returns full ffmpeg argv list.
    """
    valid = [m for m in markers if (SOUNDS_DIR / f"{m['sound']}.wav").exists()]
    if not valid:
        return []
    has_source_audio = _media_has_audio_stream(source_path) if source_has_audio is None else source_has_audio

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
    if has_source_audio:
        filter_parts.append(f"[0:a]{sfx_labels}amix=inputs={n_audio+1}:normalize=0[aout]")
    else:
        filter_parts.append(f"{sfx_labels}amix=inputs={n_audio}:normalize=0[aout]")
    filter_str = ";".join(filter_parts)

    return inputs + [
        "-filter_complex", filter_str,
        "-map", "0:v", "-map", "[aout]",
    ] + base_cmd_prefix + [output_path]
