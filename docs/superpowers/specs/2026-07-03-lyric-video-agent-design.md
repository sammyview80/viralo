# Lyric Video Agent Design

## Goal

Build a backend-first Lyric Video Agent that turns an existing song source into a structured lyric-video plan: extracted lyrics, line timings, confidence flags, and a visual template recommendation. The first implementation does not render the final MP4; it creates the reliable contract that a renderer can consume next.

## Scope

The v1 agent accepts an uploaded audio reference, YouTube URL, Spotify URL, or plain metadata, but it only generates lyrics from actual supplied audio when the user confirms they have rights to use it. Spotify is metadata-only. YouTube is accepted as a source reference, but the agent must preserve a rights-gate field so the product can block or warn before commercial use.

The v1 output is JSON suitable for preview and user editing:

- source metadata: title, artist, source type, original URL if present
- rights status: user-confirmed, licensed-provider, unknown, or blocked
- lyrics: timestamped lines with confidence
- template recommendation: id, aspect ratio, caption style, visual notes
- warnings: transcription uncertainty, rights risk, missing audio, unsupported URL

## Non-Goals

V1 does not scrape lyrics from Genius, Musixmatch, LyricFind, or random lyric sites. It does not download Spotify audio. It does not enqueue full video rendering. It does not create new song lyrics unless a later request adds an original-song mode.

## Architecture

Add a small `lyrics` router to the existing agent service. The router calls a pure planning module that is easy to test without FastAPI or an LLM. The planning module validates the source, applies rights rules, normalizes an optional transcript into timed lyric lines, and chooses a template from a fixed catalog.

The first pass uses deterministic heuristics for confidence and timing. If a transcript is provided, it becomes lyric lines. If no transcript/audio text is available, the plan returns `needs_transcription=true` and tells the caller what the worker must do next. This keeps v1 robust without pretending audio transcription exists in the agent service.

## Data Flow

1. Frontend or API sends `POST /api/v1/agent/lyric-videos/plan`.
2. Request includes source info, rights confirmation, optional transcript text, desired aspect ratio, and optional template hint.
3. Router validates the request through Pydantic schemas.
4. Planner resolves the source type, rights gate, lyric lines, template, and warnings.
5. Router returns a plan response immediately.

## Safety And Rights

The agent never claims ownership of extracted lyrics. For existing songs, it requires one of:

- user confirms they own or have permission to use the song
- future licensed provider supplies lyrics
- internal draft mode with clear warning

If the request asks to copy lyrics from an existing song without user-supplied audio/transcript or licensed lyrics, v1 returns a blocked/needs-input plan instead of hallucinating lyrics.

## Testing

Use focused Python tests around the pure planner and one lightweight router-level schema test. Required coverage:

- Spotify URL is metadata-only and cannot be treated as audio
- provided transcript becomes timestamped lyric lines
- missing rights confirmation produces a warning
- unsupported source URLs are rejected
- template hint chooses a valid template, otherwise default is stable

## Future Render Handoff

The renderer will consume the v1 plan later by converting lyric lines into existing `CaptionSegment` data and using current karaoke caption styles. That should happen in the video worker, not in the agent service.
