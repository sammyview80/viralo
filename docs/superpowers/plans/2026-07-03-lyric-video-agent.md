# Lyric Video Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend Lyric Video Agent plan endpoint for existing songs: source in, rights gate, extracted/timed lyric plan out.

**Architecture:** Add a pure planner module under the agent service and expose it through a small FastAPI router. The planner is deterministic in v1: it normalizes supplied transcript text into timed lyric lines, identifies source type, applies rights warnings, and chooses a fixed template. Rendering remains a later video-worker task.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest, existing `agent` service.

## Global Constraints

- V1 must not scrape lyrics from Genius, Musixmatch, LyricFind, or public lyric sites.
- V1 must not download Spotify audio; Spotify links are metadata/source references only.
- V1 must not enqueue full MP4 rendering.
- V1 must not generate new song lyrics; it plans lyric videos from existing song audio/transcript.
- V1 must expose rights status and warnings in the response.
- Follow existing agent service patterns in `services/agent/agent/routers`.

---

## File Structure

- Create `services/agent/agent/lyric_video.py`: pure planning functions and dataclasses/constants. No FastAPI imports.
- Create `services/agent/agent/routers/lyric_videos.py`: request/response schemas and `POST /lyric-videos/plan`.
- Modify `services/agent/agent/main.py`: include the new router.
- Create `services/agent/tests/test_lyric_video_agent.py`: planner and router tests.
- Modify `frontend/src/lib/api.ts`: add TypeScript request/response types and `agentApi.planLyricVideo`.

---

### Task 1: Pure Lyric Video Planner

**Files:**
- Create: `services/agent/agent/lyric_video.py`
- Test: `services/agent/tests/test_lyric_video_agent.py`

**Interfaces:**
- Produces: `plan_lyric_video(source: dict, rights_confirmed: bool, transcript_text: str | None, aspect_ratio: str | None, template_hint: str | None) -> dict`
- Produces response keys: `source`, `rights`, `lyrics`, `template`, `warnings`, `needs_transcription`

- [ ] **Step 1: Write the failing planner tests**

Add this to `services/agent/tests/test_lyric_video_agent.py`:

```python
import os
import sys

agent_path = os.path.join(os.getcwd(), "services/agent")
if agent_path not in sys.path:
    sys.path.append(agent_path)

from agent.lyric_video import plan_lyric_video


def test_transcript_becomes_timed_lyric_lines():
    plan = plan_lyric_video(
        source={"type": "upload", "title": "Demo Song", "artist": "Demo Artist"},
        rights_confirmed=True,
        transcript_text="First line\nSecond line",
        aspect_ratio="16:9",
        template_hint="neon-karaoke",
    )

    assert plan["needs_transcription"] is False
    assert plan["rights"]["status"] == "user_confirmed"
    assert plan["source"]["type"] == "upload"
    assert plan["lyrics"][0]["text"] == "First line"
    assert plan["lyrics"][0]["start_sec"] == 0.0
    assert plan["lyrics"][0]["end_sec"] > plan["lyrics"][0]["start_sec"]
    assert plan["lyrics"][1]["start_sec"] == plan["lyrics"][0]["end_sec"]
    assert plan["template"]["id"] == "neon-karaoke"
    assert plan["template"]["aspect_ratio"] == "16:9"


def test_spotify_source_is_metadata_only_and_needs_audio_or_transcript():
    plan = plan_lyric_video(
        source={"type": "spotify", "url": "https://open.spotify.com/track/abc"},
        rights_confirmed=True,
        transcript_text=None,
        aspect_ratio=None,
        template_hint=None,
    )

    assert plan["source"]["type"] == "spotify"
    assert plan["needs_transcription"] is True
    assert "spotify_metadata_only" in plan["warnings"]
    assert plan["lyrics"] == []


def test_missing_rights_confirmation_adds_warning():
    plan = plan_lyric_video(
        source={"type": "youtube", "url": "https://youtube.com/watch?v=abc12345678"},
        rights_confirmed=False,
        transcript_text="hello world",
        aspect_ratio="9:16",
        template_hint=None,
    )

    assert plan["rights"]["status"] == "unknown"
    assert "rights_not_confirmed" in plan["warnings"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
uv run pytest services/agent/tests/test_lyric_video_agent.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'agent.lyric_video'`.

- [ ] **Step 3: Implement the minimal planner**

Create `services/agent/agent/lyric_video.py`:

```python
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
        lyrics.append({
            "text": line,
            "start_sec": round(t, 2),
            "end_sec": end,
            "confidence": 0.7,
            "source": "transcript",
        })
        t = end
    return lyrics
```

- [ ] **Step 4: Run tests to verify planner passes**

Run:

```bash
uv run pytest services/agent/tests/test_lyric_video_agent.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent/agent/lyric_video.py services/agent/tests/test_lyric_video_agent.py
git commit -m "feat: add lyric video planner"
```

---

### Task 2: Agent API Route

**Files:**
- Create: `services/agent/agent/routers/lyric_videos.py`
- Modify: `services/agent/agent/main.py`
- Test: `services/agent/tests/test_lyric_video_agent.py`

**Interfaces:**
- Consumes: `plan_lyric_video(...) -> dict`
- Produces: `POST /api/v1/agent/lyric-videos/plan`
- Produces schemas: `LyricVideoPlanRequest`, `LyricVideoPlanResponse`

- [ ] **Step 1: Add failing route tests**

Append to `services/agent/tests/test_lyric_video_agent.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_lyric_video_plan_route_returns_plan():
    from agent.routers.lyric_videos import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.post(
        "/lyric-videos/plan",
        json={
            "source": {"type": "upload", "title": "Demo"},
            "rights_confirmed": True,
            "transcript_text": "Line one\nLine two",
            "aspect_ratio": "9:16",
            "template_hint": "minimal-black",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["lyrics"][0]["text"] == "Line one"
    assert data["template"]["id"] == "minimal-black"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
uv run pytest services/agent/tests/test_lyric_video_agent.py::test_lyric_video_plan_route_returns_plan -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'agent.routers.lyric_videos'`.

- [ ] **Step 3: Implement the route**

Create `services/agent/agent/routers/lyric_videos.py`:

```python
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from agent.lyric_video import plan_lyric_video

router = APIRouter(tags=["lyric-videos"])


class LyricVideoSource(BaseModel):
    type: Literal["upload", "youtube", "spotify", "metadata"] = "metadata"
    title: str | None = None
    artist: str | None = None
    url: str | None = None


class LyricVideoPlanRequest(BaseModel):
    source: LyricVideoSource = Field(default_factory=LyricVideoSource)
    rights_confirmed: bool = False
    transcript_text: str | None = None
    aspect_ratio: Literal["9:16", "16:9", "1:1", "4:5"] | None = None
    template_hint: str | None = None


class LyricVideoPlanResponse(BaseModel):
    source: dict[str, Any]
    rights: dict[str, Any]
    lyrics: list[dict[str, Any]]
    template: dict[str, Any]
    warnings: list[str]
    needs_transcription: bool


@router.post("/lyric-videos/plan", response_model=LyricVideoPlanResponse)
async def create_lyric_video_plan(body: LyricVideoPlanRequest):
    return plan_lyric_video(
        source=body.source.model_dump(),
        rights_confirmed=body.rights_confirmed,
        transcript_text=body.transcript_text,
        aspect_ratio=body.aspect_ratio,
        template_hint=body.template_hint,
    )
```

Modify `services/agent/agent/main.py`:

```python
from agent.routers import lyric_videos, sessions, tags, trends, ws
```

and add:

```python
app.include_router(lyric_videos.router, prefix="/api/v1/agent")
```

- [ ] **Step 4: Run route test**

Run:

```bash
uv run pytest services/agent/tests/test_lyric_video_agent.py::test_lyric_video_plan_route_returns_plan -q
```

Expected: PASS.

- [ ] **Step 5: Run all agent lyric tests**

Run:

```bash
uv run pytest services/agent/tests/test_lyric_video_agent.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/agent/agent/main.py services/agent/agent/routers/lyric_videos.py services/agent/tests/test_lyric_video_agent.py
git commit -m "feat: expose lyric video plan endpoint"
```

---

### Task 3: Frontend API Types

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `POST /lyric-videos/plan`
- Produces: `agentApi.planLyricVideo(data: LyricVideoPlanRequest): Promise<LyricVideoPlanResponse>`

- [ ] **Step 1: Add TypeScript API types**

Modify `frontend/src/lib/api.ts` near the Agent API section:

```ts
export interface LyricVideoSource {
  type: "upload" | "youtube" | "spotify" | "metadata";
  title?: string | null;
  artist?: string | null;
  url?: string | null;
}

export interface LyricVideoPlanRequest {
  source: LyricVideoSource;
  rights_confirmed: boolean;
  transcript_text?: string | null;
  aspect_ratio?: "9:16" | "16:9" | "1:1" | "4:5" | null;
  template_hint?: string | null;
}

export interface LyricLinePlan {
  text: string;
  start_sec: number;
  end_sec: number;
  confidence: number;
  source: string;
}

export interface LyricVideoPlanResponse {
  source: Record<string, unknown>;
  rights: Record<string, unknown>;
  lyrics: LyricLinePlan[];
  template: Record<string, unknown>;
  warnings: string[];
  needs_transcription: boolean;
}
```

Add inside `agentApi`:

```ts
  planLyricVideo: (data: LyricVideoPlanRequest) =>
    agentReq<LyricVideoPlanResponse>("POST", "/lyric-videos/plan", data),
```

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS. Existing Vite/Radix sourcemap warnings are acceptable if build exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add lyric video agent API client"
```

---

### Task 4: Final Verification

**Files:**
- Verify only.

**Interfaces:**
- Verifies the planner, route, and frontend API compile together.

- [ ] **Step 1: Run focused Python tests**

Run:

```bash
uv run pytest services/agent/tests/test_lyric_video_agent.py services/agent/tests/test_viral_search.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff --stat dev...HEAD
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Commit any verification-only fixes**

If any fix was needed:

```bash
git add services/agent/agent/lyric_video.py services/agent/agent/routers/lyric_videos.py services/agent/agent/main.py services/agent/tests/test_lyric_video_agent.py frontend/src/lib/api.ts
git commit -m "fix: harden lyric video agent contract"
```

If no fixes were needed, do not create a commit.
