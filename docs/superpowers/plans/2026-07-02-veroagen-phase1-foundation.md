# Veroagen Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working conversational video-planning agent: chat with an LLM agent that writes/edits a script and storyboard in a shared Project doc, streamed live to a Flova-style split UI. No media generation yet.

**Architecture:** New standalone FastAPI backend (`veroagen-backend`) owning a JSON Project doc per project (Postgres). Agent = LLM tool-calling loop mutating the doc via typed tools; every mutation broadcast over WebSocket. Frontend = new section inside the existing viralo repo (`frontend/src/veroagen/`), reusing viralo auth (validates viralo HS256 JWTs with the same secret).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Postgres (SQLite+aiosqlite in tests), python-jose, openai SDK (OpenAI-compatible providers: groq/openrouter/azure/openai; anthropic SDK for Claude), pytest + httpx. Frontend: React 19, Vite, Tailwind, existing viralo `lib/api.ts` patterns.

## Global Constraints

- Backend repo location: `/Users/saman/Documents/personal/veroagen-backend` (new git repo).
- Viralo backend code must NOT be modified. Frontend changes only add files + minimal route wiring in `frontend/src/App.tsx`.
- JWT validation must match viralo: HS256, secret from env `SECRET_KEY`, access payload `{sub, tenant_id, email, plan, type:"access", exp}` (see viralo `shared/shared/auth.py`).
- All backend files < 500 lines.
- Python deps managed with `uv`; run tests via `uv run pytest`.
- The Project doc is the single source of truth; every mutation goes through `apply_ops` and is broadcast on the project's WebSocket channel.
- LLM access is OpenAI-compatible `chat.completions` with `tools`; provider order configurable in `config/llm.yml` (groq → openrouter → azure-openai → openai → anthropic).

---

### Task 1: Backend scaffold + health endpoint

**Files:**
- Create: `pyproject.toml`, `veroagen/__init__.py`, `veroagen/config.py`, `veroagen/main.py`
- Test: `tests/test_health.py`, `tests/conftest.py`

**Interfaces:**
- Produces: `veroagen.main.app` (FastAPI instance), `veroagen.config.settings` (`Settings` with `secret_key: str`, `database_url: str`, `cors_origins: list[str]`).

- [ ] **Step 1: Scaffold repo**

```bash
mkdir -p /Users/saman/Documents/personal/veroagen-backend/{veroagen,tests,config}
cd /Users/saman/Documents/personal/veroagen-backend && git init
```

`pyproject.toml`:

```toml
[project]
name = "veroagen"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.29",
    "aiosqlite>=0.20",
    "python-jose[cryptography]>=3.3",
    "pydantic-settings>=2.4",
    "openai>=1.50",
    "anthropic>=0.40",
    "pyyaml>=6.0",
    "websockets>=13.0",
]

[dependency-groups]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "httpx>=0.27"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: Write failing test**

`tests/conftest.py`:

```python
import os

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import pytest
from httpx import ASGITransport, AsyncClient

from veroagen.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

`tests/test_health.py`:

```python
async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 3: Run test, verify failure**

Run: `uv run pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: veroagen.main`

- [ ] **Step 4: Implement**

`veroagen/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str
    database_url: str = "postgresql+asyncpg://localhost/veroagen"
    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = {"env_file": ".env"}


settings = Settings()
```

`veroagen/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from veroagen.config import settings

app = FastAPI(title="Veroagen")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run test, verify pass**

Run: `uv run pytest tests/test_health.py -v` — Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: scaffold veroagen backend with health endpoint"
```

---

### Task 2: Viralo JWT auth bridge

**Files:**
- Create: `veroagen/auth.py`
- Test: `tests/test_auth.py`

**Interfaces:**
- Produces: `veroagen.auth.get_current_user` FastAPI dependency → `AuthUser(user_id: str, tenant_id: str, email: str, plan: str)`; `veroagen.auth.decode_access_token(token: str) -> AuthUser` (raises `HTTPException(401)`).
- Consumes: `settings.secret_key` (must equal viralo `SECRET_KEY`).

- [ ] **Step 1: Write failing test**

`tests/test_auth.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import jwt

from veroagen.auth import decode_access_token


def make_token(secret="test-secret", **over):
    payload = {
        "sub": "u1", "tenant_id": "t1", "email": "a@b.c", "plan": "free",
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        **over,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_valid_token():
    u = decode_access_token(make_token())
    assert u.user_id == "u1" and u.tenant_id == "t1" and u.plan == "free"


def test_wrong_secret_rejected():
    with pytest.raises(HTTPException):
        decode_access_token(make_token(secret="wrong"))


def test_refresh_token_rejected():
    with pytest.raises(HTTPException):
        decode_access_token(make_token(type="refresh"))


def test_expired_rejected():
    with pytest.raises(HTTPException):
        decode_access_token(make_token(exp=datetime.now(timezone.utc) - timedelta(minutes=1)))
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_auth.py -v` → `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`veroagen/auth.py`:

```python
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from veroagen.config import settings

ALGORITHM = "HS256"  # matches viralo shared/shared/auth.py
_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthUser:
    user_id: str
    tenant_id: str
    email: str
    plan: str


def decode_access_token(token: str) -> AuthUser:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return AuthUser(
        user_id=payload["sub"],
        tenant_id=payload.get("tenant_id", ""),
        email=payload.get("email", ""),
        plan=payload.get("plan", "free"),
    )


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthUser:
    if creds is None:
        raise HTTPException(status_code=401, detail="Missing token")
    return decode_access_token(creds.credentials)
```

- [ ] **Step 4: Run, verify PASS** — `uv run pytest tests/test_auth.py -v`

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: viralo JWT auth bridge"`

---

### Task 3: Project doc model + mutation ops

**Files:**
- Create: `veroagen/doc.py`
- Test: `tests/test_doc.py`

**Interfaces:**
- Produces:
  - `new_project_doc(title: str) -> dict` — returns `{"title", "script": {"scenes": []}, "storyboard": {"shots": []}, "chat": {"messages": []}, "version": 0}`
  - `apply_ops(doc: dict, ops: list[dict]) -> dict` — pure function, returns new doc with `version` incremented by 1 per call. Op shapes:
    - `{"op": "set_script", "scenes": [{"id", "title", "narration"}]}`
    - `{"op": "set_shots", "shots": [{"id", "scene_id", "prompt", "camera", "duration_s", "status"}]}`
    - `{"op": "append_message", "message": {"role", "content"}}`
  - Raises `ValueError` on unknown op.

- [ ] **Step 1: Write failing test**

`tests/test_doc.py`:

```python
import pytest

from veroagen.doc import apply_ops, new_project_doc


def test_new_doc_shape():
    d = new_project_doc("My video")
    assert d["title"] == "My video"
    assert d["script"] == {"scenes": []}
    assert d["storyboard"] == {"shots": []}
    assert d["chat"] == {"messages": []}
    assert d["version"] == 0


def test_set_script_and_version():
    d = new_project_doc("t")
    scenes = [{"id": "s1", "title": "Intro", "narration": "Hello"}]
    d2 = apply_ops(d, [{"op": "set_script", "scenes": scenes}])
    assert d2["script"]["scenes"] == scenes
    assert d2["version"] == 1
    assert d["version"] == 0  # pure — original untouched


def test_append_message():
    d = new_project_doc("t")
    d2 = apply_ops(d, [{"op": "append_message", "message": {"role": "user", "content": "hi"}}])
    assert d2["chat"]["messages"] == [{"role": "user", "content": "hi"}]


def test_unknown_op():
    with pytest.raises(ValueError):
        apply_ops(new_project_doc("t"), [{"op": "nope"}])
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_doc.py -v`

- [ ] **Step 3: Implement**

`veroagen/doc.py`:

```python
import copy


def new_project_doc(title: str) -> dict:
    return {
        "title": title,
        "script": {"scenes": []},
        "storyboard": {"shots": []},
        "chat": {"messages": []},
        "version": 0,
    }


def apply_ops(doc: dict, ops: list[dict]) -> dict:
    d = copy.deepcopy(doc)
    for op in ops:
        kind = op.get("op")
        if kind == "set_script":
            d["script"]["scenes"] = op["scenes"]
        elif kind == "set_shots":
            d["storyboard"]["shots"] = op["shots"]
        elif kind == "append_message":
            d["chat"]["messages"].append(op["message"])
        else:
            raise ValueError(f"Unknown op: {kind}")
    d["version"] += 1
    return d
```

- [ ] **Step 4: Run, verify PASS**, **Step 5: Commit** — `git commit -am "feat: project doc model and mutation ops"`

---

### Task 4: Persistence + project REST endpoints

**Files:**
- Create: `veroagen/db.py`, `veroagen/routers/projects.py`
- Modify: `veroagen/main.py` (include router, init tables on startup)
- Test: `tests/test_projects_api.py`

**Interfaces:**
- Produces:
  - `veroagen.db.Project` SQLAlchemy model: `id (uuid str pk)`, `user_id (str, indexed)`, `doc (JSON)`, `created_at`.
  - `veroagen.db.get_session` dependency; `veroagen.db.init_db()`.
  - REST: `POST /projects {title} -> {id, doc}`, `GET /projects -> [{id, title, version}]`, `GET /projects/{id} -> {id, doc}` (404 if other user's).
- Consumes: `get_current_user`, `new_project_doc`.

- [ ] **Step 1: Write failing test**

`tests/test_projects_api.py`:

```python
import pytest

from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}


async def test_create_and_get_project(client):
    r = await client.post("/projects", json={"title": "Demo"}, headers=H)
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["doc"]["title"] == "Demo"

    r2 = await client.get(f"/projects/{pid}", headers=H)
    assert r2.status_code == 200
    assert r2.json()["doc"]["version"] == 0

    r3 = await client.get("/projects", headers=H)
    assert any(p["id"] == pid for p in r3.json())


async def test_other_user_forbidden(client):
    r = await client.post("/projects", json={"title": "Mine"}, headers=H)
    pid = r.json()["id"]
    other = {"Authorization": f"Bearer {make_token(sub='u2')}"}
    r2 = await client.get(f"/projects/{pid}", headers=other)
    assert r2.status_code == 404


async def test_unauthenticated(client):
    r = await client.get("/projects")
    assert r.status_code == 401
```

Also update `tests/conftest.py` client fixture to init DB:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from veroagen.db import init_db
from veroagen.main import app


@pytest.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_projects_api.py -v`

- [ ] **Step 3: Implement**

`veroagen/db.py`:

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from veroagen.config import settings


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    doc: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
```

`veroagen/routers/projects.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.auth import AuthUser, get_current_user
from veroagen.db import Project, get_session
from veroagen.doc import new_project_doc

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateProject(BaseModel):
    title: str


async def get_owned_project(
    project_id: str,
    user: AuthUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Project:
    proj = await session.get(Project, project_id)
    if proj is None or proj.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@router.post("", status_code=201)
async def create_project(
    body: CreateProject,
    user: AuthUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    proj = Project(user_id=user.user_id, doc=new_project_doc(body.title))
    session.add(proj)
    await session.commit()
    return {"id": proj.id, "doc": proj.doc}


@router.get("")
async def list_projects(
    user: AuthUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(select(Project).where(Project.user_id == user.user_id))).scalars()
    return [{"id": p.id, "title": p.doc["title"], "version": p.doc["version"]} for p in rows]


@router.get("/{project_id}")
async def get_project(proj: Project = Depends(get_owned_project)):
    return {"id": proj.id, "doc": proj.doc}
```

In `veroagen/main.py` add:

```python
from veroagen.db import init_db
from veroagen.routers.projects import router as projects_router

app.include_router(projects_router)


@app.on_event("startup")
async def _startup():
    await init_db()
```

- [ ] **Step 4: Run full suite, verify PASS** — `uv run pytest -v`
- [ ] **Step 5: Commit** — `git commit -am "feat: project persistence and REST endpoints"`

---

### Task 5: WebSocket doc sync

**Files:**
- Create: `veroagen/ws.py`
- Modify: `veroagen/main.py` (mount ws route)
- Test: `tests/test_ws.py`

**Interfaces:**
- Produces:
  - `veroagen.ws.hub` — singleton `Hub` with `async broadcast(project_id: str, event: dict)`, `subscribe(project_id) -> asyncio.Queue`, `unsubscribe(project_id, queue)`.
  - WS endpoint `GET /ws/projects/{project_id}?token=<jwt>` — sends `{"type": "doc", "doc": {...}}` on connect, then every broadcast event as JSON.
- Consumes: `decode_access_token` (query-param token — browsers can't set WS headers), `Project` DB model.

- [ ] **Step 1: Write failing test**

`tests/test_ws.py` — test the Hub directly, plus WS connect/auth behavior:

```python
import pytest
from starlette.testclient import TestClient

from tests.test_auth import make_token
from veroagen.main import app
from veroagen.ws import Hub


async def test_hub_broadcast():
    hub = Hub()
    q = hub.subscribe("p1")
    await hub.broadcast("p1", {"type": "doc", "v": 1})
    assert q.get_nowait() == {"type": "doc", "v": 1}
    hub.unsubscribe("p1", q)
    await hub.broadcast("p1", {"type": "doc", "v": 2})  # no subscribers, no error


def test_ws_connect_sends_doc():
    token = make_token()
    with TestClient(app) as tc:
        r = tc.post("/projects", json={"title": "WS"}, headers={"Authorization": f"Bearer {token}"})
        pid = r.json()["id"]
        with tc.websocket_connect(f"/ws/projects/{pid}?token={token}") as ws:
            msg = ws.receive_json()
            assert msg == {"type": "doc", "doc": r.json()["doc"]}


def test_ws_bad_token_rejected():
    with TestClient(app) as tc:
        with pytest.raises(Exception):
            with tc.websocket_connect("/ws/projects/x?token=bad"):
                pass
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_ws.py -v`

- [ ] **Step 3: Implement**

`veroagen/ws.py`:

```python
import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError

from veroagen.auth import decode_access_token
from veroagen.db import Project, SessionLocal

router = APIRouter()


class Hub:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, project_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(project_id, set()).add(q)
        return q

    def unsubscribe(self, project_id: str, q: asyncio.Queue) -> None:
        self._subs.get(project_id, set()).discard(q)

    async def broadcast(self, project_id: str, event: dict) -> None:
        for q in self._subs.get(project_id, set()):
            q.put_nowait(event)


hub = Hub()


@router.websocket("/ws/projects/{project_id}")
async def project_ws(ws: WebSocket, project_id: str, token: str = ""):
    try:
        user = decode_access_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    async with SessionLocal() as session:
        proj = await session.get(Project, project_id)
    if proj is None or proj.user_id != user.user_id:
        await ws.close(code=4404)
        return
    await ws.accept()
    await ws.send_json({"type": "doc", "doc": proj.doc})
    q = hub.subscribe(project_id)
    try:
        while True:
            event = await q.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(project_id, q)
```

In `veroagen/main.py` add:

```python
from veroagen.ws import router as ws_router

app.include_router(ws_router)
```

Note: `decode_access_token` raises `HTTPException` — caught by broad `except Exception` above (WS context, no HTTP response possible).

- [ ] **Step 4: Run, verify PASS** — `uv run pytest tests/test_ws.py -v`
- [ ] **Step 5: Commit** — `git commit -am "feat: websocket project doc sync hub"`

---

### Task 6: LLM provider layer (config-driven, tool-calling)

**Files:**
- Create: `config/llm.yml`, `veroagen/llm.py`
- Test: `tests/test_llm.py`

**Interfaces:**
- Produces: `veroagen.llm.chat(messages: list[dict], tools: list[dict] | None = None) -> dict` — returns the assistant message dict `{"role": "assistant", "content": str | None, "tool_calls": [...] | None}` from the first working provider. `veroagen.llm.load_providers() -> list[dict]`.
- Providers tried in `config/llm.yml` order; a provider is skipped if its env key is unset or the call raises. Anthropic handled via its OpenAI-compat endpoint (`https://api.anthropic.com/v1/`), so ALL providers go through the `openai` SDK — one code path.

- [ ] **Step 1: Write config**

`config/llm.yml`:

```yaml
priority: [groq, openrouter, azure-openai, openai, anthropic]
providers:
  groq:
    env_key: GROQ_API_KEY
    base_url: https://api.groq.com/openai/v1
    model: llama-3.3-70b-versatile
  openrouter:
    env_key: OPENROUTER_API_KEY
    base_url: https://openrouter.ai/api/v1
    model: meta-llama/llama-3.3-70b-instruct:free
  azure-openai:
    env_key: AZURE_OPENAI_API_KEY
    base_url_env: AZURE_OPENAI_ENDPOINT   # full compat endpoint incl. deployment
    model: gpt-4o
  openai:
    env_key: OPENAI_API_KEY
    base_url: https://api.openai.com/v1
    model: gpt-4o
  anthropic:
    env_key: ANTHROPIC_API_KEY
    base_url: https://api.anthropic.com/v1/
    model: claude-sonnet-5
```

- [ ] **Step 2: Write failing test**

`tests/test_llm.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from veroagen.llm import chat, load_providers


def test_load_providers_order_and_skip(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    provs = load_providers()
    names = [p["name"] for p in provs]
    assert names[0] == "openrouter"  # groq skipped: no key
    assert "groq" not in names


def _fake_client(msg):
    client = MagicMock()
    choice = MagicMock()
    choice.message.model_dump.return_value = msg
    client.chat.completions.create.return_value = MagicMock(choices=[choice])
    return client


def test_chat_uses_first_provider(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    msg = {"role": "assistant", "content": "hi", "tool_calls": None}
    with patch("veroagen.llm._client", return_value=_fake_client(msg)):
        out = chat([{"role": "user", "content": "hello"}])
    assert out["content"] == "hi"


def test_chat_falls_back_on_error(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    good = _fake_client({"role": "assistant", "content": "ok", "tool_calls": None})
    bad = MagicMock()
    bad.chat.completions.create.side_effect = RuntimeError("rate limited")
    with patch("veroagen.llm._client", side_effect=[bad, good]):
        out = chat([{"role": "user", "content": "x"}])
    assert out["content"] == "ok"


def test_chat_all_dead(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("AZURE_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        chat([{"role": "user", "content": "x"}])
```

- [ ] **Step 3: Run, verify FAIL** — `uv run pytest tests/test_llm.py -v`

- [ ] **Step 4: Implement**

`veroagen/llm.py`:

```python
import logging
import os
from pathlib import Path

import yaml
from openai import OpenAI

log = logging.getLogger(__name__)
_CONFIG_PATH = Path(__file__).parent.parent / "config" / "llm.yml"


def load_providers() -> list[dict]:
    cfg = yaml.safe_load(_CONFIG_PATH.read_text())
    out = []
    for name in cfg["priority"]:
        p = dict(cfg["providers"][name], name=name)
        key = os.environ.get(p["env_key"])
        if not key:
            continue
        base_url = p.get("base_url") or os.environ.get(p.get("base_url_env", ""), "")
        if not base_url:
            continue
        out.append({**p, "api_key": key, "base_url": base_url})
    return out


def _client(p: dict) -> OpenAI:
    return OpenAI(api_key=p["api_key"], base_url=p["base_url"])


def chat(messages: list[dict], tools: list[dict] | None = None) -> dict:
    errors = []
    for p in load_providers():
        try:
            kwargs: dict = {"model": p["model"], "messages": messages}
            if tools:
                kwargs["tools"] = tools
            resp = _client(p).chat.completions.create(**kwargs)
            return resp.choices[0].message.model_dump()
        except Exception as e:  # noqa: BLE001 — any provider failure → next provider
            log.warning("LLM provider %s failed: %s", p["name"], e)
            errors.append(f"{p['name']}: {e}")
    raise RuntimeError(f"All LLM providers failed: {errors}")
```

- [ ] **Step 5: Run, verify PASS**, **Step 6: Commit** — `git commit -am "feat: config-driven multi-provider LLM layer with tool calling"`

---

### Task 7: Agent tools + agent turn loop

**Files:**
- Create: `veroagen/agent.py`
- Test: `tests/test_agent.py`

**Interfaces:**
- Produces:
  - `veroagen.agent.TOOLS` — OpenAI tool schemas for `update_script`, `update_storyboard`.
  - `veroagen.agent.run_turn(doc: dict, user_message: str, llm=chat) -> tuple[dict, list[dict]]` — appends user message, loops LLM ≤ 6 iterations executing tool calls against the doc via `apply_ops`, appends final assistant message. Returns `(new_doc, events)` where each event is `{"type": "doc", "doc": <snapshot>}` emitted after every mutation (caller broadcasts them).
- Consumes: `apply_ops`, `veroagen.llm.chat` (injectable for tests).

- [ ] **Step 1: Write failing test**

`tests/test_agent.py`:

```python
import json

from veroagen.agent import run_turn
from veroagen.doc import new_project_doc


def stub_llm_factory(responses):
    it = iter(responses)

    def stub(messages, tools=None):
        return next(it)

    return stub


def tool_call(name, args):
    return {
        "role": "assistant", "content": None,
        "tool_calls": [{
            "id": "c1", "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }],
    }


def test_turn_with_script_tool():
    scenes = [{"id": "s1", "title": "Intro", "narration": "Hi"}]
    llm = stub_llm_factory([
        tool_call("update_script", {"scenes": scenes}),
        {"role": "assistant", "content": "Script drafted!", "tool_calls": None},
    ])
    doc, events = run_turn(new_project_doc("t"), "write a script", llm=llm)
    assert doc["script"]["scenes"] == scenes
    msgs = doc["chat"]["messages"]
    assert msgs[0] == {"role": "user", "content": "write a script"}
    assert msgs[-1] == {"role": "assistant", "content": "Script drafted!"}
    assert len(events) >= 2  # tool mutation + final message


def test_turn_plain_reply():
    llm = stub_llm_factory([{"role": "assistant", "content": "Hello!", "tool_calls": None}])
    doc, _ = run_turn(new_project_doc("t"), "hi", llm=llm)
    assert doc["chat"]["messages"][-1]["content"] == "Hello!"


def test_turn_iteration_cap():
    scenes = [{"id": "s1", "title": "x", "narration": "y"}]
    llm = stub_llm_factory([tool_call("update_script", {"scenes": scenes})] * 10)
    doc, _ = run_turn(new_project_doc("t"), "loop", llm=llm)
    assert doc["chat"]["messages"][-1]["role"] == "assistant"  # forced close
```

- [ ] **Step 2: Run, verify FAIL** — `uv run pytest tests/test_agent.py -v`

- [ ] **Step 3: Implement**

`veroagen/agent.py`:

```python
import json

from veroagen.doc import apply_ops
from veroagen.llm import chat

MAX_ITERATIONS = 6

SYSTEM_PROMPT = """You are Veroagen, an AI video production director.
You help the user plan a video: write the script (scenes with narration) and
build the storyboard (shots per scene with visual prompt, camera, duration).
Use the tools to update the project. Keep replies short; the user sees the
script and storyboard update live in their workspace."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "update_script",
            "description": "Replace the full script scene list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scenes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "narration": {"type": "string"},
                            },
                            "required": ["id", "title", "narration"],
                        },
                    }
                },
                "required": ["scenes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_storyboard",
            "description": "Replace the full storyboard shot list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "shots": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "scene_id": {"type": "string"},
                                "prompt": {"type": "string"},
                                "camera": {"type": "string"},
                                "duration_s": {"type": "number"},
                                "status": {"type": "string", "enum": ["draft"]},
                            },
                            "required": ["id", "scene_id", "prompt"],
                        },
                    }
                },
                "required": ["shots"],
            },
        },
    },
]

def _execute_tool(doc: dict, name: str, args: dict) -> dict:
    if name == "update_script":
        return apply_ops(doc, [{"op": "set_script", "scenes": args["scenes"]}])
    if name == "update_storyboard":
        shots = [{"camera": "", "duration_s": 5, "status": "draft", **s} for s in args["shots"]]
        return apply_ops(doc, [{"op": "set_shots", "shots": shots}])
    raise ValueError(f"Unknown tool: {name}")


def run_turn(doc: dict, user_message: str, llm=chat) -> tuple[dict, list[dict]]:
    events: list[dict] = []
    doc = apply_ops(doc, [{"op": "append_message", "message": {"role": "user", "content": user_message}}])
    events.append({"type": "doc", "doc": doc})

    # LLM conversation context: system + chat history + doc snapshot
    convo: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Current project doc: {json.dumps({'script': doc['script'], 'storyboard': doc['storyboard']})}"},
        *doc["chat"]["messages"],
    ]

    for _ in range(MAX_ITERATIONS):
        msg = llm(convo, tools=TOOLS)
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            content = msg.get("content") or ""
            doc = apply_ops(doc, [{"op": "append_message", "message": {"role": "assistant", "content": content}}])
            events.append({"type": "doc", "doc": doc})
            return doc, events

        convo.append(msg)
        for tc in tool_calls:
            name = tc["function"]["name"]
            args = json.loads(tc["function"]["arguments"])
            doc = _execute_tool(doc, name, args)
            events.append({"type": "doc", "doc": doc})
            convo.append({"role": "tool", "tool_call_id": tc["id"], "content": "ok"})

    # iteration cap hit — force a closing message
    doc = apply_ops(doc, [{"op": "append_message", "message": {"role": "assistant", "content": "Updated the project."}}])
    events.append({"type": "doc", "doc": doc})
    return doc, events
```

- [ ] **Step 4: Run, verify PASS**, **Step 5: Commit** — `git commit -am "feat: agent tools and tool-calling turn loop"`

---

### Task 8: Chat endpoint wiring (agent ↔ DB ↔ WS)

**Files:**
- Create: `veroagen/routers/chat.py`
- Modify: `veroagen/main.py` (include router)
- Test: `tests/test_chat_api.py`

**Interfaces:**
- Produces: `POST /projects/{id}/chat {message: str} -> {doc}` — runs `run_turn` in a threadpool (LLM call is sync), persists new doc, broadcasts every event via `hub.broadcast`.
- Consumes: `get_owned_project`, `run_turn`, `hub`.

- [ ] **Step 1: Write failing test**

`tests/test_chat_api.py`:

```python
from unittest.mock import patch

from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}


async def test_chat_persists_and_broadcasts(client):
    r = await client.post("/projects", json={"title": "Chat"}, headers=H)
    pid = r.json()["id"]

    def fake_run_turn(doc, message, llm=None):
        from veroagen.doc import apply_ops
        d = apply_ops(doc, [{"op": "append_message", "message": {"role": "user", "content": message}}])
        d = apply_ops(d, [{"op": "append_message", "message": {"role": "assistant", "content": "done"}}])
        return d, [{"type": "doc", "doc": d}]

    with patch("veroagen.routers.chat.run_turn", side_effect=fake_run_turn), \
         patch("veroagen.routers.chat.hub.broadcast") as bc:
        r2 = await client.post(f"/projects/{pid}/chat", json={"message": "hello"}, headers=H)
    assert r2.status_code == 200
    assert r2.json()["doc"]["chat"]["messages"][-1]["content"] == "done"
    assert bc.await_count == 1

    r3 = await client.get(f"/projects/{pid}", headers=H)
    assert r3.json()["doc"]["chat"]["messages"][-1]["content"] == "done"
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

`veroagen/routers/chat.py`:

```python
import anyio
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.agent import run_turn
from veroagen.db import Project, get_session
from veroagen.routers.projects import get_owned_project
from veroagen.ws import hub

router = APIRouter(prefix="/projects", tags=["chat"])


class ChatIn(BaseModel):
    message: str


@router.post("/{project_id}/chat")
async def chat_turn(
    body: ChatIn,
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    new_doc, events = await anyio.to_thread.run_sync(run_turn, proj.doc, body.message)
    proj.doc = new_doc
    session.add(proj)
    await session.commit()
    for event in events:
        await hub.broadcast(proj.id, event)
    return {"doc": new_doc}
```

In `veroagen/main.py` add:

```python
from veroagen.routers.chat import router as chat_router

app.include_router(chat_router)
```

- [ ] **Step 4: Run full suite** — `uv run pytest -v` — Expected: all PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: chat endpoint running agent turns with WS broadcast"`

---

### Task 9: Manual edit endpoints (the "hands")

**Files:**
- Create: `veroagen/routers/edits.py`
- Modify: `veroagen/main.py` (include router)
- Test: `tests/test_edits_api.py`

**Interfaces:**
- Produces: `PUT /projects/{id}/script {scenes: [...]}` and `PUT /projects/{id}/storyboard {shots: [...]}` → `{doc}`; persists via `apply_ops`, broadcasts `{"type": "doc", "doc"}`.
- Consumes: `get_owned_project`, `apply_ops`, `hub`.

- [ ] **Step 1: Write failing test**

`tests/test_edits_api.py`:

```python
from unittest.mock import patch

from tests.test_auth import make_token

H = {"Authorization": f"Bearer {make_token()}"}


async def test_put_script(client):
    r = await client.post("/projects", json={"title": "E"}, headers=H)
    pid = r.json()["id"]
    scenes = [{"id": "s1", "title": "Intro", "narration": "yo"}]
    with patch("veroagen.routers.edits.hub.broadcast") as bc:
        r2 = await client.put(f"/projects/{pid}/script", json={"scenes": scenes}, headers=H)
    assert r2.status_code == 200
    assert r2.json()["doc"]["script"]["scenes"] == scenes
    assert r2.json()["doc"]["version"] == 1
    bc.assert_awaited_once()


async def test_put_storyboard(client):
    r = await client.post("/projects", json={"title": "E2"}, headers=H)
    pid = r.json()["id"]
    shots = [{"id": "x1", "scene_id": "s1", "prompt": "sunset", "camera": "wide", "duration_s": 4, "status": "draft"}]
    r2 = await client.put(f"/projects/{pid}/storyboard", json={"shots": shots}, headers=H)
    assert r2.json()["doc"]["storyboard"]["shots"] == shots
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

`veroagen/routers/edits.py`:

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from veroagen.db import Project, get_session
from veroagen.doc import apply_ops
from veroagen.routers.projects import get_owned_project
from veroagen.ws import hub

router = APIRouter(prefix="/projects", tags=["edits"])


class ScriptIn(BaseModel):
    scenes: list[dict]


class StoryboardIn(BaseModel):
    shots: list[dict]


async def _save_and_broadcast(proj: Project, session: AsyncSession, ops: list[dict]) -> dict:
    proj.doc = apply_ops(proj.doc, ops)
    session.add(proj)
    await session.commit()
    await hub.broadcast(proj.id, {"type": "doc", "doc": proj.doc})
    return {"doc": proj.doc}


@router.put("/{project_id}/script")
async def put_script(
    body: ScriptIn,
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    return await _save_and_broadcast(proj, session, [{"op": "set_script", "scenes": body.scenes}])


@router.put("/{project_id}/storyboard")
async def put_storyboard(
    body: StoryboardIn,
    proj: Project = Depends(get_owned_project),
    session: AsyncSession = Depends(get_session),
):
    return await _save_and_broadcast(proj, session, [{"op": "set_shots", "shots": body.shots}])
```

In `veroagen/main.py` add:

```python
from veroagen.routers.edits import router as edits_router

app.include_router(edits_router)
```

- [ ] **Step 4: Run full suite, verify PASS** — `uv run pytest -v`
- [ ] **Step 5: Commit** — `git commit -am "feat: manual script/storyboard edit endpoints"`

---

### Task 10: Frontend — veroagen API client + routes

**Files (viralo repo):**
- Create: `frontend/src/veroagen/api.ts`, `frontend/src/veroagen/types.ts`, `frontend/src/veroagen/ProjectListPage.tsx`
- Modify: `frontend/src/App.tsx` (two route lines)

**Interfaces:**
- Produces: `veroagenApi.createProject(title)`, `.listProjects()`, `.getProject(id)`, `.chat(id, message)`, `.putScript(id, scenes)`, `.putStoryboard(id, shots)`, `.wsUrl(id)`; types `ProjectDoc`, `Scene`, `Shot`, `ChatMessage`. Routes: `/veroagen` (list), `/veroagen/:id` (workspace, Task 11).
- Consumes: viralo `frontend/src/lib/api.ts` `token` store; env `VITE_VEROAGEN_BASE` (default `http://localhost:8100`).

- [ ] **Step 1: Types**

`frontend/src/veroagen/types.ts`:

```ts
export interface Scene { id: string; title: string; narration: string }
export interface Shot {
  id: string; scene_id: string; prompt: string;
  camera: string; duration_s: number; status: "draft";
}
export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ProjectDoc {
  title: string;
  script: { scenes: Scene[] };
  storyboard: { shots: Shot[] };
  chat: { messages: ChatMessage[] };
  version: number;
}
export interface ProjectSummary { id: string; title: string; version: number }
```

- [ ] **Step 2: API client**

`frontend/src/veroagen/api.ts`:

```ts
import { token } from "@/lib/api";
import type { ProjectDoc, ProjectSummary, Scene, Shot } from "./types";

const BASE = import.meta.env.VITE_VEROAGEN_BASE ?? "http://localhost:8100";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.get() ?? ""}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`veroagen ${method} ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const veroagenApi = {
  createProject: (title: string) => req<{ id: string; doc: ProjectDoc }>("POST", "/projects", { title }),
  listProjects: () => req<ProjectSummary[]>("GET", "/projects"),
  getProject: (id: string) => req<{ id: string; doc: ProjectDoc }>("GET", `/projects/${id}`),
  chat: (id: string, message: string) => req<{ doc: ProjectDoc }>("POST", `/projects/${id}/chat`, { message }),
  putScript: (id: string, scenes: Scene[]) => req<{ doc: ProjectDoc }>("PUT", `/projects/${id}/script`, { scenes }),
  putStoryboard: (id: string, shots: Shot[]) => req<{ doc: ProjectDoc }>("PUT", `/projects/${id}/storyboard`, { shots }),
  wsUrl: (id: string) =>
    `${BASE.replace(/^http/, "ws")}/ws/projects/${id}?token=${encodeURIComponent(token.get() ?? "")}`,
};
```

- [ ] **Step 3: Project list page**

`frontend/src/veroagen/ProjectListPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Shell } from "@/workspace/Shell";
import { veroagenApi } from "./api";
import type { ProjectSummary } from "./types";

export function VeroagenListPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState("");

  useEffect(() => {
    veroagenApi.listProjects().then(setProjects).catch(console.error);
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    const { id } = await veroagenApi.createProject(title.trim());
    window.location.assign(`/veroagen/${id}`);
  };

  return (
    <Shell active="veroagen">
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-semibold">Veroagen — AI Video Agent</h1>
        <div className="mb-8 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Describe your video project…"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button onClick={create} className="rounded-md bg-[#ff3d6a] px-4 py-2 text-sm text-white">
            Create
          </button>
        </div>
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <a href={`/veroagen/${p.id}`} className="block rounded-md border p-3 hover:bg-muted">
                {p.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}
```

- [ ] **Step 4: Route wiring**

In `frontend/src/App.tsx`, after the `/upload` route line (line ~63), add:

```tsx
if (path === "/veroagen") return <VeroagenListPage />;
const veroagenMatch = path.match(/^\/veroagen\/([^/]+)$/);
if (veroagenMatch) return <VeroagenWorkspacePage projectId={veroagenMatch[1]} />;
```

and imports at top:

```tsx
import { VeroagenListPage } from "@/veroagen/ProjectListPage";
import { VeroagenWorkspacePage } from "@/veroagen/WorkspacePage";
```

Note: `WorkspacePage.tsx` created in Task 11 — create a placeholder now so the build passes:

```tsx
// frontend/src/veroagen/WorkspacePage.tsx (placeholder, replaced in Task 11)
export function VeroagenWorkspacePage({ projectId }: { projectId: string }) {
  return <div className="p-8">Loading project {projectId}…</div>;
}
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/saman/Documents/personal/viralo/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit (viralo repo)**

```bash
git add frontend/src/veroagen frontend/src/App.tsx
git commit -m "feat(veroagen): frontend API client, routes, project list page"
```

---

### Task 11: Frontend — split workspace (chat + script/storyboard, live WS)

**Files (viralo repo):**
- Create: `frontend/src/veroagen/useProjectDoc.ts`, `frontend/src/veroagen/ChatPanel.tsx`, `frontend/src/veroagen/ScriptView.tsx`, `frontend/src/veroagen/StoryboardView.tsx`
- Modify: `frontend/src/veroagen/WorkspacePage.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `veroagenApi` + types from Task 10.
- Produces: `useProjectDoc(projectId) -> { doc, sendMessage(text), saveScript(scenes), saveShots(shots), sending }` — owns WS connection, doc state, re-sync on reconnect.

- [ ] **Step 1: Doc hook**

`frontend/src/veroagen/useProjectDoc.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { veroagenApi } from "./api";
import type { ProjectDoc, Scene, Shot } from "./types";

export function useProjectDoc(projectId: string) {
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    veroagenApi.getProject(projectId).then((r) => alive && setDoc(r.doc));

    const connect = () => {
      const ws = new WebSocket(veroagenApi.wsUrl(projectId));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "doc") setDoc(msg.doc);
      };
      ws.onclose = () => {
        if (alive) setTimeout(connect, 2000); // re-sync via initial doc on reconnect
      };
      wsRef.current = ws;
    };
    connect();

    return () => {
      alive = false;
      wsRef.current?.close();
    };
  }, [projectId]);

  const sendMessage = useCallback(async (text: string) => {
    setSending(true);
    try {
      const r = await veroagenApi.chat(projectId, text);
      setDoc(r.doc);
    } finally {
      setSending(false);
    }
  }, [projectId]);

  const saveScript = useCallback(async (scenes: Scene[]) => {
    const r = await veroagenApi.putScript(projectId, scenes);
    setDoc(r.doc);
  }, [projectId]);

  const saveShots = useCallback(async (shots: Shot[]) => {
    const r = await veroagenApi.putStoryboard(projectId, shots);
    setDoc(r.doc);
  }, [projectId]);

  return { doc, sendMessage, saveScript, saveShots, sending };
}
```

- [ ] **Step 2: Chat panel**

`frontend/src/veroagen/ChatPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";

export function ChatPanel({
  messages, onSend, sending,
}: { messages: ChatMessage[]; onSend: (t: string) => void; sending: boolean }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const submit = () => {
    if (!text.trim() || sending) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="flex h-full flex-col border-l">
      <div className="border-b p-3 text-sm font-semibold">Director</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user" ? "ml-auto bg-[#ff3d6a] text-white" : "bg-muted"
            }`}
          >
            {m.content}
          </div>
        ))}
        {sending && <div className="text-xs text-muted-foreground">Agent working…</div>}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 border-t p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Direct your video…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button onClick={submit} disabled={sending} className="rounded-md bg-[#ff3d6a] px-3 py-2 text-sm text-white disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Script + Storyboard views**

`frontend/src/veroagen/ScriptView.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Scene } from "./types";

export function ScriptView({ scenes, onSave }: { scenes: Scene[]; onSave: (s: Scene[]) => void }) {
  const [local, setLocal] = useState(scenes);
  useEffect(() => setLocal(scenes), [scenes]);

  const update = (i: number, patch: Partial<Scene>) =>
    setLocal(local.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  if (!local.length) return <div className="p-6 text-sm text-muted-foreground">No script yet — ask the director to write one.</div>;

  return (
    <div className="space-y-4 p-4">
      {local.map((s, i) => (
        <div key={s.id} className="rounded-md border p-3">
          <input
            value={s.title}
            onChange={(e) => update(i, { title: e.target.value })}
            className="mb-2 w-full bg-transparent text-sm font-semibold outline-none"
          />
          <textarea
            value={s.narration}
            onChange={(e) => update(i, { narration: e.target.value })}
            className="w-full resize-y rounded-md border bg-background p-2 text-sm"
            rows={3}
          />
        </div>
      ))}
      <button onClick={() => onSave(local)} className="rounded-md border px-3 py-1.5 text-sm">Save script</button>
    </div>
  );
}
```

`frontend/src/veroagen/StoryboardView.tsx`:

```tsx
import type { Shot } from "./types";

export function StoryboardView({ shots }: { shots: Shot[] }) {
  if (!shots.length) return <div className="p-6 text-sm text-muted-foreground">No storyboard yet.</div>;
  return (
    <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
      {shots.map((s) => (
        <div key={s.id} className="rounded-md border p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{s.id}</span>
            <span>{s.duration_s}s · {s.camera || "auto"}</span>
          </div>
          <div className="mb-2 flex aspect-video items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            {s.status}
          </div>
          <p className="text-sm">{s.prompt}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Workspace page (replace placeholder)**

`frontend/src/veroagen/WorkspacePage.tsx`:

```tsx
import { useState } from "react";
import { Shell } from "@/workspace/Shell";
import { ChatPanel } from "./ChatPanel";
import { ScriptView } from "./ScriptView";
import { StoryboardView } from "./StoryboardView";
import { useProjectDoc } from "./useProjectDoc";

const TABS = ["Script", "Storyboard"] as const;

export function VeroagenWorkspacePage({ projectId }: { projectId: string }) {
  const { doc, sendMessage, saveScript, sending } = useProjectDoc(projectId);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Script");

  if (!doc) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <Shell active="veroagen">
      <div className="grid h-[calc(100vh-0px)] grid-cols-[1fr_380px]">
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b px-4 py-2">
            <span className="mr-4 text-sm font-semibold">{doc.title}</span>
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === "Script" && <ScriptView scenes={doc.script.scenes} onSave={saveScript} />}
            {tab === "Storyboard" && <StoryboardView shots={doc.storyboard.shots} />}
          </div>
        </div>
        <ChatPanel messages={doc.chat.messages} onSend={sendMessage} sending={sending} />
      </div>
    </Shell>
  );
}
```

- [ ] **Step 5: Verify build** — `cd frontend && npm run build` — Expected: success.
- [ ] **Step 6: Commit (viralo repo)**

```bash
git add frontend/src/veroagen
git commit -m "feat(veroagen): split workspace UI with live chat, script and storyboard"
```

---

### Task 12: End-to-end smoke run

**Files:**
- Create (backend repo): `.env.example`, `README.md`

**Interfaces:** none new — verification only.

- [ ] **Step 1: Env + README**

`.env.example` (backend repo):

```
SECRET_KEY=            # MUST equal viralo SECRET_KEY
DATABASE_URL=postgresql+asyncpg://localhost/veroagen
GROQ_API_KEY=
OPENROUTER_API_KEY=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

`README.md`:

```markdown
# Veroagen Backend

AI video production agent (Flova-style). Phase 1: conversational script + storyboard.

## Run
    cp .env.example .env   # fill SECRET_KEY (same as viralo) + at least one LLM key
    createdb veroagen
    uv sync
    uv run uvicorn veroagen.main:app --port 8100 --reload

## Test
    uv run pytest
```

- [ ] **Step 2: Full backend test suite**

Run: `uv run pytest -v` — Expected: all tests PASS.

- [ ] **Step 3: Live smoke**

```bash
uv run uvicorn veroagen.main:app --port 8100 &
# viralo frontend: add VITE_VEROAGEN_BASE=http://localhost:8100 to frontend/.env, npm run dev
```

Manual check: log into viralo → visit `/veroagen` → create project → send "make a 30s video about coffee" → script + storyboard appear in left workspace, agent replies in chat.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: env example and README for local run"
```
