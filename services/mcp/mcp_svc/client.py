"""Thin HTTP client for Viralo MCP service.
Provides `list_clips`, `get_clip`, `publish_clip`, `schedule_clip`,
`list_social_accounts`, `get_workspace_context`, `get_job_status`.

No DB access — each method simply forwards to the existing
core/platform HTTP endpoints via shared.http.
Only rewrites auth/token handling.
"""
import httpx
from typing import Any, Dict

from mcp_svc.auth import get_access_token


async def list_clips(token: str, video_id: str = None) -> Dict[str, Any]:
    """GET /clips [?video_id=...]"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/video")
    params = {}
    if video_id:
        params["video_id"] = video_id
    resp = await client.get("/clips", params=params, headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


async def get_clip(token: str, clip_id: str) -> Dict[str, Any]:
    """GET /clips/{clip_id}"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/video")
    resp = await client.get(f"/clips/{clip_id}", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


async def publish_clip(token: str, post_id: str) -> Dict[str, Any]:
    """POST /publish/{post_id}"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/platform")
    resp = await client.post(f"/publish/{post_id}", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


async def schedule_clip(token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST /schedule"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/platform")
    resp = await client.post("/schedule", json=payload, headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


async def list_social_accounts(token: str) -> Dict[str, Any]:
    """GET /social-accounts"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/platform")
    resp = await client.get("/social-accounts", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


async def get_workspace_context(token: str, tenant_id: str) -> Dict[str, Any]:
    """GET /tenants/{tenant_id}"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/core")
    resp = await client.get(f"/tenants/{tenant_id}", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


async def get_job_status(token: str, clip_id: str, render_id: str) -> Dict[str, Any]:
    """GET /render/{render_id}/status"""
    client = httpx.AsyncClient(base_url="https://api.viraloapp.tech/video")
    resp = await client.get(f"/render/{render_id}/status", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()