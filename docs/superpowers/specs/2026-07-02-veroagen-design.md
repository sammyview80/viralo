# Veroagen — AI Video Production Agent (Flova-style) — Design Spec

Date: 2026-07-02
Status: Approved by user (brainstorming session)

## What

Veroagen is a full Flova AI clone: a conversational AI video production agent. The user
describes a video idea in chat; the agent writes the script, builds a storyboard, generates
character references, produces per-shot images and videos, adds voiceover and music,
assembles a timeline, and exports a finished mp4. The user watches everything appear live
in a workspace and can manually fine-tune any artifact.

## Decisions made

| Decision | Choice |
|---|---|
| Relationship to viralo | Separate backend product; viralo backend untouched |
| Frontend location | New app section inside viralo repo (React 19 + Vite + Tailwind + Radix) |
| Backend | New repo `veroagen-backend`: Python FastAPI + Postgres + Redis + worker queue (ARQ or Celery) |
| Auth | Shared with viralo — veroagen validates viralo-issued JWTs; no new user table, `user_id` reference only |
| Agent architecture | Structured orchestrator: LLM tool-calling loop over typed tools mutating a shared Project doc. No code sandbox (possible `run_ffmpeg` escape hatch later) |
| Media generation | fal.ai aggregator for ALL media models (images, video, voice, music) |
| Agent LLM | Port viralo `shared/shared/llm.py` + `config/llm.yml` free-tier fallback chain, extended with tool-calling + streaming and native anthropic / openai / azure-openai providers. Large model for agent turns, free chain for cheap tasks |
| Scope | Full clone, built in 4 phases |

## Architecture

### Core data model — the Project doc (single source of truth)

```
Project
├─ Chat        (messages, agent action log)
├─ Script      (scenes → beats, narration text)
├─ Characters  (name, description, locked reference images — consistency anchors)
├─ Storyboard  (Shot[]: scene ref, prompt, character refs, camera params, duration,
│               status: draft → image_ready → video_ready)
├─ Assets      (images, video clips, voiceover audio, music — stored in S3/R2)
└─ Timeline    (tracks: video / voice / music; clips with in/out points, transitions)
```

- Every agent tool call mutates this doc.
- Every mutation is broadcast over WebSocket → UI re-renders live.
- Manual UI edits write the same doc via REST → the agent sees them on its next turn.
- This bidirectional shared state implements Flova's "brain (chat) / hands (workspace)" split.

### Agent (the brain)

- Backend tool-calling loop, streamed to the chat UI.
- Typed tools (~15): `update_script`, `create_character`, `gen_character_ref`,
  `update_storyboard`, `gen_shot_image`, `gen_shot_video`, `gen_voiceover`, `gen_music`,
  `edit_timeline`, `render_export`, `ask_user`, plus read/query tools.
- Long generations (video takes minutes) never block chat: the tool enqueues a worker job
  and returns a job id; the agent continues. Job completion emits a system event into the
  chat, which the agent reacts to (e.g. advancing the storyboard status).

### Generation layer

- fal.ai client, one API key. Model per task: FLUX / Nano Banana (images),
  Kling / Veo / Seedance (video), voice + music models.
- Model routing = agent decision, with per-shot user override in the UI.
- Character consistency: the locked character reference image is passed as image
  conditioning to every shot generation involving that character.
- Final export: worker stitches the timeline with ffmpeg (concat, transitions, audio mix)
  → mp4 → object storage → download link.

### UI (the hands)

- Flova-style split layout: right panel = agent chat with streaming responses and action
  cards visualizing tool calls; left workspace with tabs:
  **Script | Characters | Storyboard | Timeline**.
- Storyboard: shot-card grid with per-shot regenerate and model picker.
- Timeline: custom track editor (drag, trim, transitions) — the largest frontend component.
- All views live-update via WebSocket.

### Error handling

- LLM provider failures: existing fallback-chain semantics (probe, skip dead providers,
  escalate to paid last).
- Generation job failures: shot status marked failed with provider error; agent notified
  via system event and can retry with a different model or surface to user.
- WebSocket drops: client re-syncs full Project doc on reconnect (doc is authoritative).

### Testing

- Backend: unit tests per tool (mutations against Project doc), fal.ai client mocked;
  integration test of one full agent turn with a stub LLM.
- Worker: job lifecycle tests with mocked fal.ai + ffmpeg smoke test on fixture clips.
- Frontend: component tests for storyboard/timeline state reducers.

## Phasing — four sub-projects, each with its own spec → plan → implementation

1. **Foundation** — backend skeleton, viralo-JWT auth bridge, Project doc + WebSocket
   sync, agent loop with script/storyboard tools, chat UI + Script/Storyboard views.
   No media generation.
2. **Generation** — fal.ai integration, characters + consistency, per-shot image and
   video generation, asset storage, job queue with completion events.
3. **Timeline & export** — timeline editor UI, voiceover + music, ffmpeg render/export.
4. **Polish** — model-router UI, regeneration flows, camera controls, billing/credits.

Phase 1 is the next unit of work: it gets its own implementation plan first.
