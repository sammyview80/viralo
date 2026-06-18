"""
Template registry for occasion-aware clip rendering.
Each template drives caption style, hook overlay, voiceover, music, and zoom behavior.
"""
from __future__ import annotations
from pathlib import Path

_ASSETS_DIR = Path(__file__).parent.parent / "assets"
MUSIC_DIR = _ASSETS_DIR / "music"

# Keys reference filenames in workers/assets/music/.
# Tracks must be CC0/royalty-free — verify license before adding.
MUSIC_TRACKS: dict[str, str] = {
    "hype":     str(MUSIC_DIR / "hype.mp3"),
    "dramatic": str(MUSIC_DIR / "dramatic.mp3"),
    "chill":    str(MUSIC_DIR / "chill.mp3"),
}

TEMPLATES: dict[str, dict] = {
    "sports-hype": {
        "caption_style":     "capcut-bold",
        "hook_overlay":      True,
        "hook_duration_sec": 3.0,
        "voiceover":         True,
        "music_track":       "hype",
        "punch_zoom":        True,
        "background_style":  "blur_fill",   # blurred landscape bg under portrait crop
    },
    "gaming-clutch": {
        "caption_style":     "capcut-bold",
        "hook_overlay":      True,
        "hook_duration_sec": 3.0,
        "voiceover":         True,
        "music_track":       "hype",
        "punch_zoom":        False,
        "background_style":  "center_crop",
    },
    "cinematic": {
        "caption_style":     "classic",
        "hook_overlay":      True,
        "hook_duration_sec": 3.0,
        "voiceover":         True,
        "music_track":       "dramatic",
        "punch_zoom":        False,
        "background_style":  "blur_fill",
    },
    "music-vibe": {
        "caption_style":     "capcut-bold",
        "hook_overlay":      True,
        "hook_duration_sec": 2.5,
        "voiceover":         False,
        "music_track":       "hype",
        "punch_zoom":        True,
        "background_style":  "blur_fill",
    },
    "talking-head": {
        "caption_style":     "capcut",
        "hook_overlay":      True,
        "hook_duration_sec": 3.5,
        "voiceover":         False,
        "music_track":       "chill",
        "punch_zoom":        False,
        "background_style":  "center_crop",
    },
    "generic": {
        "caption_style":     "capcut",
        "hook_overlay":      False,
        "hook_duration_sec": 3.0,
        "voiceover":         False,
        "music_track":       None,
        "punch_zoom":        False,
        "background_style":  "center_crop",
    },
}

OCCASION_TEMPLATE: dict[str, str] = {
    # Football / soccer
    "football":  "sports-hype",
    "soccer":    "sports-hype",
    "sports":    "sports-hype",
    # Cricket
    "cricket":   "sports-hype",
    # Combat sports
    "ufc":       "sports-hype",
    "boxing":    "sports-hype",
    "mma":       "sports-hype",
    # Motorsport
    "f1":        "sports-hype",
    "racing":    "sports-hype",
    # Gaming / esports
    "gaming":    "gaming-clutch",
    "esports":   "gaming-clutch",
    # Talk / commentary
    "podcast":   "talking-head",
    "interview": "talking-head",
    # Music / concerts
    "concert":   "music-vibe",
    "music":     "music-vibe",
    # Life events
    "wedding":   "cinematic",
    "travel":    "cinematic",
    # Default
    "general":   "generic",
}


def resolve_template(occasion: str | None, template_id_override: str | None = None) -> dict:
    """Return the render spec dict for a given occasion, with optional explicit override."""
    if template_id_override and template_id_override in TEMPLATES:
        return dict(TEMPLATES[template_id_override])
    key = (occasion or "").lower()
    tid = OCCASION_TEMPLATE.get(key, "generic")
    return dict(TEMPLATES.get(tid, TEMPLATES["generic"]))
