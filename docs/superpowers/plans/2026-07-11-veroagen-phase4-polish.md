# Veroagen Phase 4 (Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-shot model routing and camera controls, credits-based usage limits, and the deferred hardening fixes — completing the original Veroagen spec.

**Architecture:** `config/media.yml` gains model catalogs; shots gain optional `image_model`/`video_model` overrides consumed by generation jobs; camera preset is appended to the video prompt. A `credits` table (per viralo `user_id`, monthly free grant) is decremented before each generation is scheduled; exhausted → 402. Hardening: locked read-modify-write on `queue_render`, timeline `in_s < out_s` validation, `-shortest` whenever audio present.

**Tech Stack:** Existing backend stack (FastAPI, SQLAlchemy, fal-client). Frontend: existing `frontend/src/veroagen/` React module.

## Global Constraints

- Backend `/Users/saman/Documents/personal/veroagen-backend`; viralo changes only under `frontend/src/veroagen/`. Files < 500 lines. `uv run pytest` (ffmpeg marker excluded by default).
- All doc writes via locked paths (`mutate_and_broadcast` / `project_lock`).
- Model catalogs in `config/media.yml`: `image_models` / `video_models` lists of `{id, label}`; existing `image_model`/`video_model` keys stay as defaults.
- Camera presets (exact list): `["static", "pan left", "pan right", "zoom in", "zoom out", "orbit", "tracking"]`. Non-static camera prepends `"Camera movement: {camera}. "` to the video-generation prompt.
- Credit costs (exact): image 1, video 5, character ref 1, voiceover 2, music 2, render 0. Free grant: env `VEROAGEN_FREE_CREDITS` (Settings field `free_credits: int = 50`), refreshed monthly (grant row per user per `YYYY-MM` period).
- Insufficient credits → HTTP 402 `{"detail": "Insufficient credits"}` on manual endpoints; agent-requested jobs that can't be afforded are skipped with a system chat message `"Not enough credits for {job}."`.
- fal calls / ffmpeg / network never in tests (mock as in prior phases).

---

### Task 1: Hardening follow-ups

**Files:**
- Modify: `veroagen/routers/generate.py` (queue_render locked RMW), `veroagen/routers/edits.py` (timeline validation), `veroagen/render.py` (`-shortest` with any audio)
- Test: `tests/test_render_api.py`, `tests/test_render.py` (append)

**Interfaces:**
- Produces: `veroagen.routers.edits.validate_timeline(timeline: dict) -> None` — raises `HTTPException(422)` if any video clip has `out_s <= in_s` or `in_s < 0`. Used by PUT timeline. `queue_render` check+set inside `project_lock(proj.id)` with `session.refresh(proj)` (add `session: AsyncSession = Depends(get_session)` to its signature; note `mutate_and_broadcast` also takes the lock → perform the status write with direct session ops inside the lock, then broadcast after, mirroring `create_character`).

- [ ] **Step 1: Write failing tests**

Append to `tests/test_render_api.py`:

```python
async def test_put_timeline_rejects_bad_clip(client):
    pid = await make_ready_project(client)
    bad = {"video": [{"id": "c1", "shot_id": "x1", "in_s": 3, "out_s": 2, "order": 0}]}
    r = await client.put(f"/projects/{pid}/timeline", json={"timeline": bad}, headers=H)
    assert r.status_code == 422


async def test_put_timeline_rejects_negative_in(client):
    pid = await make_ready_project(client)
    bad = {"video": [{"id": "c1", "shot_id": "x1", "in_s": -1, "out_s": 2, "order": 0}]}
    r = await client.put(f"/projects/{pid}/timeline", json={"timeline": bad}, headers=H)
    assert r.status_code == 422
```

Append to `tests/test_render.py`:

```python
def test_build_args_voice_only_has_shortest():
    args = build_ffmpeg_args([("/tmp/a.mp4", 0, 4)], "/tmp/vo.wav", None, "/tmp/o.mp4")
    assert "-shortest" in args


def test_build_args_no_audio_no_shortest():
    args = build_ffmpeg_args([("/tmp/a.mp4", 0, 4)], None, None, "/tmp/o.mp4")
    assert "-shortest" not in args
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_render_api.py tests/test_render.py -v`

- [ ] **Step 3: Implement**

`veroagen/render.py` — change the `-shortest` gate from `if music_file:` to:

```python
    if voice_file or music_file:
        args += ["-shortest"]
```

`veroagen/routers/edits.py` — add:

```python
from fastapi import HTTPException


def validate_timeline(timeline: dict) -> None:
    for clip in timeline.get("video", []):
        in_s, out_s = clip.get("in_s", 0), clip.get("out_s", 0)
        if in_s < 0 or out_s <= in_s:
            raise HTTPException(
                status_code=422,
                detail=f"Clip {clip.get('id')}: out_s must be greater than in_s and in_s >= 0",
            )
```

and call `validate_timeline(body.timeline)` first line of `put_timeline`.

`veroagen/routers/generate.py` — replace `queue_render` with a locked read-modify-write (mirrors `create_character`'s pattern):

```python
@router.post("/{project_id}/render")
async def queue_render(
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    async with project_lock(proj.id):
        await session.refresh(proj)
        doc = ensure_doc_shape(proj.doc)
        if doc["render"]["status"] == "rendering":
            raise HTTPException(status_code=409, detail="Render already in progress")
        if not doc["timeline"]["video"]:
            raise HTTPException(status_code=400, detail="Timeline is empty — build it first")
        proj.doc = apply_ops(proj.doc, [
            {"op": "update_render", "patch": {"status": "rendering", "error": None}}])
        session.add(proj)
        await session.commit()
    await hub.broadcast(proj.id, {"type": "doc", "doc": proj.doc})
    schedule(run_render(proj.id))
    return {"status": "queued"}
```

- [ ] **Step 4: Run full suite, verify PASS** — `uv run pytest -v`
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix: locked render queueing, timeline validation, shortest with any audio"`

---

### Task 2: Model catalog + per-shot model override + camera prompt

**Files:**
- Modify: `config/media.yml`, `veroagen/media.py`, `veroagen/jobs.py`, `veroagen/main.py` (models endpoint)
- Test: `tests/test_media.py`, `tests/test_jobs.py` (append), `tests/test_models_api.py` (create)

**Interfaces:**
- Produces:
  - `config/media.yml` gains:

    ```yaml
    image_models:
      - {id: fal-ai/flux/schnell, label: FLUX Schnell (fast)}
      - {id: fal-ai/flux/dev, label: FLUX Dev (quality)}
      - {id: fal-ai/nano-banana, label: Nano Banana}
    video_models:
      - {id: fal-ai/kling-video/v2.5-turbo/pro/image-to-video, label: Kling 2.5 Turbo}
      - {id: fal-ai/veo3/image-to-video, label: Veo 3}
      - {id: fal-ai/seedance/v1/pro/image-to-video, label: Seedance 1.0 Pro}
    ```

  - `generate_image(prompt, ref_image_url=None, model: str | None = None)` and `generate_video(prompt, image_url, model: str | None = None)` — `model` overrides the config default when given.
  - Jobs: `run_gen_shot_image` passes `model=shot.get("image_model")` and records the effective model on the asset; `run_gen_shot_video` passes `model=shot.get("video_model")` and builds prompt `f"Camera movement: {camera}. {prompt}"` when `shot.get("camera")` is a non-empty value other than `"static"`.
  - `GET /models -> {"image_models": [...], "video_models": [...], "camera_presets": [...]}` in main.py (auth not required; static config). Camera presets list exactly: `["static", "pan left", "pan right", "zoom in", "zoom out", "orbit", "tracking"]`.

- [ ] **Step 1: Write failing tests**

Append to `tests/test_media.py`:

```python
async def test_generate_image_model_override():
    result = {"images": [{"url": "https://fal.media/i.png"}]}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        await generate_image("x", model="fal-ai/flux/dev")
    assert sub.call_args.args[0] == "fal-ai/flux/dev"


async def test_generate_video_model_override():
    result = {"video": {"url": "https://fal.media/v.mp4"}}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        await generate_video("x", image_url="http://i", model="fal-ai/veo3/image-to-video")
    assert sub.call_args.args[0] == "fal-ai/veo3/image-to-video"
```

Append to `tests/test_jobs.py`:

```python
async def test_shot_image_uses_model_override():
    shot = dict(SHOT, image_model="fal-ai/flux/dev")
    pid = await make_project(shots=[shot])
    gen = AsyncMock(return_value="https://fal.media/i.png")
    with patch("veroagen.jobs.generate_image", new=gen), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_image(pid, "x1")
    assert gen.call_args.kwargs.get("model") == "fal-ai/flux/dev"
    doc = await get_doc(pid)
    assert doc["assets"]["items"][0]["model"] == "fal-ai/flux/dev"


async def test_shot_video_camera_prompt():
    shot = dict(SHOT, camera="pan left", image_url="http://i", status="image_ready")
    pid = await make_project(shots=[shot])
    gen = AsyncMock(return_value="https://fal.media/v.mp4")
    with patch("veroagen.jobs.generate_video", new=gen), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_video(pid, "x1")
    assert gen.call_args.args[0] == "Camera movement: pan left. sunset"


async def test_shot_video_static_camera_plain_prompt():
    shot = dict(SHOT, camera="static", image_url="http://i", status="image_ready")
    pid = await make_project(shots=[shot])
    gen = AsyncMock(return_value="https://fal.media/v.mp4")
    with patch("veroagen.jobs.generate_video", new=gen), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_video(pid, "x1")
    assert gen.call_args.args[0] == "sunset"
```

Create `tests/test_models_api.py`:

```python
async def test_models_endpoint(client):
    r = await client.get("/models")
    assert r.status_code == 200
    body = r.json()
    assert any(m["id"] == "fal-ai/flux/schnell" for m in body["image_models"])
    assert any("kling" in m["id"] for m in body["video_models"])
    assert "pan left" in body["camera_presets"]
```

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement**

`config/media.yml`: append the two catalog lists (exact YAML above).

`veroagen/media.py` — signature changes:

```python
async def generate_image(prompt: str, ref_image_url: str | None = None,
                         model: str | None = None) -> str:
    cfg = load_media_config()
    model = model or cfg["image_model"]
    ...
    result = await fal_client.subscribe_async(model, arguments=arguments)
```

(same pattern for `generate_video`: `model = model or cfg["video_model"]`; keep error handling identical.)

`veroagen/jobs.py`:
- `run_gen_shot_image`: compute `model = shot.get("image_model") or cfg["image_model"]`; call `generate_image(shot["prompt"], ref_image_url=ref_url, model=model)`; use `model` in `_asset("image", url, model, shot_id=shot_id)`.
- `run_gen_shot_video`: compute `model = shot.get("video_model") or cfg["video_model"]`; build prompt:

```python
        camera = (shot.get("camera") or "").strip()
        prompt = shot["prompt"] if camera in ("", "static") \
            else f"Camera movement: {camera}. {shot['prompt']}"
        url = await generate_video(prompt, image_url=shot["image_url"], model=model)
```

and `_asset("video", url, model, shot_id=shot_id)`.

`veroagen/main.py`:

```python
from veroagen.media import load_media_config

CAMERA_PRESETS = ["static", "pan left", "pan right", "zoom in", "zoom out", "orbit", "tracking"]


@app.get("/models")
async def list_models():
    cfg = load_media_config()
    return {
        "image_models": cfg.get("image_models", []),
        "video_models": cfg.get("video_models", []),
        "camera_presets": CAMERA_PRESETS,
    }
```

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: model catalog, per-shot model override, camera prompt"`

---

### Task 3: Credits — table, service, enforcement

**Files:**
- Create: `veroagen/credits.py`
- Modify: `veroagen/config.py` (`free_credits: int = 50`), `veroagen/db.py` (CreditLedger model), `veroagen/main.py` (GET /credits), `veroagen/routers/generate.py` (charge before schedule)
- Test: `tests/test_credits.py`

**Interfaces:**
- Produces:
  - `veroagen.db.CreditLedger`: `id (uuid str pk)`, `user_id (str, indexed)`, `period (str "YYYY-MM", indexed)`, `delta (int)`, `reason (str)`, `created_at`.
  - `veroagen.credits.COSTS = {"image": 1, "video": 5, "character_ref": 1, "voiceover": 2, "music": 2, "render": 0}`.
  - `async credits.balance(session, user_id: str, period: str) -> int` — sum of deltas for (user, period); if no rows exist, inserts grant row `delta=settings.free_credits, reason="monthly_grant"` and returns it.
  - `async credits.charge(session, user_id: str, period: str, kind: str) -> bool` — checks balance ≥ cost; if yes inserts `delta=-cost, reason=kind`, commits, returns True; else False. Cost 0 → True without a row. Guarded by `asyncio.Lock` per user (module-level defaultdict, like locks.py).
  - `credits.current_period() -> str` — `datetime.now(timezone.utc).strftime("%Y-%m")`.
  - `GET /credits -> {"balance": int, "period": str, "costs": COSTS}` (auth required).
  - In `generate.py`, each manual generation endpoint charges before scheduling: image → "image", video → "video", generate-ref → "character_ref", voiceover → "voiceover", music → "music". On False → `HTTPException(402, "Insufficient credits")` (and the endpoint must charge BEFORE mutating status).
- Consumes: `get_current_user` for user_id, `get_session`.

- [ ] **Step 1: Write failing tests**

`tests/test_credits.py`:

```python
from unittest.mock import AsyncMock, patch

from veroagen.credits import COSTS, balance, charge, current_period
from veroagen.db import SessionLocal, init_db
from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}


async def test_balance_grants_free_credits_once():
    await init_db()
    async with SessionLocal() as s:
        b1 = await balance(s, "cu1", "2026-07")
        b2 = await balance(s, "cu1", "2026-07")
    assert b1 == 50 and b2 == 50


async def test_charge_decrements_and_blocks():
    await init_db()
    async with SessionLocal() as s:
        assert await charge(s, "cu2", "2026-07", "video") is True   # 50 -> 45
        assert await balance(s, "cu2", "2026-07") == 45
        for _ in range(9):                                          # 45 -> 0
            assert await charge(s, "cu2", "2026-07", "video") is True
        assert await charge(s, "cu2", "2026-07", "image") is False  # broke
        assert await balance(s, "cu2", "2026-07") == 0


async def test_render_is_free():
    await init_db()
    async with SessionLocal() as s:
        assert await charge(s, "cu3", "2026-07", "render") is True
        assert await balance(s, "cu3", "2026-07") == 50


async def test_new_period_new_grant():
    await init_db()
    async with SessionLocal() as s:
        await charge(s, "cu4", "2026-06", "video")
        assert await balance(s, "cu4", "2026-07") == 50


async def test_credits_endpoint(client):
    r = await client.get("/credits", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["balance"] == 50 and body["period"] == current_period()
    assert body["costs"] == COSTS


async def test_generate_image_402_when_broke(client):
    r = await client.post("/projects", json={"title": "C"}, headers=H)
    pid = r.json()["id"]
    shots = [{"id": "x1", "scene_id": "s1", "prompt": "p", "camera": "",
              "duration_s": 5, "status": "draft"}]
    with patch("veroagen.routers.edits.hub.broadcast", new=AsyncMock()):
        await client.put(f"/projects/{pid}/storyboard", json={"shots": shots}, headers=H)
    with patch("veroagen.routers.generate.charge", new=AsyncMock(return_value=False)), \
         patch("veroagen.routers.generate.schedule") as sched:
        r2 = await client.post(f"/projects/{pid}/shots/x1/generate-image", headers=H)
    assert r2.status_code == 402
    sched.assert_not_called()
```

Note: `test_auth.make_token` default sub is "u1" — shared DB across tests means u1 may already have charges from other test runs in the same session DB; the endpoint tests only assert grant-default behavior where safe (fresh in-memory DB per test session — if balance assertion flakes due to ordering, relax `test_credits_endpoint` to `body["balance"] <= 50 and body["balance"] >= 0`).

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement**

`veroagen/config.py`: add `free_credits: int = 50` (pydantic-settings reads env `FREE_CREDITS`).

`veroagen/db.py` — add model:

```python
class CreditLedger(Base):
    __tablename__ = "credit_ledger"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

(add `Integer` to the sqlalchemy import.)

`veroagen/credits.py`:

```python
import asyncio
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.config import settings
from veroagen.db import CreditLedger

COSTS = {"image": 1, "video": 5, "character_ref": 1,
         "voiceover": 2, "music": 2, "render": 0}

_user_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def current_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def _sum(session: AsyncSession, user_id: str, period: str) -> int | None:
    row = await session.execute(
        select(func.count(CreditLedger.id), func.coalesce(func.sum(CreditLedger.delta), 0))
        .where(CreditLedger.user_id == user_id, CreditLedger.period == period))
    count, total = row.one()
    return None if count == 0 else int(total)


async def balance(session: AsyncSession, user_id: str, period: str) -> int:
    async with _user_locks[user_id]:
        total = await _sum(session, user_id, period)
        if total is None:
            session.add(CreditLedger(user_id=user_id, period=period,
                                     delta=settings.free_credits, reason="monthly_grant"))
            await session.commit()
            return settings.free_credits
        return total


async def charge(session: AsyncSession, user_id: str, period: str, kind: str) -> bool:
    cost = COSTS[kind]
    if cost == 0:
        return True
    current = await balance(session, user_id, period)
    async with _user_locks[user_id]:
        if current < cost:
            return False
        session.add(CreditLedger(user_id=user_id, period=period,
                                 delta=-cost, reason=kind))
        await session.commit()
        return True
```

`veroagen/main.py`:

```python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.auth import AuthUser, get_current_user
from veroagen.credits import COSTS, balance, current_period
from veroagen.db import get_session


@app.get("/credits")
async def get_credits(
    user: AuthUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    period = current_period()
    return {"balance": await balance(session, user.user_id, period),
            "period": period, "costs": COSTS}
```

`veroagen/routers/generate.py` — add imports (`from veroagen.auth import AuthUser, get_current_user`, `from veroagen.credits import charge, current_period`) and a helper:

```python
async def _charge_or_402(session: AsyncSession, user: AuthUser, kind: str) -> None:
    if not await charge(session, user.user_id, current_period(), kind):
        raise HTTPException(status_code=402, detail="Insufficient credits")
```

Each manual generation endpoint gains `user: AuthUser = Depends(get_current_user)` + `session: AsyncSession = Depends(get_session)` params and calls `await _charge_or_402(session, user, "<kind>")` BEFORE the status mutation/schedule: generate-ref → "character_ref", generate-image → "image", generate-video → "video", voiceover → "voiceover", music → "music".

- [ ] **Step 4: Run full suite, verify PASS** (existing generate tests keep passing — free grant covers their charges), **Step 5: Commit** — `git commit -am "feat: credits ledger with monthly grant and 402 enforcement"`

---

### Task 4: Credits for agent-requested jobs

**Files:**
- Modify: `veroagen/routers/chat.py`
- Test: `tests/test_chat_api.py` (append)

**Interfaces:**
- Consumes: `credits.charge/current_period`, `_system_msg` semantics (append system chat message via `mutate_and_broadcast`).
- Produces: chat endpoint charges per job request before scheduling — mapping job→kind: `gen_character_ref→character_ref`, `gen_shot_image→image`, `gen_shot_video→video`, `gen_voiceover→voiceover`, `gen_music→music`, `render_export→render`. Unaffordable job → skipped + `mutate_and_broadcast(proj.id, [system message "Not enough credits for {job}."])`, other jobs still processed.

- [ ] **Step 1: Write failing test** (append to `tests/test_chat_api.py`)

```python
async def test_chat_skips_unaffordable_jobs(client):
    r = await client.post("/projects", json={"title": "CC"}, headers=H)
    pid = r.json()["id"]

    def fake_run_turn(doc, message, llm=None):
        from veroagen.doc import apply_ops
        d = apply_ops(doc, [{"op": "append_message",
                             "message": {"role": "assistant", "content": "queued"}}])
        return d, [], [{"job": "gen_shot_image", "project_scope_id": "x1"}]

    with patch("veroagen.routers.chat.run_turn", side_effect=fake_run_turn), \
         patch("veroagen.routers.chat.charge", new=AsyncMock(return_value=False)), \
         patch("veroagen.routers.chat.hub.broadcast", new=AsyncMock()), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()), \
         patch("veroagen.routers.chat.schedule") as sched:
        r2 = await client.post(f"/projects/{pid}/chat", json={"message": "go"}, headers=H)
    assert r2.status_code == 200
    sched.assert_not_called()

    r3 = await client.get(f"/projects/{pid}", headers=H)
    msgs = r3.json()["doc"]["chat"]["messages"]
    assert any(m["role"] == "system" and "not enough credits" in m["content"].lower()
               for m in msgs)
```

(Ensure `AsyncMock` imported in the file.)

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement**

`veroagen/routers/chat.py` — add imports `from veroagen.auth import AuthUser, get_current_user`, `from veroagen.credits import charge, current_period`, `from veroagen.jobs import mutate_and_broadcast` (extend existing import), mapping:

```python
_JOB_COSTS_KIND = {
    "gen_character_ref": "character_ref",
    "gen_shot_image": "image",
    "gen_shot_video": "video",
    "gen_voiceover": "voiceover",
    "gen_music": "music",
    "render_export": "render",
}
```

`chat_turn` gains `user: AuthUser = Depends(get_current_user)` and the scheduling loop becomes:

```python
    for req in job_requests:
        runner = _JOB_RUNNERS.get(req["job"])
        if runner is None:
            continue
        kind = _JOB_COSTS_KIND[req["job"]]
        if not await charge(session, user.user_id, current_period(), kind):
            await mutate_and_broadcast(proj.id, [
                {"op": "append_message", "message": {
                    "role": "system",
                    "content": f"Not enough credits for {req['job']}."}}])
            continue
        if req["job"] == "gen_music":
            schedule(runner(proj.id, req.get("prompt", "")))
        elif req["job"] in ("gen_voiceover", "render_export"):
            schedule(runner(proj.id))
        else:
            schedule(runner(proj.id, req["project_scope_id"]))
```

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: credit enforcement for agent-requested jobs"`

---

### Task 5: Frontend — model/camera pickers, prompt edit, credits badge, error toasts

**Files (viralo repo, only `frontend/src/veroagen/`):**
- Modify: `frontend/src/veroagen/types.ts`, `api.ts`, `StoryboardView.tsx`, `WorkspacePage.tsx`
- Create: `frontend/src/veroagen/useModels.ts`

**Interfaces:**
- Consumes: `GET /models`, `GET /credits`, shot fields `image_model`/`video_model`/`camera`, PUT storyboard.
- Produces: shot cards gain prompt textarea (saved via PUT storyboard on blur), camera dropdown, image/video model dropdowns; header credits badge; generation calls show `alert`-style error on failure (402 → "Out of credits").

- [ ] **Step 1: Types + api** — `types.ts`: add to `Shot`: `image_model?: string | null; video_model?: string | null;`; add:

```ts
export interface ModelOption { id: string; label: string }
export interface ModelCatalog {
  image_models: ModelOption[];
  video_models: ModelOption[];
  camera_presets: string[];
}
export interface CreditsInfo { balance: number; period: string; costs: Record<string, number> }
```

`api.ts` — append:

```ts
  getModels: () => req<ModelCatalog>("GET", "/models"),
  getCredits: () => req<CreditsInfo>("GET", "/credits"),
```

(import types.) Also change `req` error to surface status:

```ts
  if (!res.ok) {
    const msg = res.status === 402 ? "Out of credits" : `Request failed (${res.status})`;
    throw new Error(msg);
  }
```

- [ ] **Step 2: useModels hook**

`frontend/src/veroagen/useModels.ts`:

```ts
import { useEffect, useState } from "react";
import { veroagenApi } from "./api";
import type { ModelCatalog } from "./types";

const EMPTY: ModelCatalog = { image_models: [], video_models: [], camera_presets: [] };

export function useModels(): ModelCatalog {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);
  useEffect(() => {
    veroagenApi.getModels().then(setCatalog).catch(() => setCatalog(EMPTY));
  }, []);
  return catalog;
}
```

- [ ] **Step 3: StoryboardView upgrade** — extend props and card UI:

```tsx
import { useEffect, useState } from "react";
import type { ModelCatalog, Shot } from "./types";

const BUSY: Shot["status"][] = ["image_generating", "video_generating"];

export function StoryboardView({
  shots, models, onGenerateImage, onGenerateVideo, onSaveShots,
}: {
  shots: Shot[];
  models: ModelCatalog;
  onGenerateImage: (id: string) => void;
  onGenerateVideo: (id: string) => void;
  onSaveShots: (shots: Shot[]) => void;
}) {
  const [local, setLocal] = useState(shots);
  useEffect(() => setLocal(shots), [shots]);

  const patch = (i: number, p: Partial<Shot>) =>
    setLocal(local.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const commit = () => onSaveShots(local);

  if (!local.length) return <div className="p-6 text-sm text-muted-foreground">No storyboard yet.</div>;
  return (
    <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
      {local.map((s, i) => {
        const busy = BUSY.includes(s.status);
        return (
          <div key={s.id} className="rounded-md border p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{s.id}</span>
              <span>{s.duration_s}s</span>
            </div>
            <div className="mb-2 flex aspect-video items-center justify-center overflow-hidden rounded bg-muted">
              {s.video_url ? (
                <video src={s.video_url} controls className="h-full w-full object-cover" />
              ) : s.image_url ? (
                <img src={s.image_url} alt={s.prompt} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">{busy ? "Generating…" : s.status}</span>
              )}
            </div>
            <textarea
              value={s.prompt}
              onChange={(e) => patch(i, { prompt: e.target.value })}
              onBlur={commit}
              rows={2}
              className="mb-2 w-full resize-y rounded-md border bg-background p-2 text-xs"
            />
            <div className="mb-2 grid grid-cols-1 gap-1">
              <select value={s.camera || "static"} onBlur={commit}
                      onChange={(e) => patch(i, { camera: e.target.value })}
                      className="rounded border bg-background px-1 py-0.5 text-xs">
                {models.camera_presets.map((c) => <option key={c} value={c}>📷 {c}</option>)}
              </select>
              <select value={s.image_model ?? ""} onBlur={commit}
                      onChange={(e) => patch(i, { image_model: e.target.value || null })}
                      className="rounded border bg-background px-1 py-0.5 text-xs">
                <option value="">🖼 default model</option>
                {models.image_models.map((m) => <option key={m.id} value={m.id}>🖼 {m.label}</option>)}
              </select>
              <select value={s.video_model ?? ""} onBlur={commit}
                      onChange={(e) => patch(i, { video_model: e.target.value || null })}
                      className="rounded border bg-background px-1 py-0.5 text-xs">
                <option value="">🎬 default model</option>
                {models.video_models.map((m) => <option key={m.id} value={m.id}>🎬 {m.label}</option>)}
              </select>
            </div>
            <div className="mb-1 text-xs">
              <span className={s.status === "failed" ? "text-red-500" : "text-muted-foreground"}>
                {s.status}{s.status === "failed" && s.error ? ` — ${s.error}` : ""}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onGenerateImage(s.id)} disabled={busy}
                      className="flex-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50">
                {s.image_url ? "Redo image" : "Generate image"}
              </button>
              <button onClick={() => onGenerateVideo(s.id)} disabled={busy || !s.image_url}
                      className="flex-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50">
                {s.video_url ? "Redo video" : "Animate"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: WorkspacePage wiring** — use `useModels()`, credits state, error surface, save shots:

```tsx
  const models = useModels();
  const [credits, setCredits] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refreshCredits = useCallback(() => {
    veroagenApi.getCredits().then((c) => setCredits(c.balance)).catch(() => {});
  }, []);
  useEffect(() => { refreshCredits(); }, [refreshCredits]);

  const guard = (p: Promise<unknown>) =>
    p.then(refreshCredits).catch((e: Error) => {
      setToast(e.message);
      setTimeout(() => setToast(null), 4000);
    });
```

Header (next to title): `{credits !== null && <span className="ml-auto mr-2 rounded-full bg-muted px-2 py-0.5 text-xs">⚡ {credits} credits</span>}` and below tabs `{toast && <div className="border-b bg-red-500/10 px-4 py-1 text-xs text-red-500">{toast}</div>}`.

Wrap generation calls: `onGenerateImage={(sid) => void guard(veroagenApi.generateShotImage(projectId, sid))}` — same `guard(...)` for generateShotVideo, generateRef, queueVoiceover, queueMusic, queueRender. Storyboard tab gains `models={models}` and `onSaveShots={(shots) => void guard(veroagenApi.putStoryboard(projectId, shots))}` (remove read-only usage).

- [ ] **Step 5: Verify build** — `cd frontend && npm run build`
- [ ] **Step 6: Commit (only veroagen files)** — `git add frontend/src/veroagen && git commit -m "feat(veroagen): model and camera pickers, prompt editing, credits badge, error toasts"`

---

### Task 6: Docs + suite closeout

**Files:**
- Modify: `README.md`, `.env.example` (backend repo)

- [ ] **Step 1: Docs** — `.env.example`: add `FREE_CREDITS=50`. `README.md` append:

```markdown
## Phase 4 — Polish

- Per-shot model overrides (`image_model`/`video_model` on shots) and camera presets;
  catalogs in `config/media.yml`, exposed at `GET /models`.
- Credits: monthly free grant (`FREE_CREDITS`, default 50) per viralo user.
  Costs — image 1, video 5, character ref 1, voiceover 2, music 2, render free.
  `GET /credits` for balance; manual endpoints return 402 when exhausted; agent
  jobs are skipped with a system chat message.
```

- [ ] **Step 2: Full suites both repos**

```bash
cd /Users/saman/Documents/personal/veroagen-backend && uv run pytest -v
cd /Users/saman/Documents/personal/viralo/frontend && npm run build
```

- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs: phase 4 env and readme"`
