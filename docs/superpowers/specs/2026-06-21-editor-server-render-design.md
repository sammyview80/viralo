# Server-Side Video Render Design

**Goal:** Move all video computation (trim, captions, sound effects, export) from browser to server-side FFmpeg. Browser canvas stays for real-time preview only.

## Problem

Current browser export uses `MediaRecorder` + Canvas = low-quality WebM, no real trim, caption rendering depends on screen resolution, sound effects lost on export.

## Architecture

### Data Flow

```
Browser (preview only)          Server (render)
─────────────────────           ───────────────
Canvas rAF loop                 Celery task: render_clip_with_edits
  ↓ real-time preview             ↓ FFmpeg pipeline
User clicks Export/Save           ↓ trim (-ss / -to)
  ↓ POST /clips/{id}/render       ↓ captions (drawtext filter)
  ↓ poll GET /clips/{id}/render   ↓ sound effects (amix + WAV files)
  ↓ show progress + download      ↓ output MP4 H.264 → storage
```

### Render Job Payload

```json
{
  "trim_start_sec": 5.0,
  "trim_end_sec": 30.0,
  "captions": [{ "text": "Hello", "start_sec": 5, "end_sec": 10, "position": "bottom", "color": "#ffffff", "font_size": 24 }],
  "markers": [{ "time_ms": 7000, "sound": "ding", "emoji": "🔔" }],
  "quality": "1080p",
  "aspect_ratio": "9:16"
}
```

## Backend

### New files

- `services/video/video/tasks/render_with_edits.py` — Celery task
- `services/video/video/routers/render.py` — REST endpoints
- `services/video/video/ffmpeg_builder.py` — FFmpeg command builder
- `services/video/assets/sounds/` — Pre-baked WAV files (ding.wav, quack.wav, etc.)

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/clips/{id}/render` | Enqueue render job, return `render_id` |
| GET | `/clips/{id}/render/{render_id}` | Poll status + progress |

### Celery Task: `render_clip_with_edits`

1. Download source clip from storage
2. Build FFmpeg command:
   - `-ss {trim_start} -to {trim_end}` for trim
   - `drawtext` filter chain for each caption
   - `-i sound.wav` + `amix` for each marker
3. Run FFmpeg subprocess
4. Upload output to storage
5. Update `clip.clip_metadata["renders"]` with result URL + status
6. Notify via existing Redis pub/sub

### FFmpeg caption filter

```
drawtext=text='Hello':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=h*0.88:enable='between(t,5,10)'
```

Position mapping: `top→h*0.10`, `center→h*0.50`, `bottom→h*0.88`

### Sound effects

Pre-bake 6 WAV files at `assets/sounds/{sound}.wav` using Python `scipy` or embed as base64 constants. Mix into output with:
```
ffmpeg -i clip.mp4 -i ding.wav -filter_complex "[1:a]adelay=7000|7000[sfx];[0:a][sfx]amix=inputs=2" output.mp4
```

## Frontend

### Changes to VideoEditor.tsx

- Remove `handleExport` MediaRecorder logic
- Remove `handleSave` MediaRecorder logic
- Add `handleRender(quality)` → POST `/clips/{id}/render`
- Add render status polling hook `useRenderJob(clipId, renderId)`
- Show progress bar + "Download" button when render complete
- Keep canvas preview loop untouched

### New component: `RenderPanel.tsx`

Shows render queue, progress bar, quality selector, download button.

### Quality presets

| Label | FFmpeg flags |
|-------|-------------|
| Draft | `-crf 32 -preset ultrafast` |
| 720p | `-crf 26 -preset fast -vf scale=-2:720` |
| 1080p | `-crf 22 -preset fast -vf scale=-2:1080` |

## Constraints

- Source clip must exist in storage (no storage_url = render blocked, show warning)
- Render is async — no synchronous export
- Multiple renders allowed per clip (stored in `clip_metadata.renders[]`)
- Sound WAV files pre-baked at startup, embedded in Docker image
- FFmpeg must be installed in video service Docker image (already is for existing pipeline)

## Out of Scope

- Real-time collaborative editing
- Waveform display
- Undo/redo
