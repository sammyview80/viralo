from __future__ import annotations

from urllib.parse import urlparse

TEMPLATES = {
    "neon-karaoke": {
        "id": "neon-karaoke",
        "label": "Neon Karaoke",
        "caption_style": "karaoke-cyan",
        "visual_notes": "Dark motion background with cyan active-word glow.",
    },
    "minimal-black": {
        "id": "minimal-black",
        "label": "Minimal Black",
        "caption_style": "classic",
        "visual_notes": "Black background with clean centered white lyric lines.",
    },
    "album-motion": {
        "id": "album-motion",
        "label": "Album Art Motion",
        "caption_style": "karaoke",
        "visual_notes": "Album art, slow zoom, and lower-third synced lyrics.",
    },
}

DEFAULT_TEMPLATE = "neon-karaoke"
DEFAULT_ASPECT_RATIO = "9:16"
SUPPORTED_SOURCE_TYPES = {"upload", "youtube", "spotify", "metadata"}


def plan_lyric_video(
    source: dict,
    rights_confirmed: bool,
    transcript_text: str | None,
    aspect_ratio: str | None,
    template_hint: str | None,
) -> dict:
    source_out, source_warnings = _normalize_source(source)
    warnings = list(source_warnings)

    rights = {
        "status": "user_confirmed" if rights_confirmed else "unknown",
        "requires_confirmation": not rights_confirmed,
    }
    if not rights_confirmed:
        warnings.append("rights_not_confirmed")

    lyrics = _lyrics_from_transcript(transcript_text or "")
    needs_transcription = not lyrics
    if source_out["type"] == "spotify":
        warnings.append("spotify_metadata_only")
        needs_transcription = True
    if needs_transcription and source_out["type"] != "spotify":
        warnings.append("lyrics_need_transcription")

    template = dict(TEMPLATES.get(template_hint or "", TEMPLATES[DEFAULT_TEMPLATE]))
    template["aspect_ratio"] = aspect_ratio or DEFAULT_ASPECT_RATIO

    return {
        "source": source_out,
        "rights": rights,
        "lyrics": lyrics,
        "template": template,
        "warnings": warnings,
        "needs_transcription": needs_transcription,
    }


def _normalize_source(source: dict) -> tuple[dict, list[str]]:
    source_type = str(source.get("type") or "metadata").lower()
    warnings: list[str] = []
    if source_type not in SUPPORTED_SOURCE_TYPES:
        source_type = "metadata"
        warnings.append("unsupported_source_type")

    url = source.get("url")
    if url:
        host = (urlparse(str(url)).hostname or "").lower()
        if "spotify.com" in host:
            source_type = "spotify"
        elif "youtube.com" in host or "youtu.be" in host:
            source_type = "youtube"
        elif source_type != "upload":
            warnings.append("unsupported_source_url")

    return {
        "type": source_type,
        "title": source.get("title"),
        "artist": source.get("artist"),
        "url": url,
    }, warnings


def _lyrics_from_transcript(transcript_text: str) -> list[dict]:
    lines = [line.strip() for line in transcript_text.splitlines() if line.strip()]
    lyrics: list[dict] = []
    t = 0.0
    for line in lines:
        duration = max(1.8, min(5.0, len(line.split()) * 0.55))
        end = round(t + duration, 2)
        lyrics.append(
            {
                "text": line,
                "start_sec": round(t, 2),
                "end_sec": end,
                "confidence": 0.7,
                "source": "transcript",
            }
        )
        t = end
    return lyrics
