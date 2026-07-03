# Veroagen Phase 2 (Generation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent (and manual UI buttons) can generate character reference images, per-shot images, and per-shot videos via fal.ai, with live status updates streamed to the workspace.

**Architecture:** Extends the Phase 1 Project doc with `characters` and `assets` sections and per-shot media fields. Generation runs as in-process asyncio background jobs (fal.ai calls are IO-bound); each job mutates the doc via `apply_ops`, broadcasts over the existing WS hub, and appends a system message to chat. The agent gains four new tools; generation tools return job *requests* that the async chat endpoint schedules after commit (agent loop itself stays sync). Media URLs are fal-hosted (S3/R2 mirroring deferred to Phase 3 export).

**Tech Stack:** Python 3.12, FastAPI, `fal-client` (async), existing SQLAlchemy/WS/LLM layers. Frontend: React 19 + existing `frontend/src/veroagen/` module in the viralo repo.

## Global Constraints

- Backend repo: `/Users/saman/Documents/personal/veroagen-backend`. Viralo backend untouched; viralo frontend changes only under `frontend/src/veroagen/`.
- Every doc mutation goes through `apply_ops` and is broadcast as `{"type": "doc", "doc": ...}` on the project's hub channel.
- All backend files < 500 lines. `uv` for deps, `uv run pytest` for tests.
- fal.ai auth via env `FAL_KEY` (fal-client reads it automatically). Model ids configurable in `config/media.yml`; defaults: image `fal-ai/flux/schnell`, video `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`.
- Shot status lifecycle: `draft → image_generating → image_ready → video_generating → video_ready`, plus `failed` (with `error` field). Character ref lifecycle: `none → generating → ready | failed`.
- Jobs are in-process asyncio tasks (documented deviation from the spec's worker-queue: the Phase 1 hub is single-process; a separate worker process would lose WS broadcasts. Real queue + Redis pub/sub is a scaling task, not Phase 2).
- Character consistency: when a shot references a character with a ready ref image, that image URL is passed as image conditioning to the image generation call.
- Tests never call fal.ai — `veroagen.media` is mocked/stubbed everywhere.

---

### Task 1: Doc model v2 — characters, assets, shot media fields

**Files:**
- Modify: `veroagen/doc.py`
- Test: `tests/test_doc.py` (append)

**Interfaces:**
- Produces:
  - `new_project_doc` now also returns `"characters": {"items": []}, "assets": {"items": []}`.
  - `ensure_doc_shape(doc: dict) -> dict` — returns doc with any missing top-level sections added (backward compat for Phase 1 docs). Pure.
  - New ops for `apply_ops`:
    - `{"op": "set_characters", "items": [{"id","name","description","ref_image_url","ref_status"}]}`
    - `{"op": "update_shot", "shot_id": str, "patch": dict}` — merges patch into the shot; raises `ValueError` if shot id not found.
    - `{"op": "update_character", "character_id": str, "patch": dict}` — same semantics for characters.
    - `{"op": "add_asset", "asset": {"id","kind","url","shot_id","character_id","model"}}` — appends to `assets.items`.
  - `apply_ops` calls `ensure_doc_shape` internally, so old docs gain the new sections on first mutation.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_doc.py`)

```python
def test_new_doc_has_characters_and_assets():
    d = new_project_doc("t")
    assert d["characters"] == {"items": []}
    assert d["assets"] == {"items": []}


def test_ensure_doc_shape_backfills_old_doc():
    from veroagen.doc import ensure_doc_shape
    old = {"title": "t", "script": {"scenes": []}, "storyboard": {"shots": []},
           "chat": {"messages": []}, "version": 3}
    fixed = ensure_doc_shape(old)
    assert fixed["characters"] == {"items": []}
    assert fixed["assets"] == {"items": []}
    assert fixed["version"] == 3  # shape fix does not bump version
    assert "characters" not in old  # pure


def test_set_characters_and_update_character():
    d = new_project_doc("t")
    items = [{"id": "c1", "name": "Ava", "description": "explorer",
              "ref_image_url": None, "ref_status": "none"}]
    d = apply_ops(d, [{"op": "set_characters", "items": items}])
    assert d["characters"]["items"] == items
    d = apply_ops(d, [{"op": "update_character", "character_id": "c1",
                       "patch": {"ref_status": "generating"}}])
    assert d["characters"]["items"][0]["ref_status"] == "generating"


def test_update_shot_merges_patch():
    d = new_project_doc("t")
    shots = [{"id": "x1", "scene_id": "s1", "prompt": "sunset",
              "camera": "", "duration_s": 5, "status": "draft"}]
    d = apply_ops(d, [{"op": "set_shots", "shots": shots}])
    d = apply_ops(d, [{"op": "update_shot", "shot_id": "x1",
                       "patch": {"status": "image_ready", "image_url": "http://img"}}])
    shot = d["storyboard"]["shots"][0]
    assert shot["status"] == "image_ready" and shot["image_url"] == "http://img"
    assert shot["prompt"] == "sunset"  # merge, not replace


def test_update_shot_unknown_id():
    d = new_project_doc("t")
    with pytest.raises(ValueError):
        apply_ops(d, [{"op": "update_shot", "shot_id": "nope", "patch": {}}])


def test_add_asset():
    d = new_project_doc("t")
    asset = {"id": "a1", "kind": "image", "url": "http://img",
             "shot_id": "x1", "character_id": None, "model": "flux"}
    d = apply_ops(d, [{"op": "add_asset", "asset": asset}])
    assert d["assets"]["items"] == [asset]
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_doc.py -v` (new tests fail; old 4 pass)

- [ ] **Step 3: Implement** — replace `veroagen/doc.py` content with:

```python
import copy

_SECTION_DEFAULTS: dict = {
    "script": {"scenes": []},
    "storyboard": {"shots": []},
    "chat": {"messages": []},
    "characters": {"items": []},
    "assets": {"items": []},
}


def new_project_doc(title: str) -> dict:
    return {"title": title, **copy.deepcopy(_SECTION_DEFAULTS), "version": 0}


def ensure_doc_shape(doc: dict) -> dict:
    d = copy.deepcopy(doc)
    for key, default in _SECTION_DEFAULTS.items():
        d.setdefault(key, copy.deepcopy(default))
    return d


def _find(items: list[dict], item_id: str, kind: str) -> dict:
    for item in items:
        if item.get("id") == item_id:
            return item
    raise ValueError(f"Unknown {kind}: {item_id}")


def apply_ops(doc: dict, ops: list[dict]) -> dict:
    d = ensure_doc_shape(doc)
    for op in ops:
        kind = op.get("op")
        if kind == "set_script":
            d["script"]["scenes"] = op["scenes"]
        elif kind == "set_shots":
            d["storyboard"]["shots"] = op["shots"]
        elif kind == "append_message":
            d["chat"]["messages"].append(op["message"])
        elif kind == "set_characters":
            d["characters"]["items"] = op["items"]
        elif kind == "update_shot":
            _find(d["storyboard"]["shots"], op["shot_id"], "shot").update(op["patch"])
        elif kind == "update_character":
            _find(d["characters"]["items"], op["character_id"], "character").update(op["patch"])
        elif kind == "add_asset":
            d["assets"]["items"].append(op["asset"])
        else:
            raise ValueError(f"Unknown op: {kind}")
    d["version"] += 1
    return d
```

- [ ] **Step 4: Run full suite, verify PASS** — `uv run pytest -v` (all 30 old + 6 new)
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: doc model v2 with characters, assets, shot media ops"`

---

### Task 2: fal.ai media client

**Files:**
- Create: `veroagen/media.py`, `config/media.yml`
- Modify: `pyproject.toml` (add `fal-client>=0.5`)
- Test: `tests/test_media.py`

**Interfaces:**
- Produces:
  - `veroagen.media.generate_image(prompt: str, ref_image_url: str | None = None) -> str` — async, returns hosted image URL.
  - `veroagen.media.generate_video(prompt: str, image_url: str) -> str` — async, returns hosted video URL.
  - `veroagen.media.load_media_config() -> dict` — `{"image_model": str, "video_model": str}` from `config/media.yml`.
  - Both raise `MediaError(str)` on failure (module-level exception class).

- [ ] **Step 1: Write config + add dep**

`config/media.yml`:

```yaml
image_model: fal-ai/flux/schnell
video_model: fal-ai/kling-video/v2.5-turbo/pro/image-to-video
```

`pyproject.toml` dependencies list: add `"fal-client>=0.5",` then `uv sync`.

- [ ] **Step 2: Write failing test**

`tests/test_media.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from veroagen.media import MediaError, generate_image, generate_video, load_media_config


def test_load_media_config():
    cfg = load_media_config()
    assert cfg["image_model"] == "fal-ai/flux/schnell"
    assert "kling-video" in cfg["video_model"]


async def test_generate_image_returns_url():
    result = {"images": [{"url": "https://fal.media/img.png"}]}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        url = await generate_image("a sunset")
    assert url == "https://fal.media/img.png"
    args, kwargs = sub.call_args
    assert args[0] == "fal-ai/flux/schnell"
    assert kwargs["arguments"]["prompt"] == "a sunset"
    assert "image_url" not in kwargs["arguments"]


async def test_generate_image_with_ref():
    result = {"images": [{"url": "https://fal.media/img2.png"}]}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        await generate_image("hero shot", ref_image_url="https://fal.media/ref.png")
    assert sub.call_args.kwargs["arguments"]["image_url"] == "https://fal.media/ref.png"


async def test_generate_video_returns_url():
    result = {"video": {"url": "https://fal.media/v.mp4"}}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        url = await generate_video("pan across", image_url="https://fal.media/img.png")
    assert url == "https://fal.media/v.mp4"
    assert sub.call_args.kwargs["arguments"]["image_url"] == "https://fal.media/img.png"


async def test_media_error_on_failure():
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(side_effect=RuntimeError("quota"))):
        with pytest.raises(MediaError):
            await generate_image("x")


async def test_media_error_on_empty_result():
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value={"images": []})):
        with pytest.raises(MediaError):
            await generate_image("x")
```

- [ ] **Step 3: Run, verify FAIL** — `uv run pytest tests/test_media.py -v`

- [ ] **Step 4: Implement**

`veroagen/media.py`:

```python
import logging
from pathlib import Path

import fal_client
import yaml

log = logging.getLogger(__name__)
_CONFIG_PATH = Path(__file__).parent.parent / "config" / "media.yml"


class MediaError(Exception):
    pass


def load_media_config() -> dict:
    return yaml.safe_load(_CONFIG_PATH.read_text())


async def generate_image(prompt: str, ref_image_url: str | None = None) -> str:
    cfg = load_media_config()
    arguments: dict = {"prompt": prompt}
    if ref_image_url:
        arguments["image_url"] = ref_image_url
    try:
        result = await fal_client.subscribe_async(cfg["image_model"], arguments=arguments)
        return result["images"][0]["url"]
    except MediaError:
        raise
    except (KeyError, IndexError):
        raise MediaError(f"Image model returned no image: {result!r}")
    except Exception as e:  # noqa: BLE001 — fal errors vary; surface as MediaError
        raise MediaError(f"Image generation failed: {e}") from e


async def generate_video(prompt: str, image_url: str) -> str:
    cfg = load_media_config()
    arguments = {"prompt": prompt, "image_url": image_url}
    try:
        result = await fal_client.subscribe_async(cfg["video_model"], arguments=arguments)
        return result["video"]["url"]
    except MediaError:
        raise
    except KeyError:
        raise MediaError(f"Video model returned no video: {result!r}")
    except Exception as e:  # noqa: BLE001
        raise MediaError(f"Video generation failed: {e}") from e
```

- [ ] **Step 5: Run full suite, verify PASS**, **Step 6: Commit** — `git commit -am "feat: fal.ai media client for image and video generation"`

---

### Task 3: Generation jobs (async, doc-mutating, broadcasting)

**Files:**
- Create: `veroagen/jobs.py`
- Test: `tests/test_jobs.py`

**Interfaces:**
- Consumes: `veroagen.media.generate_image/generate_video` (patched in tests), `veroagen.doc.apply_ops`, `veroagen.db.Project/SessionLocal`, `veroagen.ws.hub`.
- Produces:
  - `mutate_and_broadcast(project_id: str, ops: list[dict]) -> dict` — loads project, applies ops, commits, broadcasts `{"type":"doc","doc":...}`, returns new doc. Raises `ValueError` if project missing.
  - Job coroutines (each fully self-contained; safe to `asyncio.create_task`):
    - `run_gen_character_ref(project_id: str, character_id: str) -> None`
    - `run_gen_shot_image(project_id: str, shot_id: str) -> None`
    - `run_gen_shot_video(project_id: str, shot_id: str) -> None`
  - `schedule(coro) -> asyncio.Task` — thin wrapper over `asyncio.create_task` keeping a module-level set of live tasks (prevents GC).
  - Job semantics (image example): set shot `status=image_generating` → call `generate_image` (with character ref URL if the shot's first `character_id` in `patch` has `ref_status=="ready"`) → on success `update_shot {image_url, status:"image_ready"}` + `add_asset` + `append_message` system note → on `MediaError` `update_shot {status:"failed", error:str(e)}` + system message. Video requires `image_url` present, else fails immediately. Character ref: analogous with `update_character`.
  - System messages use role `"system"` with content like `"Shot x1 image ready."` / `"Shot x1 generation failed: <err>"`.

- [ ] **Step 1: Write failing tests**

`tests/test_jobs.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from veroagen.db import Project, SessionLocal, init_db
from veroagen.doc import apply_ops, new_project_doc
from veroagen.jobs import (
    mutate_and_broadcast,
    run_gen_character_ref,
    run_gen_shot_image,
    run_gen_shot_video,
)


async def make_project(**doc_ops) -> str:
    await init_db()
    doc = new_project_doc("J")
    if doc_ops.get("shots"):
        doc = apply_ops(doc, [{"op": "set_shots", "shots": doc_ops["shots"]}])
    if doc_ops.get("characters"):
        doc = apply_ops(doc, [{"op": "set_characters", "items": doc_ops["characters"]}])
    async with SessionLocal() as s:
        p = Project(user_id="u1", doc=doc)
        s.add(p)
        await s.commit()
        return p.id


SHOT = {"id": "x1", "scene_id": "s1", "prompt": "sunset", "camera": "",
        "duration_s": 5, "status": "draft"}
CHAR = {"id": "c1", "name": "Ava", "description": "explorer",
        "ref_image_url": None, "ref_status": "none"}


async def get_doc(pid):
    async with SessionLocal() as s:
        return (await s.get(Project, pid)).doc


async def test_mutate_and_broadcast_persists_and_broadcasts():
    pid = await make_project()
    with patch("veroagen.jobs.hub.broadcast", new=AsyncMock()) as bc:
        doc = await mutate_and_broadcast(pid, [{"op": "append_message",
                                                "message": {"role": "system", "content": "hi"}}])
    assert doc["chat"]["messages"][-1]["content"] == "hi"
    bc.assert_awaited_once()
    assert (await get_doc(pid))["version"] == doc["version"]


async def test_gen_shot_image_success():
    pid = await make_project(shots=[dict(SHOT)])
    with patch("veroagen.jobs.generate_image",
               new=AsyncMock(return_value="https://fal.media/i.png")), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_image(pid, "x1")
    doc = await get_doc(pid)
    shot = doc["storyboard"]["shots"][0]
    assert shot["status"] == "image_ready" and shot["image_url"] == "https://fal.media/i.png"
    assert doc["assets"]["items"][0]["kind"] == "image"
    assert "image ready" in doc["chat"]["messages"][-1]["content"].lower()


async def test_gen_shot_image_failure_marks_failed():
    from veroagen.media import MediaError
    pid = await make_project(shots=[dict(SHOT)])
    with patch("veroagen.jobs.generate_image", new=AsyncMock(side_effect=MediaError("quota"))), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_image(pid, "x1")
    doc = await get_doc(pid)
    assert doc["storyboard"]["shots"][0]["status"] == "failed"
    assert "quota" in doc["storyboard"]["shots"][0]["error"]


async def test_gen_shot_image_uses_character_ref():
    shot = dict(SHOT, character_id="c1")
    char = dict(CHAR, ref_image_url="https://fal.media/ref.png", ref_status="ready")
    pid = await make_project(shots=[shot], characters=[char])
    gen = AsyncMock(return_value="https://fal.media/i.png")
    with patch("veroagen.jobs.generate_image", new=gen), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_image(pid, "x1")
    assert gen.call_args.kwargs.get("ref_image_url") == "https://fal.media/ref.png"


async def test_gen_shot_video_requires_image():
    pid = await make_project(shots=[dict(SHOT)])  # no image_url
    with patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_video(pid, "x1")
    doc = await get_doc(pid)
    assert doc["storyboard"]["shots"][0]["status"] == "failed"


async def test_gen_shot_video_success():
    shot = dict(SHOT, image_url="https://fal.media/i.png", status="image_ready")
    pid = await make_project(shots=[shot])
    with patch("veroagen.jobs.generate_video",
               new=AsyncMock(return_value="https://fal.media/v.mp4")), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_shot_video(pid, "x1")
    doc = await get_doc(pid)
    shot = doc["storyboard"]["shots"][0]
    assert shot["status"] == "video_ready" and shot["video_url"] == "https://fal.media/v.mp4"


async def test_gen_character_ref_success():
    pid = await make_project(characters=[dict(CHAR)])
    with patch("veroagen.jobs.generate_image",
               new=AsyncMock(return_value="https://fal.media/ref.png")), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_character_ref(pid, "c1")
    doc = await get_doc(pid)
    char = doc["characters"]["items"][0]
    assert char["ref_status"] == "ready" and char["ref_image_url"] == "https://fal.media/ref.png"
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_jobs.py -v`

- [ ] **Step 3: Implement**

`veroagen/jobs.py`:

```python
import asyncio
import logging
import uuid

from veroagen.db import Project, SessionLocal
from veroagen.doc import apply_ops, ensure_doc_shape
from veroagen.media import MediaError, generate_image, generate_video
from veroagen.ws import hub

log = logging.getLogger(__name__)
_live_tasks: set[asyncio.Task] = set()


def schedule(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _live_tasks.add(task)
    task.add_done_callback(_live_tasks.discard)
    return task


async def mutate_and_broadcast(project_id: str, ops: list[dict]) -> dict:
    async with SessionLocal() as session:
        proj = await session.get(Project, project_id)
        if proj is None:
            raise ValueError(f"Unknown project: {project_id}")
        proj.doc = apply_ops(proj.doc, ops)
        session.add(proj)
        await session.commit()
        doc = proj.doc
    await hub.broadcast(project_id, {"type": "doc", "doc": doc})
    return doc


async def _load_doc(project_id: str) -> dict:
    async with SessionLocal() as session:
        proj = await session.get(Project, project_id)
        if proj is None:
            raise ValueError(f"Unknown project: {project_id}")
        return ensure_doc_shape(proj.doc)


def _system_msg(text: str) -> dict:
    return {"op": "append_message", "message": {"role": "system", "content": text}}


def _asset(kind: str, url: str, shot_id: str | None = None,
           character_id: str | None = None) -> dict:
    return {"op": "add_asset", "asset": {
        "id": str(uuid.uuid4()), "kind": kind, "url": url,
        "shot_id": shot_id, "character_id": character_id, "model": kind,
    }}


def _get_item(doc: dict, section: str, key: str, item_id: str) -> dict | None:
    for item in doc[section][key]:
        if item.get("id") == item_id:
            return item
    return None


async def run_gen_character_ref(project_id: str, character_id: str) -> None:
    doc = await _load_doc(project_id)
    char = _get_item(doc, "characters", "items", character_id)
    if char is None:
        log.warning("gen_character_ref: unknown character %s", character_id)
        return
    await mutate_and_broadcast(project_id, [
        {"op": "update_character", "character_id": character_id,
         "patch": {"ref_status": "generating"}}])
    try:
        prompt = f"Character reference sheet, full body, neutral background: {char['name']}, {char['description']}"
        url = await generate_image(prompt)
        await mutate_and_broadcast(project_id, [
            {"op": "update_character", "character_id": character_id,
             "patch": {"ref_status": "ready", "ref_image_url": url}},
            _asset("image", url, character_id=character_id),
            _system_msg(f"Character {char['name']} reference image ready."),
        ])
    except MediaError as e:
        await mutate_and_broadcast(project_id, [
            {"op": "update_character", "character_id": character_id,
             "patch": {"ref_status": "failed", "error": str(e)}},
            _system_msg(f"Character {char['name']} reference generation failed: {e}"),
        ])


async def run_gen_shot_image(project_id: str, shot_id: str) -> None:
    doc = await _load_doc(project_id)
    shot = _get_item(doc, "storyboard", "shots", shot_id)
    if shot is None:
        log.warning("gen_shot_image: unknown shot %s", shot_id)
        return
    ref_url = None
    char_id = shot.get("character_id")
    if char_id:
        char = _get_item(doc, "characters", "items", char_id)
        if char and char.get("ref_status") == "ready":
            ref_url = char.get("ref_image_url")
    await mutate_and_broadcast(project_id, [
        {"op": "update_shot", "shot_id": shot_id, "patch": {"status": "image_generating"}}])
    try:
        url = await generate_image(shot["prompt"], ref_image_url=ref_url)
        await mutate_and_broadcast(project_id, [
            {"op": "update_shot", "shot_id": shot_id,
             "patch": {"status": "image_ready", "image_url": url, "error": None}},
            _asset("image", url, shot_id=shot_id),
            _system_msg(f"Shot {shot_id} image ready."),
        ])
    except MediaError as e:
        await mutate_and_broadcast(project_id, [
            {"op": "update_shot", "shot_id": shot_id,
             "patch": {"status": "failed", "error": str(e)}},
            _system_msg(f"Shot {shot_id} image generation failed: {e}"),
        ])


async def run_gen_shot_video(project_id: str, shot_id: str) -> None:
    doc = await _load_doc(project_id)
    shot = _get_item(doc, "storyboard", "shots", shot_id)
    if shot is None:
        log.warning("gen_shot_video: unknown shot %s", shot_id)
        return
    if not shot.get("image_url"):
        await mutate_and_broadcast(project_id, [
            {"op": "update_shot", "shot_id": shot_id,
             "patch": {"status": "failed", "error": "No image to animate — generate the shot image first."}},
            _system_msg(f"Shot {shot_id} video failed: no image yet."),
        ])
        return
    await mutate_and_broadcast(project_id, [
        {"op": "update_shot", "shot_id": shot_id, "patch": {"status": "video_generating"}}])
    try:
        url = await generate_video(shot["prompt"], image_url=shot["image_url"])
        await mutate_and_broadcast(project_id, [
            {"op": "update_shot", "shot_id": shot_id,
             "patch": {"status": "video_ready", "video_url": url, "error": None}},
            _asset("video", url, shot_id=shot_id),
            _system_msg(f"Shot {shot_id} video ready."),
        ])
    except MediaError as e:
        await mutate_and_broadcast(project_id, [
            {"op": "update_shot", "shot_id": shot_id,
             "patch": {"status": "failed", "error": str(e)}},
            _system_msg(f"Shot {shot_id} video generation failed: {e}"),
        ])
```

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: async generation jobs with doc mutation and broadcast"`

---

### Task 4: Agent tools v2 — characters + generation

**Files:**
- Modify: `veroagen/agent.py`
- Test: `tests/test_agent.py` (append)

**Interfaces:**
- Consumes: `apply_ops` ops from Task 1.
- Produces:
  - `run_turn(doc, user_message, llm=chat) -> tuple[dict, list[dict], list[dict]]` — **BREAKING**: now returns `(new_doc, events, job_requests)`. Each job request: `{"job": "gen_character_ref"|"gen_shot_image"|"gen_shot_video", "project_scope_id": str}` where `project_scope_id` is the character/shot id (jobs get project id from the caller).
  - New TOOLS entries: `set_characters` (replace character list; ids/name/description; ref fields preserved by tool executor for existing ids), `gen_character_ref {character_id}`, `gen_shot_image {shot_id}`, `gen_shot_video {shot_id}`.
  - Generation tools do NOT mutate the doc themselves (jobs do); they emit a job request and a tool result `"queued"`.
  - Callers of `run_turn` must be updated in the same task: `veroagen/routers/chat.py` (see Task 5 — but keep chat.py compiling here by unpacking 3 values and ignoring jobs; Task 5 wires scheduling). Update existing tests unpacking 2 values.

- [ ] **Step 1: Write failing tests** (append to `tests/test_agent.py`)

```python
def test_set_characters_tool_preserves_ref_fields():
    d = new_project_doc("t")
    d = apply_ops(d, [{"op": "set_characters", "items": [
        {"id": "c1", "name": "Ava", "description": "old",
         "ref_image_url": "http://ref", "ref_status": "ready"}]}])
    llm = stub_llm_factory([
        tool_call("set_characters", {"characters": [
            {"id": "c1", "name": "Ava", "description": "updated"},
            {"id": "c2", "name": "Bo", "description": "sidekick"}]}),
        {"role": "assistant", "content": "Cast updated.", "tool_calls": None},
    ])
    doc, _, jobs = run_turn(d, "update cast", llm=llm)
    items = doc["characters"]["items"]
    assert items[0]["ref_image_url"] == "http://ref"      # preserved
    assert items[0]["ref_status"] == "ready"
    assert items[0]["description"] == "updated"
    assert items[1]["ref_status"] == "none"               # new char default
    assert jobs == []


def test_gen_tools_emit_job_requests_without_doc_mutation():
    d = new_project_doc("t")
    d = apply_ops(d, [{"op": "set_shots", "shots": [
        {"id": "x1", "scene_id": "s1", "prompt": "p", "camera": "",
         "duration_s": 5, "status": "draft"}]}])
    version_before = d["version"]
    llm = stub_llm_factory([
        tool_call("gen_shot_image", {"shot_id": "x1"}),
        {"role": "assistant", "content": "Generating!", "tool_calls": None},
    ])
    doc, _, jobs = run_turn(d, "make the image", llm=llm)
    assert jobs == [{"job": "gen_shot_image", "project_scope_id": "x1"}]
    # only chat messages mutated (user + assistant), no shot status change
    assert doc["storyboard"]["shots"][0]["status"] == "draft"
    assert doc["version"] == version_before + 2  # two append_message calls


def test_run_turn_returns_three_values_for_plain_reply():
    llm = stub_llm_factory([{"role": "assistant", "content": "Hi", "tool_calls": None}])
    doc, events, jobs = run_turn(new_project_doc("t"), "hi", llm=llm)
    assert jobs == []
```

Also update ALL existing `run_turn` call sites in `tests/test_agent.py` from `doc, events = run_turn(...)` / `doc, _ = run_turn(...)` to unpack three values (`doc, events, _ = ...` / `doc, _, _ = ...`).

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_agent.py -v`

- [ ] **Step 3: Implement** — in `veroagen/agent.py`:

Append to `TOOLS`:

```python
    {
        "type": "function",
        "function": {
            "name": "set_characters",
            "description": "Replace the character list. Existing characters keep their reference images.",
            "parameters": {
                "type": "object",
                "properties": {
                    "characters": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["id", "name", "description"],
                        },
                    }
                },
                "required": ["characters"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gen_character_ref",
            "description": "Generate the reference image for a character (async job).",
            "parameters": {
                "type": "object",
                "properties": {"character_id": {"type": "string"}},
                "required": ["character_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gen_shot_image",
            "description": "Generate the image for a storyboard shot (async job).",
            "parameters": {
                "type": "object",
                "properties": {"shot_id": {"type": "string"}},
                "required": ["shot_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gen_shot_video",
            "description": "Animate a shot's image into video (async job; needs the image first).",
            "parameters": {
                "type": "object",
                "properties": {"shot_id": {"type": "string"}},
                "required": ["shot_id"],
            },
        },
    },
```

Replace `_execute_tool` and `run_turn` with:

```python
_JOB_TOOLS = {
    "gen_character_ref": "character_id",
    "gen_shot_image": "shot_id",
    "gen_shot_video": "shot_id",
}


def _merged_characters(doc: dict, incoming: list[dict]) -> list[dict]:
    existing = {c["id"]: c for c in doc.get("characters", {}).get("items", [])}
    merged = []
    for c in incoming:
        prev = existing.get(c["id"], {})
        merged.append({
            "id": c["id"], "name": c["name"], "description": c["description"],
            "ref_image_url": prev.get("ref_image_url"),
            "ref_status": prev.get("ref_status", "none"),
        })
    return merged


def _execute_tool(doc: dict, name: str, args: dict) -> tuple[dict, dict | None]:
    """Returns (new_doc, job_request | None)."""
    if name in _JOB_TOOLS:
        return doc, {"job": name, "project_scope_id": args[_JOB_TOOLS[name]]}
    if name == "update_script":
        return apply_ops(doc, [{"op": "set_script", "scenes": args["scenes"]}]), None
    if name == "update_storyboard":
        shots = [{"camera": "", "duration_s": 5, "status": "draft", **s} for s in args["shots"]]
        return apply_ops(doc, [{"op": "set_shots", "shots": shots}]), None
    if name == "set_characters":
        items = _merged_characters(doc, args["characters"])
        return apply_ops(doc, [{"op": "set_characters", "items": items}]), None
    raise ValueError(f"Unknown tool: {name}")


def run_turn(doc: dict, user_message: str, llm=chat) -> tuple[dict, list[dict], list[dict]]:
    events: list[dict] = []
    job_requests: list[dict] = []
    doc = apply_ops(doc, [{"op": "append_message",
                           "message": {"role": "user", "content": user_message}}])
    events.append({"type": "doc", "doc": doc})

    convo: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": "Current project doc: " + json.dumps({
            "script": doc["script"], "storyboard": doc["storyboard"],
            "characters": doc.get("characters", {"items": []}),
        })},
        *doc["chat"]["messages"],
    ]

    for _ in range(MAX_ITERATIONS):
        msg = llm(convo, tools=TOOLS)
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            content = (msg.get("content") or "").strip() or "Updated the project."
            doc = apply_ops(doc, [{"op": "append_message",
                                   "message": {"role": "assistant", "content": content}}])
            events.append({"type": "doc", "doc": doc})
            return doc, events, job_requests

        convo.append(msg)
        for tc in tool_calls:
            try:
                name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"])
                doc, job = _execute_tool(doc, name, args)
                if job:
                    job_requests.append(job)
                    convo.append({"role": "tool", "tool_call_id": tc["id"], "content": "queued"})
                else:
                    events.append({"type": "doc", "doc": doc})
                    convo.append({"role": "tool", "tool_call_id": tc["id"], "content": "ok"})
            except (ValueError, json.JSONDecodeError, KeyError) as e:
                convo.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                              "content": f"error: {e}"})

    doc = apply_ops(doc, [{"op": "append_message",
                           "message": {"role": "assistant", "content": "Updated the project."}}])
    events.append({"type": "doc", "doc": doc})
    return doc, events, job_requests
```

Also update `SYSTEM_PROMPT` (replace existing) to mention characters and generation:

```python
SYSTEM_PROMPT = """You are Veroagen, an AI video production director.
You help the user plan and produce a video: write the script (scenes with narration),
define characters, build the storyboard (shots per scene with visual prompt, camera,
duration, optional character_id), and generate media.
Workflow: script → characters (set_characters, then gen_character_ref for each) →
storyboard → gen_shot_image per shot → gen_shot_video once the image is ready.
Generation tools run async — tell the user generation started; results appear live.
Keep replies short; the user sees everything update live in their workspace."""
```

And in `veroagen/routers/chat.py`, change the unpack line so it still compiles (job scheduling is Task 5):

```python
    new_doc, events, job_requests = await anyio.to_thread.run_sync(run_turn, proj.doc, body.message)
```

Update `tests/test_chat_api.py`'s `fake_run_turn` to return 3 values: `return d, [{"type": "doc", "doc": d}], []`.

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: agent character and generation tools, run_turn emits job requests"`

---

### Task 5: Wire job scheduling into chat + manual REST triggers

**Files:**
- Modify: `veroagen/routers/chat.py`
- Create: `veroagen/routers/generate.py`
- Modify: `veroagen/main.py` (include generate router)
- Test: `tests/test_generate_api.py`, `tests/test_chat_api.py` (append)

**Interfaces:**
- Consumes: `veroagen.jobs.schedule/run_gen_character_ref/run_gen_shot_image/run_gen_shot_video`, `get_owned_project`, `mutate_and_broadcast` semantics via jobs.
- Produces REST:
  - `POST /projects/{id}/characters {name, description} -> {doc}` — creates character with uuid id, `ref_status:"none"`, via `apply_ops` `set_characters` (existing + new), broadcasts.
  - `POST /projects/{id}/characters/{character_id}/generate-ref -> {"status": "queued"}` (404 unknown character)
  - `POST /projects/{id}/shots/{shot_id}/generate-image -> {"status": "queued"}` (404 unknown shot)
  - `POST /projects/{id}/shots/{shot_id}/generate-video -> {"status": "queued"}` (404 unknown shot)
  - Chat endpoint schedules every `job_request` from `run_turn` after commit: mapping `{"gen_character_ref": run_gen_character_ref, "gen_shot_image": run_gen_shot_image, "gen_shot_video": run_gen_shot_video}` called as `schedule(fn(proj.id, scope_id))`.

- [ ] **Step 1: Write failing tests**

`tests/test_generate_api.py`:

```python
from unittest.mock import AsyncMock, patch

from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}

SHOTS = [{"id": "x1", "scene_id": "s1", "prompt": "p", "camera": "",
          "duration_s": 5, "status": "draft"}]


async def make_project(client):
    r = await client.post("/projects", json={"title": "G"}, headers=H)
    pid = r.json()["id"]
    await client.put(f"/projects/{pid}/storyboard", json={"shots": SHOTS}, headers=H)
    return pid


async def test_create_character(client):
    pid = await make_project(client)
    with patch("veroagen.routers.generate.hub.broadcast", new=AsyncMock()):
        r = await client.post(f"/projects/{pid}/characters",
                              json={"name": "Ava", "description": "explorer"}, headers=H)
    assert r.status_code == 201
    items = r.json()["doc"]["characters"]["items"]
    assert items[0]["name"] == "Ava" and items[0]["ref_status"] == "none"


async def test_generate_ref_queues_job(client):
    pid = await make_project(client)
    with patch("veroagen.routers.generate.hub.broadcast", new=AsyncMock()):
        r = await client.post(f"/projects/{pid}/characters",
                              json={"name": "Ava", "description": "d"}, headers=H)
    cid = r.json()["doc"]["characters"]["items"][0]["id"]
    with patch("veroagen.routers.generate.schedule") as sched:
        r2 = await client.post(f"/projects/{pid}/characters/{cid}/generate-ref", headers=H)
    assert r2.status_code == 200 and r2.json() == {"status": "queued"}
    sched.assert_called_once()


async def test_generate_image_queues_job(client):
    pid = await make_project(client)
    with patch("veroagen.routers.generate.schedule") as sched:
        r = await client.post(f"/projects/{pid}/shots/x1/generate-image", headers=H)
    assert r.status_code == 200
    sched.assert_called_once()


async def test_generate_image_unknown_shot_404(client):
    pid = await make_project(client)
    with patch("veroagen.routers.generate.schedule") as sched:
        r = await client.post(f"/projects/{pid}/shots/nope/generate-image", headers=H)
    assert r.status_code == 404
    sched.assert_not_called()


async def test_generate_video_queues_job(client):
    pid = await make_project(client)
    with patch("veroagen.routers.generate.schedule") as sched:
        r = await client.post(f"/projects/{pid}/shots/x1/generate-video", headers=H)
    assert r.status_code == 200
    sched.assert_called_once()
```

Append to `tests/test_chat_api.py`:

```python
async def test_chat_schedules_agent_jobs(client):
    r = await client.post("/projects", json={"title": "CJ"}, headers=H)
    pid = r.json()["id"]

    def fake_run_turn(doc, message, llm=None):
        from veroagen.doc import apply_ops
        d = apply_ops(doc, [{"op": "append_message",
                             "message": {"role": "assistant", "content": "queued"}}])
        return d, [], [{"job": "gen_shot_image", "project_scope_id": "x1"}]

    with patch("veroagen.routers.chat.run_turn", side_effect=fake_run_turn), \
         patch("veroagen.routers.chat.schedule") as sched:
        r2 = await client.post(f"/projects/{pid}/chat", json={"message": "go"}, headers=H)
    assert r2.status_code == 200
    sched.assert_called_once()
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

`veroagen/routers/generate.py`:

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.db import Project, get_session
from veroagen.doc import apply_ops, ensure_doc_shape
from veroagen.jobs import (
    run_gen_character_ref,
    run_gen_shot_image,
    run_gen_shot_video,
    schedule,
)
from veroagen.routers.projects import get_owned_project
from veroagen.ws import hub

router = APIRouter(prefix="/projects", tags=["generate"])


class CharacterIn(BaseModel):
    name: str
    description: str


def _has_item(doc: dict, section: str, item_id: str) -> bool:
    key = "shots" if section == "storyboard" else "items"
    return any(i.get("id") == item_id for i in ensure_doc_shape(doc)[section][key])


@router.post("/{project_id}/characters", status_code=201)
async def create_character(
    body: CharacterIn,
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    items = ensure_doc_shape(proj.doc)["characters"]["items"] + [{
        "id": str(uuid.uuid4()), "name": body.name, "description": body.description,
        "ref_image_url": None, "ref_status": "none",
    }]
    proj.doc = apply_ops(proj.doc, [{"op": "set_characters", "items": items}])
    session.add(proj)
    await session.commit()
    await hub.broadcast(proj.id, {"type": "doc", "doc": proj.doc})
    return {"doc": proj.doc}


@router.post("/{project_id}/characters/{character_id}/generate-ref")
async def generate_ref(character_id: str, proj: Project = Depends(get_owned_project)):
    if not _has_item(proj.doc, "characters", character_id):
        raise HTTPException(status_code=404, detail="Character not found")
    schedule(run_gen_character_ref(proj.id, character_id))
    return {"status": "queued"}


@router.post("/{project_id}/shots/{shot_id}/generate-image")
async def generate_image_endpoint(shot_id: str, proj: Project = Depends(get_owned_project)):
    if not _has_item(proj.doc, "storyboard", shot_id):
        raise HTTPException(status_code=404, detail="Shot not found")
    schedule(run_gen_shot_image(proj.id, shot_id))
    return {"status": "queued"}


@router.post("/{project_id}/shots/{shot_id}/generate-video")
async def generate_video_endpoint(shot_id: str, proj: Project = Depends(get_owned_project)):
    if not _has_item(proj.doc, "storyboard", shot_id):
        raise HTTPException(status_code=404, detail="Shot not found")
    schedule(run_gen_shot_video(proj.id, shot_id))
    return {"status": "queued"}
```

`veroagen/routers/chat.py` — full new content:

```python
import anyio
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.agent import run_turn
from veroagen.db import Project, get_session
from veroagen.jobs import (
    run_gen_character_ref,
    run_gen_shot_image,
    run_gen_shot_video,
    schedule,
)
from veroagen.routers.projects import get_owned_project
from veroagen.ws import hub

router = APIRouter(prefix="/projects", tags=["chat"])

_JOB_RUNNERS = {
    "gen_character_ref": run_gen_character_ref,
    "gen_shot_image": run_gen_shot_image,
    "gen_shot_video": run_gen_shot_video,
}


class ChatIn(BaseModel):
    message: str


@router.post("/{project_id}/chat")
async def chat_turn(
    body: ChatIn,
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    new_doc, events, job_requests = await anyio.to_thread.run_sync(
        run_turn, proj.doc, body.message
    )
    proj.doc = new_doc
    session.add(proj)
    await session.commit()
    for event in events:
        await hub.broadcast(proj.id, event)
    for req in job_requests:
        runner = _JOB_RUNNERS.get(req["job"])
        if runner:
            schedule(runner(proj.id, req["project_scope_id"]))
    return {"doc": new_doc}
```

`veroagen/main.py` add:

```python
from veroagen.routers.generate import router as generate_router

app.include_router(generate_router)
```

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: job scheduling from chat and manual generation endpoints"`

---

### Task 6: Frontend — characters tab + generation UI

**Files (viralo repo, only `frontend/src/veroagen/`):**
- Modify: `frontend/src/veroagen/types.ts`, `frontend/src/veroagen/api.ts`, `frontend/src/veroagen/StoryboardView.tsx`, `frontend/src/veroagen/WorkspacePage.tsx`
- Create: `frontend/src/veroagen/CharactersView.tsx`

**Interfaces:**
- Consumes: backend routes from Task 5, doc shape from Task 1.
- Produces: `Characters` tab; storyboard cards show image/video, status badge, Generate image / Generate video buttons.

- [ ] **Step 1: Extend types** — in `frontend/src/veroagen/types.ts`:

```ts
export type ShotStatus =
  | "draft" | "image_generating" | "image_ready"
  | "video_generating" | "video_ready" | "failed";

export interface Shot {
  id: string; scene_id: string; prompt: string;
  camera: string; duration_s: number; status: ShotStatus;
  character_id?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  error?: string | null;
}

export interface Character {
  id: string; name: string; description: string;
  ref_image_url: string | null;
  ref_status: "none" | "generating" | "ready" | "failed";
  error?: string | null;
}

export interface ChatMessage { role: "user" | "assistant" | "system"; content: string }

export interface ProjectDoc {
  title: string;
  script: { scenes: Scene[] };
  storyboard: { shots: Shot[] };
  chat: { messages: ChatMessage[] };
  characters: { items: Character[] };
  assets: { items: unknown[] };
  version: number;
}
```

(Keep `Scene`, `ProjectSummary` as-is; replace old `Shot`/`ChatMessage`/`ProjectDoc` definitions.)

- [ ] **Step 2: Extend api client** — append methods to `veroagenApi` in `frontend/src/veroagen/api.ts`:

```ts
  createCharacter: (id: string, name: string, description: string) =>
    req<{ doc: ProjectDoc }>("POST", `/projects/${id}/characters`, { name, description }),
  generateRef: (id: string, characterId: string) =>
    req<{ status: string }>("POST", `/projects/${id}/characters/${characterId}/generate-ref`),
  generateShotImage: (id: string, shotId: string) =>
    req<{ status: string }>("POST", `/projects/${id}/shots/${shotId}/generate-image`),
  generateShotVideo: (id: string, shotId: string) =>
    req<{ status: string }>("POST", `/projects/${id}/shots/${shotId}/generate-video`),
```

(Import `ProjectDoc` type already imported; ensure `Character` not needed here.)

- [ ] **Step 3: CharactersView**

`frontend/src/veroagen/CharactersView.tsx`:

```tsx
import { useState } from "react";
import type { Character } from "./types";

export function CharactersView({
  characters, onCreate, onGenerateRef,
}: {
  characters: Character[];
  onCreate: (name: string, description: string) => void;
  onGenerateRef: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const create = () => {
    if (!name.trim() || !desc.trim()) return;
    onCreate(name.trim(), desc.trim());
    setName(""); setDesc("");
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
               className="w-40 rounded-md border bg-background px-3 py-2 text-sm" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description"
               onKeyDown={(e) => e.key === "Enter" && create()}
               className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
        <button onClick={create} className="rounded-md bg-[#ff3d6a] px-3 py-2 text-sm text-white">
          Add
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {characters.map((c) => (
          <div key={c.id} className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.ref_status}</span>
            </div>
            <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded bg-muted">
              {c.ref_image_url
                ? <img src={c.ref_image_url} alt={c.name} className="h-full w-full object-cover" />
                : <span className="text-xs text-muted-foreground">
                    {c.ref_status === "generating" ? "Generating…" : "No reference yet"}
                  </span>}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">{c.description}</p>
            {c.ref_status === "failed" && <p className="mb-2 text-xs text-red-500">{c.error}</p>}
            <button
              onClick={() => onGenerateRef(c.id)}
              disabled={c.ref_status === "generating"}
              className="w-full rounded-md border px-2 py-1 text-xs disabled:opacity-50"
            >
              {c.ref_image_url ? "Regenerate reference" : "Generate reference"}
            </button>
          </div>
        ))}
        {!characters.length && (
          <p className="col-span-full text-sm text-muted-foreground">
            No characters yet — add one or ask the director.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Upgrade StoryboardView** — replace `frontend/src/veroagen/StoryboardView.tsx`:

```tsx
import type { Shot } from "./types";

const BUSY: Shot["status"][] = ["image_generating", "video_generating"];

export function StoryboardView({
  shots, onGenerateImage, onGenerateVideo,
}: {
  shots: Shot[];
  onGenerateImage: (id: string) => void;
  onGenerateVideo: (id: string) => void;
}) {
  if (!shots.length) return <div className="p-6 text-sm text-muted-foreground">No storyboard yet.</div>;
  return (
    <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
      {shots.map((s) => {
        const busy = BUSY.includes(s.status);
        return (
          <div key={s.id} className="rounded-md border p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{s.id}</span>
              <span>{s.duration_s}s · {s.camera || "auto"}</span>
            </div>
            <div className="mb-2 flex aspect-video items-center justify-center overflow-hidden rounded bg-muted">
              {s.video_url ? (
                <video src={s.video_url} controls className="h-full w-full object-cover" />
              ) : s.image_url ? (
                <img src={s.image_url} alt={s.prompt} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {busy ? "Generating…" : s.status}
                </span>
              )}
            </div>
            <p className="mb-2 text-sm">{s.prompt}</p>
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

- [ ] **Step 5: Wire WorkspacePage** — replace tab wiring in `frontend/src/veroagen/WorkspacePage.tsx`:

```tsx
import { useState } from "react";
import { Shell } from "@/workspace/Shell";
import { veroagenApi } from "./api";
import { ChatPanel } from "./ChatPanel";
import { CharactersView } from "./CharactersView";
import { ScriptView } from "./ScriptView";
import { StoryboardView } from "./StoryboardView";
import { useProjectDoc } from "./useProjectDoc";

const TABS = ["Script", "Characters", "Storyboard"] as const;

export function VeroagenWorkspacePage({ projectId }: { projectId: string }) {
  const { doc, setDoc, sendMessage, saveScript, sending } = useProjectDoc(projectId);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Script");

  if (!doc) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const createCharacter = async (name: string, description: string) => {
    const r = await veroagenApi.createCharacter(projectId, name, description);
    setDoc(r.doc);
  };

  return (
    <Shell active={"veroagen" as never}>
      <div className="grid h-[calc(100vh-0px)] grid-cols-[1fr_380px]">
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b px-4 py-2">
            <span className="mr-4 text-sm font-semibold">{doc.title}</span>
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-muted font-medium" : "text-muted-foreground"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === "Script" && <ScriptView scenes={doc.script.scenes} onSave={saveScript} />}
            {tab === "Characters" && (
              <CharactersView
                characters={doc.characters?.items ?? []}
                onCreate={createCharacter}
                onGenerateRef={(cid) => void veroagenApi.generateRef(projectId, cid)}
              />
            )}
            {tab === "Storyboard" && (
              <StoryboardView
                shots={doc.storyboard.shots}
                onGenerateImage={(sid) => void veroagenApi.generateShotImage(projectId, sid)}
                onGenerateVideo={(sid) => void veroagenApi.generateShotVideo(projectId, sid)}
              />
            )}
          </div>
        </div>
        <ChatPanel messages={doc.chat.messages} onSend={sendMessage} sending={sending} />
      </div>
    </Shell>
  );
}
```

Note the Shell cast: keep the same documented cast pattern used in Phase 1 (`"veroagen" as never` or the existing `as unknown as PageKey` — match whatever ProjectListPage.tsx uses).

`useProjectDoc.ts`: expose `setDoc` in the return value (add `setDoc` to the returned object) so `createCharacter` can update state; also render system messages in ChatPanel — in `frontend/src/veroagen/ChatPanel.tsx` change the message bubble class logic:

```tsx
className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
  m.role === "user"
    ? "ml-auto bg-[#ff3d6a] text-white"
    : m.role === "system"
      ? "mx-auto bg-transparent text-xs text-muted-foreground"
      : "bg-muted"
}`}
```

- [ ] **Step 6: Verify build** — `cd /Users/saman/Documents/personal/viralo/frontend && npm run build` — Expected: success.
- [ ] **Step 7: Commit (viralo repo, only veroagen files)**

```bash
git add frontend/src/veroagen
git commit -m "feat(veroagen): characters tab and shot generation UI"
```

---

### Task 7: Generation smoke test (mocked fal, full chat flow)

**Files:**
- Create: `tests/test_generation_e2e.py`
- Modify: `README.md` (Phase 2 section), `.env.example` (add `FAL_KEY=`)

**Interfaces:** none new — verification.

- [ ] **Step 1: Write the e2e test**

`tests/test_generation_e2e.py`:

```python
"""E2E: chat → agent queues gen job → job runs (mocked fal) → doc reflects media."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}


def tool_call(name, args):
    return {"role": "assistant", "content": None,
            "tool_calls": [{"id": "c1", "type": "function",
                            "function": {"name": name, "arguments": json.dumps(args)}}]}


async def test_full_generation_flow(client):
    r = await client.post("/projects", json={"title": "E2E"}, headers=H)
    pid = r.json()["id"]
    shots = [{"id": "x1", "scene_id": "s1", "prompt": "sunrise", "camera": "wide",
              "duration_s": 4, "status": "draft"}]
    await client.put(f"/projects/{pid}/storyboard", json={"shots": shots}, headers=H)

    responses = iter([
        tool_call("gen_shot_image", {"shot_id": "x1"}),
        {"role": "assistant", "content": "Generating shot x1!", "tool_calls": None},
    ])
    with patch("veroagen.agent.chat", side_effect=lambda m, tools=None: next(responses)), \
         patch("veroagen.jobs.generate_image",
               new=AsyncMock(return_value="https://fal.media/i.png")), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()), \
         patch("veroagen.routers.chat.hub.broadcast", new=AsyncMock()):
        r2 = await client.post(f"/projects/{pid}/chat",
                               json={"message": "generate the image for x1"}, headers=H)
        assert r2.status_code == 200
        # let the scheduled job run
        await asyncio.sleep(0.05)

    r3 = await client.get(f"/projects/{pid}", headers=H)
    doc = r3.json()["doc"]
    shot = doc["storyboard"]["shots"][0]
    assert shot["status"] == "image_ready"
    assert shot["image_url"] == "https://fal.media/i.png"
    assert any(m["role"] == "system" and "image ready" in m["content"].lower()
               for m in doc["chat"]["messages"])
    assert doc["assets"]["items"]
```

- [ ] **Step 2: Run, verify PASS** — `uv run pytest tests/test_generation_e2e.py -v` (if the sleep races, bump to 0.2 — the job is fully mocked so it completes in microseconds)

- [ ] **Step 3: Docs** — `.env.example` add line `FAL_KEY=`; `README.md` append:

```markdown
## Phase 2 — Generation

Media generation runs through [fal.ai](https://fal.ai). Set `FAL_KEY` in `.env`.
Models configured in `config/media.yml` (image + image-to-video).
Generation is async: the agent (or the UI buttons) queue jobs; shot status and
media URLs stream to the workspace over the project WebSocket.
```

- [ ] **Step 4: Full suite** — `uv run pytest -v` — all pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "test: generation e2e with mocked fal, phase 2 docs"`
