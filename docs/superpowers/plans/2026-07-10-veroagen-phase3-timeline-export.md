# Veroagen Phase 3 (Timeline & Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project's video-ready shots can be arranged on a timeline with voiceover and music, rendered to a single mp4 by ffmpeg, and downloaded from the workspace.

**Architecture:** Doc gains a `timeline` section (video/voice/music tracks) and a `render` section (status/url). Voiceover + music generate via fal (same job pattern as Phase 2). Render runs as an in-process job: download timeline media to a temp dir, ffmpeg trim/concat video clips, mix voice + music audio, write mp4 to a local `STORAGE_DIR` served by FastAPI. Agent gains `edit_timeline`, `gen_voiceover`, `gen_music`, `render_export` tools reusing the Phase 2 job-request path.

**Tech Stack:** Python 3.12, ffmpeg CLI (subprocess), httpx (asset download), fal TTS + music models, existing locks/jobs/WS layers. Frontend: React 19 in `frontend/src/veroagen/`.

## Global Constraints

- Backend repo `/Users/saman/Documents/personal/veroagen-backend`; viralo changes only under `frontend/src/veroagen/`. Files < 500 lines. `uv run pytest`.
- Every doc mutation via `apply_ops` under `project_lock` (use `mutate_and_broadcast` from jobs.py in all new writers).
- Timeline doc shape: `"timeline": {"video": [Clip], "voice": [AudioClip], "music": [AudioClip]}` where `Clip = {id, shot_id, in_s, out_s, order}` and `AudioClip = {id, asset_url, label, start_s, gain_db}`. `"render": {"status": "none|rendering|ready|failed", "url": null, "error": null}`.
- Render status lifecycle: `none → rendering → ready | failed`. Only one render at a time per project (409 while `rendering`).
- Voice model `fal-ai/kokoro/american-english`, music model `fal-ai/stable-audio-25/text-to-audio` — configurable in `config/media.yml` keys `voice_model`, `music_model`.
- Rendered files written to `settings.storage_dir` (new Settings field, default `./storage`), served at `GET /media/{filename}`; doc `render.url` = `/media/{filename}`.
- ffmpeg + network never invoked in tests: `veroagen.media` fal calls and `veroagen.render` subprocess/download are mocked; one real-ffmpeg smoke test marked `@pytest.mark.ffmpeg` (excluded by default via `-m "not ffmpeg"` addopts).
- Simple cuts only (no transitions) this phase; music loops/trims to video length via ffmpeg `-shortest`.

---

### Task 1: Doc v3 — timeline + render sections, default timeline builder

**Files:**
- Modify: `veroagen/doc.py`
- Test: `tests/test_doc.py` (append)

**Interfaces:**
- Produces:
  - `_SECTION_DEFAULTS` gains `"timeline": {"video": [], "voice": [], "music": []}` and `"render": {"status": "none", "url": None, "error": None}` (so `new_project_doc` and `ensure_doc_shape` include them).
  - New ops:
    - `{"op": "set_timeline", "timeline": {"video": [...], "voice": [...], "music": [...]}}` — replaces whole timeline; missing track keys default to existing values.
    - `{"op": "update_render", "patch": dict}` — merges into `render`.
  - `build_default_timeline(doc: dict) -> dict` — pure helper: one video clip per `video_ready` shot in storyboard order (`{id: f"clip-{shot_id}", shot_id, in_s: 0, out_s: shot.duration_s, order: index}`), empty voice/music. Raises `ValueError` if no `video_ready` shots.

- [ ] **Step 1: Write failing tests** (append to `tests/test_doc.py`)

```python
def test_new_doc_has_timeline_and_render():
    d = new_project_doc("t")
    assert d["timeline"] == {"video": [], "voice": [], "music": []}
    assert d["render"] == {"status": "none", "url": None, "error": None}


def test_set_timeline_partial_tracks():
    d = new_project_doc("t")
    clip = {"id": "clip-x1", "shot_id": "x1", "in_s": 0, "out_s": 4, "order": 0}
    d = apply_ops(d, [{"op": "set_timeline", "timeline": {"video": [clip]}}])
    assert d["timeline"]["video"] == [clip]
    assert d["timeline"]["voice"] == []  # untouched track preserved


def test_update_render():
    d = new_project_doc("t")
    d = apply_ops(d, [{"op": "update_render", "patch": {"status": "rendering"}}])
    assert d["render"]["status"] == "rendering"
    assert d["render"]["url"] is None


def test_build_default_timeline():
    from veroagen.doc import build_default_timeline
    d = new_project_doc("t")
    shots = [
        {"id": "x1", "scene_id": "s1", "prompt": "a", "camera": "", "duration_s": 4,
         "status": "video_ready", "video_url": "http://v1"},
        {"id": "x2", "scene_id": "s1", "prompt": "b", "camera": "", "duration_s": 6,
         "status": "draft"},
        {"id": "x3", "scene_id": "s2", "prompt": "c", "camera": "", "duration_s": 5,
         "status": "video_ready", "video_url": "http://v3"},
    ]
    d = apply_ops(d, [{"op": "set_shots", "shots": shots}])
    tl = build_default_timeline(d)
    assert [c["shot_id"] for c in tl["video"]] == ["x1", "x3"]
    assert tl["video"][0] == {"id": "clip-x1", "shot_id": "x1", "in_s": 0, "out_s": 4, "order": 0}
    assert tl["video"][1]["order"] == 1
    assert tl["voice"] == [] and tl["music"] == []


def test_build_default_timeline_no_ready_shots():
    from veroagen.doc import build_default_timeline
    with pytest.raises(ValueError):
        build_default_timeline(new_project_doc("t"))
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_doc.py -v`

- [ ] **Step 3: Implement** — in `veroagen/doc.py`:

Add to `_SECTION_DEFAULTS`:

```python
    "timeline": {"video": [], "voice": [], "music": []},
    "render": {"status": "none", "url": None, "error": None},
```

Add two branches in `apply_ops` before the `else`:

```python
        elif kind == "set_timeline":
            for track in ("video", "voice", "music"):
                if track in op["timeline"]:
                    d["timeline"][track] = op["timeline"][track]
        elif kind == "update_render":
            d["render"].update(op["patch"])
```

Add at module bottom:

```python
def build_default_timeline(doc: dict) -> dict:
    ready = [s for s in ensure_doc_shape(doc)["storyboard"]["shots"]
             if s.get("status") == "video_ready"]
    if not ready:
        raise ValueError("No video-ready shots to build a timeline from")
    return {
        "video": [
            {"id": f"clip-{s['id']}", "shot_id": s["id"],
             "in_s": 0, "out_s": s.get("duration_s", 5), "order": i}
            for i, s in enumerate(ready)
        ],
        "voice": [],
        "music": [],
    }
```

- [ ] **Step 4: Run full suite, verify PASS** — `uv run pytest -v`
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: doc v3 timeline and render sections with default timeline builder"`

---

### Task 2: media.py — voiceover + music generation

**Files:**
- Modify: `veroagen/media.py`, `config/media.yml`
- Test: `tests/test_media.py` (append)

**Interfaces:**
- Produces:
  - `generate_voiceover(text: str) -> str` — async, returns hosted audio URL. fal arguments `{"prompt": text}`, result shape `{"audio": {"url": ...}}`.
  - `generate_music(prompt: str, seconds: int = 30) -> str` — async, arguments `{"prompt": prompt, "seconds_total": seconds}`, result `{"audio_file": {"url": ...}}`.
  - Both raise `MediaError` on failure/malformed result. Config keys `voice_model`, `music_model`.

- [ ] **Step 1: Extend config** — append to `config/media.yml`:

```yaml
voice_model: fal-ai/kokoro/american-english
music_model: fal-ai/stable-audio-25/text-to-audio
```

- [ ] **Step 2: Write failing tests** (append to `tests/test_media.py`)

```python
async def test_generate_voiceover_returns_url():
    from veroagen.media import generate_voiceover
    result = {"audio": {"url": "https://fal.media/vo.wav"}}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        url = await generate_voiceover("Hello world")
    assert url == "https://fal.media/vo.wav"
    assert sub.call_args.args[0] == "fal-ai/kokoro/american-english"
    assert sub.call_args.kwargs["arguments"]["prompt"] == "Hello world"


async def test_generate_music_returns_url():
    from veroagen.media import generate_music
    result = {"audio_file": {"url": "https://fal.media/m.wav"}}
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value=result)) as sub:
        url = await generate_music("calm piano", seconds=20)
    assert url == "https://fal.media/m.wav"
    assert sub.call_args.kwargs["arguments"] == {"prompt": "calm piano", "seconds_total": 20}


async def test_voiceover_malformed_result_raises():
    from veroagen.media import generate_voiceover
    with patch("veroagen.media.fal_client.subscribe_async",
               new=AsyncMock(return_value={})):
        with pytest.raises(MediaError):
            await generate_voiceover("x")
```

- [ ] **Step 3: Run, verify FAIL**, **Step 4: Implement** — append to `veroagen/media.py`:

```python
async def generate_voiceover(text: str) -> str:
    cfg = load_media_config()
    try:
        result = await fal_client.subscribe_async(cfg["voice_model"],
                                                  arguments={"prompt": text})
        return result["audio"]["url"]
    except MediaError:
        raise
    except KeyError:
        raise MediaError(f"Voice model returned no audio: {result!r}")
    except Exception as e:  # noqa: BLE001
        raise MediaError(f"Voiceover generation failed: {e}") from e


async def generate_music(prompt: str, seconds: int = 30) -> str:
    cfg = load_media_config()
    try:
        result = await fal_client.subscribe_async(
            cfg["music_model"],
            arguments={"prompt": prompt, "seconds_total": seconds})
        return result["audio_file"]["url"]
    except MediaError:
        raise
    except KeyError:
        raise MediaError(f"Music model returned no audio: {result!r}")
    except Exception as e:  # noqa: BLE001
        raise MediaError(f"Music generation failed: {e}") from e
```

- [ ] **Step 5: Run full suite, verify PASS**, **Step 6: Commit** — `git commit -am "feat: voiceover and music generation via fal"`

---

### Task 3: Voice/music jobs + timeline placement

**Files:**
- Modify: `veroagen/jobs.py`
- Test: `tests/test_jobs.py` (append)

**Interfaces:**
- Consumes: `generate_voiceover`, `generate_music` (import into jobs.py), `mutate_and_broadcast`, doc ops from Task 1.
- Produces:
  - `run_gen_voiceover(project_id: str) -> None` — concatenates all scene narrations (`". ".join(narration for scenes with non-empty narration)`); if empty → system message "No narration to voice." and return. Else generate; on success: `add_asset` (kind "voice", model `cfg["voice_model"]`), `set_timeline` replacing the `voice` track with one clip `{"id": "voice-main", "asset_url": url, "label": "Narration", "start_s": 0, "gain_db": 0}`, system message "Voiceover ready." On failure: system message "Voiceover generation failed: {e}".
  - `run_gen_music(project_id: str, prompt: str) -> None` — analogous: music track single clip `{"id": "music-main", "asset_url": url, "label": prompt[:40], "start_s": 0, "gain_db": -12}`, asset kind "music", messages "Music ready." / "Music generation failed: {e}". Catch `Exception` (Phase 2 convention).

- [ ] **Step 1: Write failing tests** (append to `tests/test_jobs.py`; extend `make_project` to accept `scenes`)

Add `scenes` support in `make_project` — change the function body's op-building section to:

```python
    if doc_ops.get("scenes"):
        doc = apply_ops(doc, [{"op": "set_script", "scenes": doc_ops["scenes"]}])
```

(alongside existing shots/characters handling). Then append tests:

```python
async def test_gen_voiceover_success():
    from veroagen.jobs import run_gen_voiceover
    scenes = [{"id": "s1", "title": "A", "narration": "Hello"},
              {"id": "s2", "title": "B", "narration": "World"}]
    pid = await make_project(scenes=scenes)
    gen = AsyncMock(return_value="https://fal.media/vo.wav")
    with patch("veroagen.jobs.generate_voiceover", new=gen), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_voiceover(pid)
    doc = await get_doc(pid)
    assert gen.call_args.args[0] == "Hello. World"
    voice = doc["timeline"]["voice"]
    assert voice == [{"id": "voice-main", "asset_url": "https://fal.media/vo.wav",
                      "label": "Narration", "start_s": 0, "gain_db": 0}]
    assert any(a["kind"] == "voice" for a in doc["assets"]["items"])
    assert "voiceover ready" in doc["chat"]["messages"][-1]["content"].lower()


async def test_gen_voiceover_no_narration():
    from veroagen.jobs import run_gen_voiceover
    pid = await make_project()
    with patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_voiceover(pid)
    doc = await get_doc(pid)
    assert doc["timeline"]["voice"] == []
    assert "no narration" in doc["chat"]["messages"][-1]["content"].lower()


async def test_gen_music_success():
    from veroagen.jobs import run_gen_music
    pid = await make_project()
    with patch("veroagen.jobs.generate_music",
               new=AsyncMock(return_value="https://fal.media/m.wav")), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_music(pid, "calm piano")
    doc = await get_doc(pid)
    music = doc["timeline"]["music"]
    assert music[0]["asset_url"] == "https://fal.media/m.wav"
    assert music[0]["gain_db"] == -12


async def test_gen_music_failure():
    from veroagen.jobs import run_gen_music
    from veroagen.media import MediaError
    pid = await make_project()
    with patch("veroagen.jobs.generate_music", new=AsyncMock(side_effect=MediaError("q"))), \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await run_gen_music(pid, "x")
    doc = await get_doc(pid)
    assert doc["timeline"]["music"] == []
    assert "failed" in doc["chat"]["messages"][-1]["content"].lower()
```

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement** — append to `veroagen/jobs.py` (extend the media import line to include `generate_voiceover, generate_music`):

```python
async def run_gen_voiceover(project_id: str) -> None:
    doc = await _load_doc(project_id)
    narration = ". ".join(
        s["narration"] for s in doc["script"]["scenes"] if s.get("narration", "").strip()
    )
    if not narration:
        await mutate_and_broadcast(project_id, [_system_msg("No narration to voice.")])
        return
    try:
        cfg = load_media_config()
        url = await generate_voiceover(narration)
        clip = {"id": "voice-main", "asset_url": url, "label": "Narration",
                "start_s": 0, "gain_db": 0}
        await mutate_and_broadcast(project_id, [
            {"op": "set_timeline", "timeline": {"voice": [clip]}},
            _asset("voice", url, cfg["voice_model"]),
            _system_msg("Voiceover ready."),
        ])
    except Exception as e:  # noqa: BLE001 — mark failed, never stuck
        await mutate_and_broadcast(project_id, [
            _system_msg(f"Voiceover generation failed: {e}")])


async def run_gen_music(project_id: str, prompt: str) -> None:
    try:
        cfg = load_media_config()
        url = await generate_music(prompt)
        clip = {"id": "music-main", "asset_url": url, "label": prompt[:40],
                "start_s": 0, "gain_db": -12}
        await mutate_and_broadcast(project_id, [
            {"op": "set_timeline", "timeline": {"music": [clip]}},
            _asset("music", url, cfg["music_model"]),
            _system_msg("Music ready."),
        ])
    except Exception as e:  # noqa: BLE001
        await mutate_and_broadcast(project_id, [
            _system_msg(f"Music generation failed: {e}")])
```

(Match `_asset`'s current signature `_asset(kind, url, model, shot_id=None, character_id=None)`.)

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: voiceover and music jobs with timeline placement"`

---

### Task 4: Render engine (ffmpeg)

**Files:**
- Create: `veroagen/render.py`
- Modify: `veroagen/config.py` (add `storage_dir: str = "./storage"`)
- Test: `tests/test_render.py`

**Interfaces:**
- Consumes: doc timeline shape; shots' `video_url`.
- Produces:
  - `render_project(doc: dict, output_path: str) -> None` — async. Steps: resolve each timeline video clip's `shot_id` → shot `video_url` (raise `RenderError` if missing); download every needed URL to a temp dir via `_download(url, dest)`; build and run ffmpeg via `_run_ffmpeg(args: list[str])`; write final mp4 to `output_path`. Raises `RenderError` on any failure.
  - `_download(url: str, dest: str) -> None` — httpx streaming download (patchable).
  - `_run_ffmpeg(args: list[str]) -> None` — `subprocess.run(["ffmpeg", "-y", *args], capture_output=True)`; raise `RenderError(stderr tail)` on nonzero exit (patchable).
  - `build_ffmpeg_args(video_files: list[tuple[str, float, float]], voice_file: str | None, music_file: str | None, output_path: str) -> list[str]` — pure, unit-testable. `video_files` = [(path, in_s, out_s)].
  - ffmpeg strategy (single command): trim each clip with `-ss/-to` inputs, `concat` filter for video+audio-less streams, then `amix` voice (+ music with volume) and `-shortest`:
    - Each video input: `-ss {in_s} -to {out_s} -i {path}`
    - Filter: `[0:v][1:v]...concat=n={N}:v=1:a=0[v]` then audio graph:
      - voice only: `[{N}:a]anull[a]`
      - music only: `[{N}:a]volume=0.25[a]`
      - both: `[{N}:a][{N+1}:a]amix=inputs=2:duration=first[a]` with music input pre-scaled `volume=0.25` via its own label first: `[{N+1}:a]volume=0.25[m];[{N}:a][m]amix=inputs=2:duration=first[a]`
      - neither: no audio map, `-an`
    - Map: `-map "[v]"` (+ `-map "[a]"` if audio), `-c:v libx264 -pix_fmt yuv420p`, `-shortest` when music present, output path.

- [ ] **Step 1: Write failing tests**

`tests/test_render.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from veroagen.doc import apply_ops, new_project_doc
from veroagen.render import RenderError, build_ffmpeg_args, render_project


def make_doc(with_voice=False, with_music=False):
    d = new_project_doc("R")
    shots = [{"id": "x1", "scene_id": "s1", "prompt": "a", "camera": "", "duration_s": 4,
              "status": "video_ready", "video_url": "https://fal.media/v1.mp4"},
             {"id": "x2", "scene_id": "s1", "prompt": "b", "camera": "", "duration_s": 6,
              "status": "video_ready", "video_url": "https://fal.media/v2.mp4"}]
    d = apply_ops(d, [{"op": "set_shots", "shots": shots}])
    timeline = {"video": [
        {"id": "clip-x1", "shot_id": "x1", "in_s": 0, "out_s": 4, "order": 0},
        {"id": "clip-x2", "shot_id": "x2", "in_s": 1, "out_s": 5, "order": 1},
    ]}
    if with_voice:
        timeline["voice"] = [{"id": "voice-main", "asset_url": "https://fal.media/vo.wav",
                              "label": "n", "start_s": 0, "gain_db": 0}]
    if with_music:
        timeline["music"] = [{"id": "music-main", "asset_url": "https://fal.media/m.wav",
                              "label": "m", "start_s": 0, "gain_db": -12}]
    return apply_ops(d, [{"op": "set_timeline", "timeline": timeline}])


def test_build_args_video_only():
    args = build_ffmpeg_args([("/tmp/a.mp4", 0, 4), ("/tmp/b.mp4", 1, 5)],
                             None, None, "/tmp/out.mp4")
    joined = " ".join(args)
    assert "-ss 0 -to 4 -i /tmp/a.mp4" in joined
    assert "concat=n=2:v=1:a=0[v]" in joined
    assert "-an" in args and args[-1] == "/tmp/out.mp4"


def test_build_args_voice_and_music():
    args = build_ffmpeg_args([("/tmp/a.mp4", 0, 4)], "/tmp/vo.wav", "/tmp/m.wav", "/tmp/o.mp4")
    joined = " ".join(args)
    assert "amix=inputs=2:duration=first" in joined
    assert "-shortest" in args


async def test_render_project_orders_clips_and_downloads():
    doc = make_doc(with_voice=True)
    downloaded, ran = [], []
    async def fake_dl(url, dest): downloaded.append(url)
    def fake_ff(args): ran.append(args)
    with patch("veroagen.render._download", new=fake_dl), \
         patch("veroagen.render._run_ffmpeg", new=fake_ff):
        await render_project(doc, "/tmp/out.mp4")
    assert downloaded == ["https://fal.media/v1.mp4", "https://fal.media/v2.mp4",
                          "https://fal.media/vo.wav"]
    assert len(ran) == 1 and ran[0][-1] == "/tmp/out.mp4"


async def test_render_project_missing_video_url():
    doc = make_doc()
    doc["storyboard"]["shots"][0]["video_url"] = None
    with pytest.raises(RenderError):
        with patch("veroagen.render._download", new=AsyncMock()), \
             patch("veroagen.render._run_ffmpeg"):
            await render_project(doc, "/tmp/out.mp4")


async def test_render_project_empty_timeline():
    with pytest.raises(RenderError):
        await render_project(new_project_doc("t"), "/tmp/out.mp4")
```

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement**

Add to `veroagen/config.py` Settings: `storage_dir: str = "./storage"`.

`veroagen/render.py`:

```python
import subprocess
import tempfile
from pathlib import Path

import httpx

from veroagen.doc import ensure_doc_shape


class RenderError(Exception):
    pass


async def _download(url: str, dest: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes():
                        f.write(chunk)
    except Exception as e:  # noqa: BLE001
        raise RenderError(f"Download failed for {url}: {e}") from e


def _run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(["ffmpeg", "-y", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RenderError(f"ffmpeg failed: {proc.stderr[-500:]}")


def build_ffmpeg_args(video_files: list[tuple[str, float, float]],
                      voice_file: str | None, music_file: str | None,
                      output_path: str) -> list[str]:
    args: list[str] = []
    for path, in_s, out_s in video_files:
        args += ["-ss", str(in_s), "-to", str(out_s), "-i", path]
    n = len(video_files)
    audio_inputs = []
    if voice_file:
        args += ["-i", voice_file]
        audio_inputs.append("voice")
    if music_file:
        args += ["-i", music_file]
        audio_inputs.append("music")

    vconcat = "".join(f"[{i}:v]" for i in range(n)) + f"concat=n={n}:v=1:a=0[v]"
    if audio_inputs == ["voice"]:
        fc = f"{vconcat};[{n}:a]anull[a]"
    elif audio_inputs == ["music"]:
        fc = f"{vconcat};[{n}:a]volume=0.25[a]"
    elif audio_inputs == ["voice", "music"]:
        fc = (f"{vconcat};[{n + 1}:a]volume=0.25[m];"
              f"[{n}:a][m]amix=inputs=2:duration=first[a]")
    else:
        fc = vconcat

    args += ["-filter_complex", fc, "-map", "[v]"]
    if audio_inputs:
        args += ["-map", "[a]"]
    else:
        args += ["-an"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if music_file:
        args += ["-shortest"]
    args.append(output_path)
    return args


async def render_project(doc: dict, output_path: str) -> None:
    doc = ensure_doc_shape(doc)
    clips = sorted(doc["timeline"]["video"], key=lambda c: c.get("order", 0))
    if not clips:
        raise RenderError("Timeline has no video clips")
    shots = {s["id"]: s for s in doc["storyboard"]["shots"]}

    with tempfile.TemporaryDirectory() as tmp:
        video_files: list[tuple[str, float, float]] = []
        for i, clip in enumerate(clips):
            shot = shots.get(clip["shot_id"])
            if not shot or not shot.get("video_url"):
                raise RenderError(f"Clip {clip['id']}: shot has no video")
            dest = str(Path(tmp) / f"clip{i}.mp4")
            await _download(shot["video_url"], dest)
            video_files.append((dest, clip.get("in_s", 0), clip.get("out_s", 5)))

        voice_file = music_file = None
        if doc["timeline"]["voice"]:
            voice_file = str(Path(tmp) / "voice.wav")
            await _download(doc["timeline"]["voice"][0]["asset_url"], voice_file)
        if doc["timeline"]["music"]:
            music_file = str(Path(tmp) / "music.wav")
            await _download(doc["timeline"]["music"][0]["asset_url"], music_file)

        _run_ffmpeg(build_ffmpeg_args(video_files, voice_file, music_file, output_path))
```

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: ffmpeg render engine with timeline trim, concat, audio mix"`

---

### Task 5: Render job + REST + media serving + timeline endpoints

**Files:**
- Modify: `veroagen/jobs.py` (render job), `veroagen/main.py` (static media route), `veroagen/routers/edits.py` (PUT timeline), `veroagen/routers/generate.py` (render + voice/music triggers)
- Test: `tests/test_render_api.py`

**Interfaces:**
- Produces:
  - `jobs.run_render(project_id: str) -> None` — sets `render.status="rendering"`; calls `render_project(doc, out_path)` with `out_path = Path(settings.storage_dir) / f"{project_id}.mp4"` (mkdir parents); success → `update_render {status:"ready", url:f"/media/{project_id}.mp4", error:None}` + system message "Render ready — download from the Timeline tab."; failure → `update_render {status:"failed", error:str(e)}` + system message. Catch `Exception`.
  - `GET /media/{filename}` — serves files from `settings.storage_dir` via `FileResponse`; 404 if missing; reject path traversal (`filename` must match `^[A-Za-z0-9_.-]+$`).
  - `PUT /projects/{id}/timeline {timeline} -> {doc}` in edits.py (same `_save_and_broadcast` pattern, op `set_timeline`).
  - In generate.py:
    - `POST /projects/{id}/timeline/default -> {doc}` — builds via `build_default_timeline` (400 if ValueError) and saves.
    - `POST /projects/{id}/voiceover -> {"status":"queued"}` — schedules `run_gen_voiceover`.
    - `POST /projects/{id}/music {prompt} -> {"status":"queued"}` — schedules `run_gen_music`.
    - `POST /projects/{id}/render -> {"status":"queued"}` — 409 if `render.status == "rendering"`; sets `update_render {status:"rendering", error:None}` synchronously via `mutate_and_broadcast`, then schedules `run_render`. 400 if timeline video track empty.

- [ ] **Step 1: Write failing tests**

`tests/test_render_api.py`:

```python
from unittest.mock import AsyncMock, patch

from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}

READY_SHOTS = [{"id": "x1", "scene_id": "s1", "prompt": "p", "camera": "",
                "duration_s": 4, "status": "video_ready",
                "video_url": "https://fal.media/v1.mp4"}]


async def make_ready_project(client):
    r = await client.post("/projects", json={"title": "R"}, headers=H)
    pid = r.json()["id"]
    with patch("veroagen.routers.edits.hub.broadcast", new=AsyncMock()):
        await client.put(f"/projects/{pid}/storyboard", json={"shots": READY_SHOTS}, headers=H)
    return pid


async def test_default_timeline_endpoint(client):
    pid = await make_ready_project(client)
    with patch("veroagen.routers.generate.hub.broadcast", new=AsyncMock()):
        r = await client.post(f"/projects/{pid}/timeline/default", headers=H)
    assert r.status_code == 200
    assert r.json()["doc"]["timeline"]["video"][0]["shot_id"] == "x1"


async def test_default_timeline_400_when_no_ready_shots(client):
    r = await client.post("/projects", json={"title": "E"}, headers=H)
    pid = r.json()["id"]
    r2 = await client.post(f"/projects/{pid}/timeline/default", headers=H)
    assert r2.status_code == 400


async def test_put_timeline(client):
    pid = await make_ready_project(client)
    tl = {"video": [{"id": "clip-x1", "shot_id": "x1", "in_s": 0, "out_s": 3, "order": 0}]}
    with patch("veroagen.routers.edits.hub.broadcast", new=AsyncMock()):
        r = await client.put(f"/projects/{pid}/timeline", json={"timeline": tl}, headers=H)
    assert r.json()["doc"]["timeline"]["video"][0]["out_s"] == 3


async def test_render_endpoint_queues_and_409_while_rendering(client):
    pid = await make_ready_project(client)
    with patch("veroagen.routers.generate.hub.broadcast", new=AsyncMock()):
        await client.post(f"/projects/{pid}/timeline/default", headers=H)
    with patch("veroagen.routers.generate.schedule") as sched, \
         patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        r = await client.post(f"/projects/{pid}/render", headers=H)
        assert r.status_code == 200 and r.json() == {"status": "queued"}
        sched.call_args.args[0].close()
        r2 = await client.post(f"/projects/{pid}/render", headers=H)
        assert r2.status_code == 409


async def test_render_endpoint_400_empty_timeline(client):
    pid = await make_ready_project(client)
    r = await client.post(f"/projects/{pid}/render", headers=H)
    assert r.status_code == 400


async def test_voiceover_and_music_endpoints_queue(client):
    pid = await make_ready_project(client)
    with patch("veroagen.routers.generate.schedule") as sched:
        r1 = await client.post(f"/projects/{pid}/voiceover", headers=H)
        sched.call_args.args[0].close()
        r2 = await client.post(f"/projects/{pid}/music", json={"prompt": "piano"}, headers=H)
        sched.call_args.args[0].close()
    assert r1.status_code == 200 and r2.status_code == 200
    assert sched.call_count == 2


async def test_media_serving(client, tmp_path):
    from veroagen.config import settings
    with patch.object(settings, "storage_dir", str(tmp_path)):
        (tmp_path / "demo.mp4").write_bytes(b"vid")
        r = await client.get("/media/demo.mp4")
        assert r.status_code == 200 and r.content == b"vid"
        r2 = await client.get("/media/missing.mp4")
        assert r2.status_code == 404
        r3 = await client.get("/media/..%2Fsecret")
        assert r3.status_code in (400, 404)


async def test_run_render_job_success(tmp_path):
    from veroagen.config import settings
    from veroagen.jobs import run_render
    from tests.test_jobs import make_project, get_doc
    pid = await make_project(shots=[dict(READY_SHOTS[0])])
    from veroagen.jobs import mutate_and_broadcast
    with patch("veroagen.jobs.hub.broadcast", new=AsyncMock()):
        await mutate_and_broadcast(pid, [{"op": "set_timeline", "timeline": {
            "video": [{"id": "clip-x1", "shot_id": "x1", "in_s": 0, "out_s": 4, "order": 0}]}}])
        with patch.object(settings, "storage_dir", str(tmp_path)), \
             patch("veroagen.jobs.render_project", new=AsyncMock()) as rp:
            await run_render(pid)
    doc = await get_doc(pid)
    assert doc["render"]["status"] == "ready"
    assert doc["render"]["url"] == f"/media/{pid}.mp4"
    rp.assert_awaited_once()


async def test_run_render_job_failure(tmp_path):
    from veroagen.config import settings
    from veroagen.jobs import run_render
    from veroagen.render import RenderError
    from tests.test_jobs import make_project, get_doc
    pid = await make_project(shots=[dict(READY_SHOTS[0])])
    with patch("veroagen.jobs.hub.broadcast", new=AsyncMock()), \
         patch.object(settings, "storage_dir", str(tmp_path)), \
         patch("veroagen.jobs.render_project", new=AsyncMock(side_effect=RenderError("boom"))):
        await run_render(pid)
    doc = await get_doc(pid)
    assert doc["render"]["status"] == "failed"
    assert "boom" in doc["render"]["error"]
```

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement**

`veroagen/jobs.py` — add imports `from veroagen.config import settings`, `from veroagen.render import render_project`, `from pathlib import Path`, and:

```python
async def run_render(project_id: str) -> None:
    doc = await _load_doc(project_id)
    try:
        out_dir = Path(settings.storage_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{project_id}.mp4"
        await render_project(doc, str(out_path))
        await mutate_and_broadcast(project_id, [
            {"op": "update_render",
             "patch": {"status": "ready", "url": f"/media/{project_id}.mp4", "error": None}},
            _system_msg("Render ready — download from the Timeline tab."),
        ])
    except Exception as e:  # noqa: BLE001
        await mutate_and_broadcast(project_id, [
            {"op": "update_render", "patch": {"status": "failed", "error": str(e)}},
            _system_msg(f"Render failed: {e}"),
        ])
```

`veroagen/main.py` — add:

```python
import re
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from veroagen.config import settings


@app.get("/media/{filename}")
async def serve_media(filename: str):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = Path(settings.storage_dir) / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)
```

`veroagen/routers/edits.py` — add:

```python
class TimelineIn(BaseModel):
    timeline: dict


@router.put("/{project_id}/timeline")
async def put_timeline(
    body: TimelineIn,
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    return await _save_and_broadcast(proj, session,
                                     [{"op": "set_timeline", "timeline": body.timeline}])
```

`veroagen/routers/generate.py` — add imports (`build_default_timeline` from doc, `run_gen_voiceover, run_gen_music, run_render, mutate_and_broadcast` from jobs, `ensure_doc_shape` already imported) and endpoints:

```python
class MusicIn(BaseModel):
    prompt: str


@router.post("/{project_id}/timeline/default")
async def default_timeline(
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    try:
        timeline = build_default_timeline(proj.doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    doc = await mutate_and_broadcast(proj.id, [{"op": "set_timeline", "timeline": timeline}])
    return {"doc": doc}


@router.post("/{project_id}/voiceover")
async def queue_voiceover(proj: Project = Depends(get_owned_project)):
    schedule(run_gen_voiceover(proj.id))
    return {"status": "queued"}


@router.post("/{project_id}/music")
async def queue_music(body: MusicIn, proj: Project = Depends(get_owned_project)):
    schedule(run_gen_music(proj.id, body.prompt))
    return {"status": "queued"}


@router.post("/{project_id}/render")
async def queue_render(proj: Project = Depends(get_owned_project)):
    doc = ensure_doc_shape(proj.doc)
    if doc["render"]["status"] == "rendering":
        raise HTTPException(status_code=409, detail="Render already in progress")
    if not doc["timeline"]["video"]:
        raise HTTPException(status_code=400, detail="Timeline is empty — build it first")
    await mutate_and_broadcast(proj.id, [
        {"op": "update_render", "patch": {"status": "rendering", "error": None}}])
    schedule(run_render(proj.id))
    return {"status": "queued"}
```

Note: `default_timeline` uses `mutate_and_broadcast` (locked) rather than direct session write — consistent with the concurrency fix.

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: render job, timeline endpoints, media serving"`

---

### Task 6: Agent tools v3 — timeline, audio, render

**Files:**
- Modify: `veroagen/agent.py`, `veroagen/routers/chat.py`
- Test: `tests/test_agent.py` (append)

**Interfaces:**
- Produces:
  - New TOOLS: `build_timeline {}` (doc-mutating: build_default_timeline → set_timeline; tool error if no ready shots), `edit_timeline {video: [clips]}` (doc-mutating: set_timeline video track), `gen_voiceover {}`, `gen_music {prompt}`, `render_export {}` (job tools → job requests `{"job": ..., "project_scope_id": ""}`; for gen_music, request also carries `"prompt"`).
  - `_JOB_TOOLS` gains `gen_voiceover: None`, `render_export: None`, `gen_music: None` — these take no id; emit `project_scope_id: ""`. Chat router `_JOB_RUNNERS` gains `"gen_voiceover": run_gen_voiceover`, `"render": run_render` — scheduling call adapts: voiceover/render called `runner(proj.id)`; music called `runner(proj.id, req["prompt"])`; shot/character jobs keep `runner(proj.id, req["project_scope_id"])`.
  - SYSTEM_PROMPT extended: after video shots ready → build_timeline → gen_voiceover / gen_music → render_export.

- [ ] **Step 1: Write failing tests** (append to `tests/test_agent.py`)

```python
def test_build_timeline_tool():
    d = new_project_doc("t")
    d = apply_ops(d, [{"op": "set_shots", "shots": [
        {"id": "x1", "scene_id": "s1", "prompt": "p", "camera": "", "duration_s": 4,
         "status": "video_ready", "video_url": "http://v"}]}])
    llm = stub_llm_factory([
        tool_call("build_timeline", {}),
        {"role": "assistant", "content": "Timeline built.", "tool_calls": None},
    ])
    doc, _, jobs = run_turn(d, "build timeline", llm=llm)
    assert doc["timeline"]["video"][0]["shot_id"] == "x1"
    assert jobs == []


def test_audio_and_render_tools_emit_jobs():
    llm = stub_llm_factory([
        {"role": "assistant", "content": None, "tool_calls": [
            tool_call("gen_voiceover", {})["tool_calls"][0] | {"id": "c1"},
            tool_call("gen_music", {"prompt": "calm piano"})["tool_calls"][0] | {"id": "c2"},
            tool_call("render_export", {})["tool_calls"][0] | {"id": "c3"},
        ]},
        {"role": "assistant", "content": "All queued.", "tool_calls": None},
    ])
    doc, _, jobs = run_turn(new_project_doc("t"), "finish it", llm=llm)
    assert {"job": "gen_voiceover", "project_scope_id": ""} in jobs
    assert {"job": "gen_music", "project_scope_id": "", "prompt": "calm piano"} in jobs
    assert {"job": "render_export", "project_scope_id": ""} in jobs


def test_edit_timeline_tool():
    d = new_project_doc("t")
    clip = {"id": "clip-x1", "shot_id": "x1", "in_s": 0, "out_s": 3, "order": 0}
    llm = stub_llm_factory([
        tool_call("edit_timeline", {"video": [clip]}),
        {"role": "assistant", "content": "Trimmed.", "tool_calls": None},
    ])
    doc, _, _ = run_turn(d, "trim", llm=llm)
    assert doc["timeline"]["video"] == [clip]
```

- [ ] **Step 2: Run, verify FAIL**, **Step 3: Implement**

`veroagen/agent.py` — add import `from veroagen.doc import apply_ops, build_default_timeline`; append TOOLS entries:

```python
    {"type": "function", "function": {
        "name": "build_timeline",
        "description": "Build the default timeline from all video-ready shots, in storyboard order.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "edit_timeline",
        "description": "Replace the timeline's video clip list (reorder/trim). Clips: {id, shot_id, in_s, out_s, order}.",
        "parameters": {"type": "object", "properties": {
            "video": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "string"}, "shot_id": {"type": "string"},
                "in_s": {"type": "number"}, "out_s": {"type": "number"},
                "order": {"type": "integer"}},
                "required": ["id", "shot_id", "in_s", "out_s", "order"]}}},
            "required": ["video"]}}},
    {"type": "function", "function": {
        "name": "gen_voiceover",
        "description": "Generate the narration voiceover from the script (async job).",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "gen_music",
        "description": "Generate background music from a prompt (async job).",
        "parameters": {"type": "object", "properties": {
            "prompt": {"type": "string"}}, "required": ["prompt"]}}},
    {"type": "function", "function": {
        "name": "render_export",
        "description": "Render the timeline to the final mp4 (async job). Needs a non-empty timeline.",
        "parameters": {"type": "object", "properties": {}}}},
```

Update `_JOB_TOOLS` and `_execute_tool`:

```python
_JOB_TOOLS = {
    "gen_character_ref": "character_id",
    "gen_shot_image": "shot_id",
    "gen_shot_video": "shot_id",
    "gen_voiceover": None,
    "gen_music": None,
    "render_export": None,
}
```

In `_execute_tool`, replace the job-tool branch:

```python
    if name in _JOB_TOOLS:
        id_key = _JOB_TOOLS[name]
        req = {"job": name, "project_scope_id": args[id_key] if id_key else ""}
        if name == "gen_music":
            req["prompt"] = args["prompt"]
        return doc, req
```

Add doc-mutating branches:

```python
    if name == "build_timeline":
        timeline = build_default_timeline(doc)  # ValueError → caught by loop, LLM recovers
        return apply_ops(doc, [{"op": "set_timeline", "timeline": timeline}]), None
    if name == "edit_timeline":
        return apply_ops(doc, [{"op": "set_timeline", "timeline": {"video": args["video"]}}]), None
```

SYSTEM_PROMPT — replace the Workflow line with:

```
Workflow: script → characters (set_characters, then gen_character_ref for each) →
storyboard → gen_shot_image per shot → gen_shot_video once the image is ready →
build_timeline → gen_voiceover and gen_music → render_export for the final mp4.
```

`veroagen/routers/chat.py` — update `_JOB_RUNNERS` and scheduling loop:

```python
_JOB_RUNNERS = {
    "gen_character_ref": run_gen_character_ref,
    "gen_shot_image": run_gen_shot_image,
    "gen_shot_video": run_gen_shot_video,
    "gen_voiceover": run_gen_voiceover,
    "gen_music": run_gen_music,
    "render_export": run_render,
}
```

```python
    for req in job_requests:
        runner = _JOB_RUNNERS.get(req["job"])
        if runner is None:
            continue
        if req["job"] == "gen_music":
            schedule(runner(proj.id, req.get("prompt", "")))
        elif req["job"] in ("gen_voiceover", "render_export"):
            schedule(runner(proj.id))
        else:
            schedule(runner(proj.id, req["project_scope_id"]))
```

(extend the jobs import line with `run_gen_voiceover, run_gen_music, run_render`.)

- [ ] **Step 4: Run full suite, verify PASS**, **Step 5: Commit** — `git commit -am "feat: agent timeline, audio, and render tools"`

---

### Task 7: Frontend — Timeline tab

**Files (viralo repo, only `frontend/src/veroagen/`):**
- Modify: `frontend/src/veroagen/types.ts`, `frontend/src/veroagen/api.ts`, `frontend/src/veroagen/WorkspacePage.tsx`
- Create: `frontend/src/veroagen/TimelineView.tsx`

**Interfaces:**
- Consumes: Task 5 endpoints; doc timeline/render shape.
- Produces: Timeline tab — build-default button, clip list with ↑/↓ reorder + in/out trim inputs, voiceover/music buttons, render button + status + download link.

- [ ] **Step 1: Types** — append to `frontend/src/veroagen/types.ts`:

```ts
export interface TimelineClip {
  id: string; shot_id: string; in_s: number; out_s: number; order: number;
}
export interface AudioClip {
  id: string; asset_url: string; label: string; start_s: number; gain_db: number;
}
export interface Timeline { video: TimelineClip[]; voice: AudioClip[]; music: AudioClip[] }
export interface RenderState {
  status: "none" | "rendering" | "ready" | "failed";
  url: string | null; error: string | null;
}
```

and extend `ProjectDoc` with `timeline: Timeline; render: RenderState;`.

- [ ] **Step 2: API methods** — append to `veroagenApi` in `frontend/src/veroagen/api.ts`:

```ts
  putTimeline: (id: string, timeline: { video: TimelineClip[] }) =>
    req<{ doc: ProjectDoc }>("PUT", `/projects/${id}/timeline`, { timeline }),
  buildDefaultTimeline: (id: string) =>
    req<{ doc: ProjectDoc }>("POST", `/projects/${id}/timeline/default`),
  queueVoiceover: (id: string) =>
    req<{ status: string }>("POST", `/projects/${id}/voiceover`),
  queueMusic: (id: string, prompt: string) =>
    req<{ status: string }>("POST", `/projects/${id}/music`, { prompt }),
  queueRender: (id: string) =>
    req<{ status: string }>("POST", `/projects/${id}/render`),
  mediaUrl: (path: string) => `${BASE}${path}`,
```

(import `TimelineClip` type; `BASE` already module-scoped.)

- [ ] **Step 3: TimelineView**

`frontend/src/veroagen/TimelineView.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { RenderState, Timeline, TimelineClip } from "./types";

export function TimelineView({
  timeline, render, onBuildDefault, onSave, onVoiceover, onMusic, onRender, mediaUrl,
}: {
  timeline: Timeline;
  render: RenderState;
  onBuildDefault: () => void;
  onSave: (video: TimelineClip[]) => void;
  onVoiceover: () => void;
  onMusic: (prompt: string) => void;
  onRender: () => void;
  mediaUrl: (path: string) => string;
}) {
  const [clips, setClips] = useState(timeline.video);
  const [musicPrompt, setMusicPrompt] = useState("");
  useEffect(() => setClips(timeline.video), [timeline.video]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= clips.length) return;
    const next = [...clips];
    [next[i], next[j]] = [next[j], next[i]];
    setClips(next.map((c, idx) => ({ ...c, order: idx })));
  };
  const trim = (i: number, patch: Partial<TimelineClip>) =>
    setClips(clips.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={onBuildDefault} className="rounded-md border px-3 py-1.5 text-sm">
          Build from ready shots
        </button>
        <button onClick={() => onSave(clips)} disabled={!clips.length}
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">
          Save timeline
        </button>
        <button onClick={onVoiceover} className="rounded-md border px-3 py-1.5 text-sm">
          Generate voiceover
        </button>
        <input value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)}
               placeholder="Music prompt…"
               className="w-44 rounded-md border bg-background px-3 py-1.5 text-sm" />
        <button onClick={() => musicPrompt.trim() && onMusic(musicPrompt.trim())}
                className="rounded-md border px-3 py-1.5 text-sm">
          Generate music
        </button>
        <button onClick={onRender} disabled={render.status === "rendering" || !clips.length}
                className="rounded-md bg-[#ff3d6a] px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {render.status === "rendering" ? "Rendering…" : "Render mp4"}
        </button>
      </div>

      {render.status === "ready" && render.url && (
        <a href={mediaUrl(render.url)} download
           className="inline-block rounded-md border border-green-600 px-3 py-1.5 text-sm text-green-600">
          Download final video
        </a>
      )}
      {render.status === "failed" && (
        <p className="text-sm text-red-500">Render failed: {render.error}</p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Video track</h3>
        {clips.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <span className="w-20 truncate text-xs text-muted-foreground">{c.shot_id}</span>
            <label className="text-xs">in</label>
            <input type="number" min={0} step={0.5} value={c.in_s}
                   onChange={(e) => trim(i, { in_s: Number(e.target.value) })}
                   className="w-16 rounded border bg-background px-1 py-0.5 text-xs" />
            <label className="text-xs">out</label>
            <input type="number" min={0} step={0.5} value={c.out_s}
                   onChange={(e) => trim(i, { out_s: Number(e.target.value) })}
                   className="w-16 rounded border bg-background px-1 py-0.5 text-xs" />
            <div className="ml-auto flex gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                      className="rounded border px-2 text-xs disabled:opacity-30">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === clips.length - 1}
                      className="rounded border px-2 text-xs disabled:opacity-30">↓</button>
            </div>
          </div>
        ))}
        {!clips.length && (
          <p className="text-sm text-muted-foreground">
            No clips — generate shot videos, then build the timeline.
          </p>
        )}
      </div>

      {(timeline.voice.length > 0 || timeline.music.length > 0) && (
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold">Audio</h3>
          {timeline.voice.map((a) => <p key={a.id} className="text-xs text-muted-foreground">🎙 {a.label}</p>)}
          {timeline.music.map((a) => <p key={a.id} className="text-xs text-muted-foreground">🎵 {a.label}</p>)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire tab** — in `frontend/src/veroagen/WorkspacePage.tsx`: add `"Timeline"` to `TABS`, import TimelineView + api types, and render:

```tsx
            {tab === "Timeline" && (
              <TimelineView
                timeline={doc.timeline ?? { video: [], voice: [], music: [] }}
                render={doc.render ?? { status: "none", url: null, error: null }}
                onBuildDefault={async () => setDoc((await veroagenApi.buildDefaultTimeline(projectId)).doc)}
                onSave={async (video) => setDoc((await veroagenApi.putTimeline(projectId, { video })).doc)}
                onVoiceover={() => void veroagenApi.queueVoiceover(projectId)}
                onMusic={(p) => void veroagenApi.queueMusic(projectId, p)}
                onRender={() => void veroagenApi.queueRender(projectId)}
                mediaUrl={veroagenApi.mediaUrl}
              />
            )}
```

- [ ] **Step 5: Verify build** — `cd /Users/saman/Documents/personal/viralo/frontend && npm run build`
- [ ] **Step 6: Commit (only veroagen files)** — `git add frontend/src/veroagen && git commit -m "feat(veroagen): timeline tab with reorder, trim, audio, render and download"`

---

### Task 8: Real-ffmpeg smoke + docs

**Files:**
- Modify: `pyproject.toml` (pytest markers + addopts), `README.md`, `tests/test_render.py` (append)

**Interfaces:** verification only.

- [ ] **Step 1: Marker config** — in `pyproject.toml` `[tool.pytest.ini_options]` add:

```toml
markers = ["ffmpeg: requires real ffmpeg binary (excluded by default)"]
addopts = "-m 'not ffmpeg'"
```

- [ ] **Step 2: Real smoke test** (append to `tests/test_render.py`)

```python
import shutil


@pytest.mark.ffmpeg
async def test_real_ffmpeg_render(tmp_path):
    """Generates two tiny test clips with ffmpeg, renders them through the real engine."""
    assert shutil.which("ffmpeg"), "ffmpeg not installed"
    from veroagen.render import _run_ffmpeg

    a, b = str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")
    for path, color in ((a, "red"), (b, "blue")):
        _run_ffmpeg(["-f", "lavfi", "-i", f"color=c={color}:s=64x64:d=1",
                     "-c:v", "libx264", "-pix_fmt", "yuv420p", path])

    doc = make_doc()
    out = str(tmp_path / "out.mp4")

    async def local_dl(url, dest):
        src = a if "v1" in url else b
        shutil.copy(src, dest)

    with patch("veroagen.render._download", new=local_dl):
        await render_project(doc, out)
    assert (tmp_path / "out.mp4").stat().st_size > 0
```

Note: `make_doc()` clips use `in_s/out_s` beyond the 1s test clips — ffmpeg `-to` past EOF is fine (clip just ends early).

- [ ] **Step 3: Run both ways**

```bash
uv run pytest -v                 # smoke excluded, all pass
uv run pytest -m ffmpeg -v      # real render (requires ffmpeg installed)
```

If the machine lacks ffmpeg, the marked test is allowed to be skipped manually — document result in report.

- [ ] **Step 4: README** — append:

```markdown
## Phase 3 — Timeline & Export

Requires `ffmpeg` on PATH for rendering. Rendered mp4s land in `STORAGE_DIR`
(default `./storage`) and are served at `/media/{project_id}.mp4`.
Voiceover/music models configured in `config/media.yml`.
Real-render smoke test: `uv run pytest -m ffmpeg`.
```

- [ ] **Step 5: Full suite + commit** — `uv run pytest -v` then `git add -A && git commit -m "test: real ffmpeg smoke, phase 3 docs"`
