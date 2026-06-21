# Server-Side Video Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move export/save computation from browser MediaRecorder to server-side FFmpeg; browser canvas stays for preview only.

**Architecture:** Frontend POSTs editor state to `POST /clips/{id}/render`, which enqueues a Celery task. Task downloads source clip, runs FFmpeg (trim + drawtext captions + WAV sound mix), uploads result to storage, updates `clip_metadata.renders`. Frontend polls `GET /clips/{id}/render/{render_id}` until done then shows download link.

**Tech Stack:** FastAPI, Celery (existing `workers/tasks/video.py`), FFmpeg subprocess (already in Docker image), Python `wave`+`struct` for WAV generation, React + fetch polling.

## Global Constraints

- FFmpeg already installed in video worker Docker image — do NOT add new system deps
- Celery task name format: `workers.tasks.video.<task_name>` (matches existing pattern)
- Storage: use `shared.storage.base.get_storage` with `STORAGE_PROVIDER` env var
- `clip_metadata` is JSONB on the `Clip` model — merge, never replace
- All new backend files go in `services/video/video/` or `workers/tasks/`
- New frontend files go in `frontend/src/workspace/components/editor/`
- Keep files under 500 lines
- No Co-Authored-By in commits

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `workers/tasks/video.py` | Modify (append) | Add `render_clip_with_edits` Celery task |
| `workers/assets/sounds/` | Create dir + 6 WAV files | Pre-baked sound effects |
| `workers/tasks/sound_gen.py` | Create | Generate WAV bytes for each sound type |
| `services/video/video/routers/render.py` | Create | POST /render + GET /render/{id} endpoints |
| `services/video/video/routers/__init__.py` | Modify | Register render router |
| `services/video/video/main.py` | Modify | Include render router |
| `services/video/video/schemas.py` | Modify | Add RenderRequest, RenderStatusResponse |
| `frontend/src/lib/api.ts` | Modify | Add `renderApi.startRender`, `renderApi.getStatus` |
| `frontend/src/workspace/components/editor/RenderPanel.tsx` | Create | Quality picker + progress + download |
| `frontend/src/workspace/components/VideoEditor.tsx` | Modify | Replace export/save MediaRecorder with RenderPanel |

---

### Task 1: Pre-bake WAV sound effect files

**Files:**
- Create: `workers/tasks/sound_gen.py`
- Create: `workers/assets/sounds/` (6 WAV files via script)

**Interfaces:**
- Produces: `workers/assets/sounds/{ding,quack,applause,airhorn,womp,tada}.wav` — read by Task 3

- [ ] **Step 1: Create `workers/tasks/sound_gen.py`**

```python
"""Generate and write pre-baked WAV files for editor sound effects."""
import math
import os
import random
import struct
import wave
from pathlib import Path

SOUNDS_DIR = Path(__file__).parent.parent / "assets" / "sounds"
SAMPLE_RATE = 44100


def _write_wav(path: Path, samples: list[float]) -> None:
    clamped = [max(-1.0, min(1.0, s)) for s in samples]
    pcm = struct.pack(f"<{len(clamped)}h", *[int(s * 32767) for s in clamped])
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(pcm)


def _sine(freq: float, dur: float, amp: float = 0.5) -> list[float]:
    n = int(SAMPLE_RATE * dur)
    return [amp * math.sin(2 * math.pi * freq * i / SAMPLE_RATE) for i in range(n)]


def _env(samples: list[float], attack: float, release: float) -> list[float]:
    n = len(samples)
    atk = int(SAMPLE_RATE * attack)
    rel = int(SAMPLE_RATE * release)
    out = list(samples)
    for i in range(min(atk, n)):
        out[i] *= i / atk
    for i in range(max(0, n - rel), n):
        out[i] *= (n - i) / rel
    return out


def gen_ding() -> list[float]:
    s = _sine(1047, 0.9, 0.5)
    return _env(s, 0.005, 0.7)


def gen_quack() -> list[float]:
    n = int(SAMPLE_RATE * 0.22)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 900 * math.exp(-t / 0.1 * math.log(3))
        out.append(0.5 * (1 if math.sin(2 * math.pi * freq * t) > 0 else -1))
    return _env(out, 0.002, 0.05)


def gen_applause() -> list[float]:
    n = int(SAMPLE_RATE * 0.9)
    random.seed(42)
    out = []
    for i in range(n):
        env = i / (SAMPLE_RATE * 0.3) if i < SAMPLE_RATE * 0.3 else 1 - (i - SAMPLE_RATE * 0.3) / (SAMPLE_RATE * 0.6)
        out.append((random.random() * 2 - 1) * env * 0.5)
    return out


def gen_airhorn() -> list[float]:
    n = int(SAMPLE_RATE * 0.5)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 220 + (440 - 220) * min(t / 0.06, 1)
        out.append(0.35 * (1 if math.sin(2 * math.pi * freq * t) > 0 else -1))
    return _env(out, 0.002, 0.3)


def gen_womp() -> list[float]:
    n = int(SAMPLE_RATE * 0.65)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 400 * math.exp(-t / 0.65 * math.log(8))
        out.append(0.4 * (1 if math.sin(2 * math.pi * freq * t) > 0 else -1))
    return _env(out, 0.002, 0.1)


def gen_tada() -> list[float]:
    freqs = [523, 659, 784, 1047]
    total = int(SAMPLE_RATE * (0.1 * len(freqs) + 0.4))
    out = [0.0] * total
    for idx, freq in enumerate(freqs):
        start = int(SAMPLE_RATE * idx * 0.1)
        seg = _env(_sine(freq, 0.4, 0.35), 0.01, 0.3)
        for j, v in enumerate(seg):
            if start + j < total:
                out[start + j] += v
    return out


GENERATORS = {
    "ding": gen_ding,
    "quack": gen_quack,
    "applause": gen_applause,
    "airhorn": gen_airhorn,
    "womp": gen_womp,
    "tada": gen_tada,
}


def ensure_sounds() -> None:
    SOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    for name, fn in GENERATORS.items():
        path = SOUNDS_DIR / f"{name}.wav"
        if not path.exists():
            _write_wav(path, fn())


if __name__ == "__main__":
    ensure_sounds()
    print(f"Generated WAVs in {SOUNDS_DIR}")
```

- [ ] **Step 2: Generate WAV files**

```bash
cd /path/to/viralo
python workers/tasks/sound_gen.py
ls workers/assets/sounds/
```
Expected: `airhorn.wav  applause.wav  ding.wav  quack.wav  tada.wav  womp.wav`

- [ ] **Step 3: Commit**

```bash
git add workers/tasks/sound_gen.py workers/assets/sounds/
git commit -m "feat(editor): pre-bake WAV sound effect files for server render"
```

---

### Task 2: Backend schemas for render request/response

**Files:**
- Modify: `services/video/video/schemas.py` (append after `EditorDataResponse`)

**Interfaces:**
- Consumes: existing `EditorCaption`, `EditorMarker` from same file
- Produces: `RenderRequest`, `RenderStatusResponse` — used by Task 3 endpoints

- [ ] **Step 1: Add schemas to `services/video/video/schemas.py`**

Append after the `EditorDataResponse` class (around line 118):

```python
from typing import Literal as _Literal  # already imported above as Literal — use that

class RenderRequest(BaseModel):
    trim_start_sec: float = Field(default=0, ge=0)
    trim_end_sec: float | None = Field(default=None, ge=0)
    captions: list[EditorCaption] = Field(default_factory=list)
    markers: list[EditorMarker] = Field(default_factory=list)
    quality: Literal["draft", "720p", "1080p"] = "1080p"


class RenderStatusResponse(BaseModel):
    render_id: str
    clip_id: uuid.UUID
    status: Literal["queued", "processing", "done", "error"]
    progress_pct: int = 0
    download_url: str | None = None
    error_message: str | None = None
    created_at: str
```

- [ ] **Step 2: Verify no import errors**

```bash
cd services/video && python -c "from video.schemas import RenderRequest, RenderStatusResponse; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add services/video/video/schemas.py
git commit -m "feat(editor): add RenderRequest and RenderStatusResponse schemas"
```

---

### Task 3: Celery task `render_clip_with_edits`

**Files:**
- Modify: `workers/tasks/video.py` (append new task at end of file)

**Interfaces:**
- Consumes: `workers/assets/sounds/{sound}.wav` from Task 1
- Consumes: `_storage_url_to_relative_path(storage_url)` — already defined in `workers/tasks/video.py` at line ~145
- Consumes: `get_storage` from `shared.storage.base`
- Produces: Celery task name `"workers.tasks.video.render_clip_with_edits"` — called by Task 4

- [ ] **Step 1: Append Celery task to `workers/tasks/video.py`**

Add at the very end of `workers/tasks/video.py`:

```python
# ── Editor server-side render ─────────────────────────────────────────────────

SOUNDS_DIR = Path(__file__).parent.parent / "assets" / "sounds"

QUALITY_PRESETS = {
    "draft":  ["-crf", "32", "-preset", "ultrafast"],
    "720p":   ["-crf", "26", "-preset", "fast", "-vf", "scale=-2:720"],
    "1080p":  ["-crf", "22", "-preset", "fast", "-vf", "scale=-2:1080"],
}


def _build_caption_filter(captions: list[dict]) -> str:
    """Build ffmpeg drawtext filter chain for captions."""
    parts = []
    pos_map = {"top": "h*0.10", "center": "h*0.50", "bottom": "h*0.88"}
    for cap in captions:
        text = cap["text"].replace("'", "\\'").replace(":", "\\:")
        y = pos_map.get(cap.get("position", "bottom"), "h*0.88")
        color = cap.get("color", "#ffffff").lstrip("#")
        size = cap.get("font_size", 24)
        t0 = cap["start_sec"]
        t1 = cap["end_sec"]
        parts.append(
            f"drawtext=text='{text}':fontsize={size}:fontcolor=0x{color}:"
            f"x=(w-text_w)/2:y={y}:enable='between(t,{t0},{t1})'"
        )
    return ",".join(parts) if parts else ""


def _mix_sound_markers(
    source_path: str,
    markers: list[dict],
    output_path: str,
    base_cmd_prefix: list[str],
) -> list[str]:
    """
    Build ffmpeg command that mixes source video with sound WAV files.
    Returns full ffmpeg argv list.
    """
    valid = [m for m in markers if (SOUNDS_DIR / f"{m['sound']}.wav").exists()]
    if not valid:
        return []

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
    filter_parts.append(f"[0:a]{sfx_labels}amix=inputs={n_audio+1}:normalize=0[aout]")
    filter_str = ";".join(filter_parts)

    return inputs + [
        "-filter_complex", filter_str,
        "-map", "0:v", "-map", "[aout]",
    ] + base_cmd_prefix + [output_path]


@celery_app.task(bind=True, name="workers.tasks.video.render_clip_with_edits", max_retries=2)
def render_clip_with_edits(
    self,
    tenant_id: str,
    clip_id: str,
    render_id: str,
    storage_url: str,
    trim_start_sec: float,
    trim_end_sec: float | None,
    captions: list[dict],
    markers: list[dict],
    quality: str,
):
    import tempfile
    import uuid as _uuid
    from pathlib import Path as _Path

    from shared.db import SyncSessionLocal
    from shared.storage.base import get_storage
    from sqlalchemy import select, update

    storage = get_storage(os.getenv("STORAGE_PROVIDER", "local"))

    def _update_meta(session, status: str, progress: int, download_url: str | None = None, error: str | None = None):
        from sqlalchemy import text as _text
        session.execute(
            _text(
                "UPDATE clips SET metadata = jsonb_set("
                "  coalesce(metadata, '{}'),"
                "  '{renders}',"
                "  coalesce(metadata->'renders', '[]') || :patch::jsonb"
                ") WHERE id = :clip_id"
            ),
            {
                "patch": __import__("json").dumps([{
                    "render_id": render_id,
                    "status": status,
                    "progress_pct": progress,
                    "download_url": download_url,
                    "error_message": error,
                }]),
                "clip_id": clip_id,
            },
        )
        session.commit()

    with SyncSessionLocal() as session:
        try:
            _update_meta(session, "processing", 5)

            # Resolve local path from storage_url
            rel = storage_url[len("/storage/"):] if storage_url.startswith("/storage/") else None
            if not rel:
                raise ValueError(f"Cannot resolve storage path from: {storage_url}")

            source_path = str(storage.local_path(rel)) if hasattr(storage, "local_path") else rel

            with tempfile.TemporaryDirectory() as tmp:
                trimmed = os.path.join(tmp, "trimmed.mp4")
                final = os.path.join(tmp, f"render_{render_id}.mp4")

                # ── Step 1: Trim ──────────────────────────────────────────
                trim_cmd = ["ffmpeg", "-y", "-threads", "2"]
                trim_cmd += ["-ss", str(trim_start_sec)]
                if trim_end_sec:
                    trim_cmd += ["-to", str(trim_end_sec)]
                trim_cmd += ["-i", source_path, "-c", "copy", trimmed]
                r = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=300)
                if r.returncode != 0:
                    raise RuntimeError(f"Trim failed: {r.stderr[-300:]}")

                _update_meta(session, "processing", 30)

                # ── Step 2: Caption filter ────────────────────────────────
                caption_filter = _build_caption_filter(captions)
                quality_flags = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["1080p"])

                # ── Step 3: Build + run encode command ────────────────────
                sound_cmd = _mix_sound_markers(trimmed, markers, final, quality_flags)

                if sound_cmd:
                    # Has sound markers — build combined command
                    cmd = ["ffmpeg", "-y", "-threads", "2"] + sound_cmd
                    if caption_filter:
                        # Insert -vf before output path
                        cmd.insert(-1, "-vf")
                        cmd.insert(-1, caption_filter)
                else:
                    # No sound markers
                    cmd = ["ffmpeg", "-y", "-threads", "2", "-i", trimmed]
                    if caption_filter:
                        cmd += ["-vf", caption_filter]
                    cmd += quality_flags + [final]

                _update_meta(session, "processing", 50)
                r2 = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
                if r2.returncode != 0:
                    raise RuntimeError(f"Render failed: {r2.stderr[-500:]}")

                _update_meta(session, "processing", 85)

                # ── Step 4: Upload result ─────────────────────────────────
                out_key = f"renders/{tenant_id}/{clip_id}/{render_id}.mp4"
                with open(final, "rb") as fh:
                    storage.save(out_key, fh.read())

                download_url = f"/storage/{out_key}"
                _update_meta(session, "done", 100, download_url=download_url)

        except Exception as exc:
            logging.error("render_clip_with_edits failed: %s", exc)
            _update_meta(session, "error", 0, error=str(exc)[:500])
            raise self.retry(exc=exc, countdown=30)
```

- [ ] **Step 2: Ensure `Path` and `os` imports exist at top of file**

Check line 1-20 of `workers/tasks/video.py` — `import os`, `import subprocess`, `from pathlib import Path` should already be present. If missing, add them.

- [ ] **Step 3: Verify Celery recognizes task**

```bash
docker compose exec worker celery -A workers.celery_app inspect registered 2>/dev/null | grep render_clip
```
Expected: `workers.tasks.video.render_clip_with_edits`

- [ ] **Step 4: Commit**

```bash
git add workers/tasks/video.py
git commit -m "feat(editor): add render_clip_with_edits Celery task (trim+captions+sounds)"
```

---

### Task 4: REST endpoints for render jobs

**Files:**
- Create: `services/video/video/routers/render.py`
- Modify: `services/video/video/main.py` (include router)

**Interfaces:**
- Consumes: `RenderRequest`, `RenderStatusResponse` from Task 2
- Consumes: `get_current_user`, `get_tenant_db` from `shared.deps`
- Produces: `POST /clips/{clip_id}/render` → `{"render_id": "..."}`, `GET /clips/{clip_id}/render/{render_id}` → `RenderStatusResponse`

- [ ] **Step 1: Create `services/video/video/routers/render.py`**

```python
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_current_user, get_tenant_db
from shared.schemas.auth import TokenPayload
from video.models import Clip
from video.schemas import RenderRequest, RenderStatusResponse

router = APIRouter(tags=["render"])


def _get_celery():
    from workers.celery_app import celery_app
    return celery_app


@router.post("/clips/{clip_id}/render", status_code=status.HTTP_202_ACCEPTED)
async def start_render(
    clip_id: uuid.UUID,
    body: RenderRequest,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
            Clip.status != "deleted",
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found.")
    if not clip.storage_url:
        raise HTTPException(status_code=422, detail="Clip has no source video — cannot render.")

    render_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    # Seed render record in metadata before enqueue
    meta = dict(clip.clip_metadata or {})
    renders = meta.get("renders", [])
    renders.append({
        "render_id": render_id,
        "status": "queued",
        "progress_pct": 0,
        "download_url": None,
        "error_message": None,
        "created_at": created_at,
        "quality": body.quality,
    })
    meta["renders"] = renders
    clip.clip_metadata = meta
    await db.commit()

    _get_celery().send_task(
        "workers.tasks.video.render_clip_with_edits",
        kwargs={
            "tenant_id": token.tenant_id,
            "clip_id": str(clip_id),
            "render_id": render_id,
            "storage_url": clip.storage_url,
            "trim_start_sec": body.trim_start_sec,
            "trim_end_sec": body.trim_end_sec,
            "captions": [c.model_dump() for c in body.captions],
            "markers": [m.model_dump() for m in body.markers],
            "quality": body.quality,
        },
    )
    return {"render_id": render_id, "clip_id": str(clip_id), "status": "queued"}


@router.get("/clips/{clip_id}/render/{render_id}", response_model=RenderStatusResponse)
async def get_render_status(
    clip_id: uuid.UUID,
    render_id: str,
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    result = await db.execute(
        select(Clip).where(
            Clip.id == clip_id,
            Clip.tenant_id == uuid.UUID(token.tenant_id),
        )
    )
    clip = result.scalar_one_or_none()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found.")

    renders: list[dict] = (clip.clip_metadata or {}).get("renders", [])
    rec = next((r for r in reversed(renders) if r["render_id"] == render_id), None)
    if not rec:
        raise HTTPException(status_code=404, detail="Render job not found.")

    return RenderStatusResponse(
        render_id=render_id,
        clip_id=clip_id,
        status=rec["status"],
        progress_pct=rec.get("progress_pct", 0),
        download_url=rec.get("download_url"),
        error_message=rec.get("error_message"),
        created_at=rec.get("created_at", ""),
    )
```

- [ ] **Step 2: Register router in `services/video/video/main.py`**

Find where other routers are included (look for `app.include_router`). Add:

```python
from video.routers.render import router as render_router
app.include_router(render_router)
```

- [ ] **Step 3: Smoke test endpoints exist**

```bash
docker compose exec video-service python -c "
from video.routers.render import router
routes = [r.path for r in router.routes]
print(routes)
"
```
Expected: `['/clips/{clip_id}/render', '/clips/{clip_id}/render/{render_id}']`

- [ ] **Step 4: Commit**

```bash
git add services/video/video/routers/render.py services/video/video/main.py
git commit -m "feat(editor): add POST/GET /clips/{id}/render endpoints"
```

---

### Task 5: Frontend `renderApi` in `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `renderApi.startRender(clipId, payload)` → `{render_id, clip_id, status}`, `renderApi.getStatus(clipId, renderId)` → `RenderStatus` — consumed by Task 6

- [ ] **Step 1: Add types + renderApi to `frontend/src/lib/api.ts`**

Find the `videoApi` object and add after it:

```typescript
export interface RenderStatus {
  render_id: string;
  clip_id: string;
  status: "queued" | "processing" | "done" | "error";
  progress_pct: number;
  download_url: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RenderPayload {
  trim_start_sec: number;
  trim_end_sec: number | null;
  captions: EditorCaption[];
  markers: EditorMarker[];
  quality: "draft" | "720p" | "1080p";
}

export const renderApi = {
  async startRender(clipId: string, payload: RenderPayload): Promise<{ render_id: string }> {
    const res = await fetch(`${API_BASE}/clips/${clipId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getStatus(clipId: string, renderId: string): Promise<RenderStatus> {
    const res = await fetch(`${API_BASE}/clips/${clipId}/render/${renderId}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
```

Note: `authHeaders()` and `API_BASE` — check existing `videoApi` for the exact helper names used in this file and match them exactly.

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "api.ts"
```
Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(editor): add renderApi.startRender and renderApi.getStatus"
```

---

### Task 6: `RenderPanel.tsx` component

**Files:**
- Create: `frontend/src/workspace/components/editor/RenderPanel.tsx`

**Interfaces:**
- Consumes: `renderApi` from Task 5
- Consumes: `EditorCaption`, `EditorMarker` from `@/lib/api`
- Props: `clipId: string`, `trimStart: number`, `trimEnd: number`, `captions: Caption[]`, `markers: EffectMarker[]`
- Produces: `<RenderPanel>` — used by Task 7

- [ ] **Step 1: Create `frontend/src/workspace/components/editor/RenderPanel.tsx`**

```tsx
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { renderApi, type RenderStatus } from "@/lib/api";
import type { Caption } from "./CaptionEditor";
import type { EffectMarker } from "./Timeline";

type Quality = "draft" | "720p" | "1080p";

const QUALITY_OPTS: { value: Quality; label: string; desc: string }[] = [
  { value: "draft",  label: "Draft",  desc: "Fast preview, lower quality" },
  { value: "720p",   label: "720p",   desc: "Good quality, smaller file" },
  { value: "1080p",  label: "1080p",  desc: "Full quality, recommended" },
];

interface RenderPanelProps {
  clipId: string;
  trimStart: number;
  trimEnd: number;
  captions: Caption[];
  markers: EffectMarker[];
}

export function RenderPanel({ clipId, trimStart, trimEnd, captions, markers }: RenderPanelProps) {
  const [quality, setQuality] = useState<Quality>("1080p");
  const [renderId, setRenderId] = useState<string | null>(null);
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function startPolling(rid: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await renderApi.getStatus(clipId, rid);
        setStatus(s);
        if (s.status === "done" || s.status === "error") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch { /* ignore transient poll errors */ }
    }, 2000);
  }

  async function handleRender() {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    setRenderId(null);
    try {
      const { render_id } = await renderApi.startRender(clipId, {
        trim_start_sec: trimStart,
        trim_end_sec: trimEnd || null,
        captions: captions.map((c) => ({
          id: c.id, text: c.text, start_sec: c.startSec, end_sec: c.endSec,
          position: c.position, color: c.color, font_size: c.fontSize,
        })),
        markers: markers.map((m) => ({
          id: m.id, time_ms: m.timeMs, sound: m.sound, emoji: m.emoji, label: m.label,
        })),
        quality,
      });
      setRenderId(render_id);
      startPolling(render_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || (status && status.status === "processing") || (status && status.status === "queued");

  return (
    <div className="space-y-4">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Export Quality</h3>

      <div className="grid grid-cols-3 gap-2">
        {QUALITY_OPTS.map((q) => (
          <button
            key={q.value}
            onClick={() => setQuality(q.value)}
            disabled={!!busy}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50",
              quality === q.value
                ? "border-[#ff3d6a]/50 bg-[#ff3d6a]/10 text-rose-200"
                : "border-white/[.06] bg-white/[.02] text-zinc-400 hover:bg-white/[.05] hover:text-zinc-200"
            )}
          >
            <span className="text-[15px] font-bold">{q.label}</span>
            <span className="text-[9px] text-center leading-tight opacity-70">{q.desc}</span>
          </button>
        ))}
      </div>

      <button
        onClick={handleRender}
        disabled={!!busy}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#ff3d6a] px-4 py-3 text-[13px] font-bold text-white hover:bg-[#e8304f] disabled:opacity-50 transition cursor-pointer"
      >
        {submitting
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Starting…</>
          : busy
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Rendering…</>
          : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Render &amp; Export</>}
      </button>

      {/* Progress */}
      {status && status.status !== "done" && status.status !== "error" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span className="capitalize">{status.status}…</span>
            <span>{status.progress_pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[.06]">
            <div
              className="h-full rounded-full bg-[#ff3d6a] transition-all duration-500"
              style={{ width: `${status.progress_pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Done */}
      {status?.status === "done" && status.download_url && (
        <a
          href={status.download_url}
          download
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] font-bold text-emerald-300 hover:bg-emerald-500/15 transition"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download {quality} MP4
        </a>
      )}

      {/* Error */}
      {(error || status?.status === "error") && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
          {error || status?.error_message || "Render failed — try again"}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "RenderPanel"
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add frontend/src/workspace/components/editor/RenderPanel.tsx
git commit -m "feat(editor): add RenderPanel component with quality picker + progress polling"
```

---

### Task 7: Wire RenderPanel into VideoEditor, remove MediaRecorder

**Files:**
- Modify: `frontend/src/workspace/components/VideoEditor.tsx`

**Interfaces:**
- Consumes: `RenderPanel` from Task 6
- Removes: `handleExport`, `handleSave` MediaRecorder logic
- Keeps: canvas preview loop, audio synthesis, all state

- [ ] **Step 1: Add `RenderPanel` import to `VideoEditor.tsx`**

Add at top with other editor imports:
```typescript
import { RenderPanel } from "./editor/RenderPanel";
```

- [ ] **Step 2: Replace `handleExport` and `handleSave` MediaRecorder blocks**

Remove these functions entirely:
- `handleExport` (lines doing `canvas.captureStream`, `MediaRecorder`, etc.)
- `handleSave` MediaRecorder section (keep the `videoApi.saveEditorData` call, remove recorder)

Replace `handleSave` with a save-only version:
```typescript
async function handleSave() {
  setSaving(true); setSaveStatus("idle");
  const editorData: EditorData = {
    trim_start_sec: trimStart, trim_end_sec: trimEnd || null,
    captions: captions.map((c) => ({ id: c.id, text: c.text, start_sec: c.startSec, end_sec: c.endSec, position: c.position, color: c.color, font_size: c.fontSize })),
    markers: markers.map((m) => ({ id: m.id, time_ms: m.timeMs, sound: m.sound, emoji: m.emoji, label: m.label })),
  };
  try {
    await videoApi.saveEditorData(clip.id, editorData);
    setSaveStatus("ok"); setTimeout(() => setSaveStatus("idle"), 3000);
  } catch {
    setSaveStatus("err"); setTimeout(() => setSaveStatus("idle"), 3000);
  } finally { setSaving(false); }
}
```

- [ ] **Step 3: Replace Export button in header with save-state indicator only**

Remove the `Export` button from the header. Export is now handled inside the `effects` tab via `RenderPanel`.

- [ ] **Step 4: Add `RenderPanel` as a 4th tab**

Add to `TABS` array:
```typescript
{ id: "export" as EditorTab, label: "Export", icon: <IconExport /> }
```

Add `IconExport`:
```typescript
const IconExport = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
```

Update `EditorTab` type:
```typescript
type EditorTab = "trim" | "captions" | "effects" | "export";
```

Add tab content block:
```tsx
{activeTab === "export" && (
  <div className="max-w-lg">
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Server Render</h3>
    <p className="text-[11px] text-zinc-600 mb-4">
      Renders on server with FFmpeg — full quality MP4 with burned captions and sound effects.
    </p>
    <RenderPanel
      clipId={clip.id}
      trimStart={trimStart}
      trimEnd={trimEnd || duration}
      captions={captions}
      markers={markers}
    />
  </div>
)}
```

- [ ] **Step 5: Remove unused state + refs** (if no longer needed after MediaRecorder removal)

Remove: `exporting`, `exportStatus`, `mediaDestRef`, `mediaSourceRef`, `ensureMediaSource`, `getAudioCtx` — only if sound playback in preview is also not needed. **Keep audio if preview still plays sounds.** Keep `audioCtxRef`, `mediaDestRef`, `ensureMediaSource` if canvas loop still fires sounds during preview. Remove only `exporting`/`exportStatus` states and the MediaRecorder recorder logic.

- [ ] **Step 6: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "VideoEditor"
```
Expected: no output

- [ ] **Step 7: Commit + push**

```bash
git add frontend/src/workspace/components/VideoEditor.tsx
git commit -m "feat(editor): replace browser MediaRecorder export with server-side FFmpeg render tab"
git push
```
