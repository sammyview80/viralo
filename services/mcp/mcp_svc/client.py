"""Thin HTTP client for Viralo MCP service.
Provides `list_clips`, `get_clip`, `publish_clip`, `schedule_clip`,
`list_social_accounts`, `get_workspace_context`, `get_job_status`.

No DB access — each method simply forwards to the existing
core/platform HTTP endpoints via shared.http.
Only rewrites auth/token handling.
"""
import httpx
from typing import Any, Dict, Optional
# Base URLs for services
VIDEO_SVC_BASE = "https://api.viraloapp.tech/video"
PLATFORM_SVC_BASE = "https://api.viraloapp.tech/platform"
CORE_SVC_BASE = "https://api.viraloapp.tech/core"


class ServiceClient:
    """Async HTTP client for Viralo services with automatic token handling."""

    def __init__(self, bearer_token: str):
        self.token = bearer_token
        self._client = httpx.AsyncClient(
            base_url="",  # Will be set per request
            headers={"Authorization": f"Bearer {bearer_token}"},
            timeout=30.0,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._client.aclose()

    async def get(self, base_url: str, endpoint: str, params: Dict[str, Any] = None) -> httpx.Response:
        """GET request to a service endpoint."""
        self._client.base_url = base_url
        resp = await self._client.get(endpoint, params=params)
        resp.raise_for_status()
        return resp

    async def post(self, base_url: str, endpoint: str, json: Dict[str, Any] = None) -> httpx.Response:
        """POST request to a service endpoint."""
        self._client.base_url = base_url
        resp = await self._client.post(endpoint, json=json)
        resp.raise_for_status()
        return resp


# Convenience functions for direct use (optional)
async def list_clips(
    token: str,
    video_id: str | None = None,
    min_virality_score: float | None = None,
    sort_by: str = "created_at",
    page: int = 1,
    per_page: int = 20,
) -> Dict[str, Any]:
    """GET /clips with the video API's filters and pagination."""
    async with ServiceClient(token) as client:
        params = {
            "min_virality_score": min_virality_score,
            "sort_by": sort_by,
            "page": page,
            "per_page": per_page,
        }
        if video_id:
            params["video_id"] = video_id
        resp = await client.get(VIDEO_SVC_BASE, "/clips", params={key: value for key, value in params.items() if value is not None})
        return resp.json()


async def get_clip(token: str, clip_id: str) -> Dict[str, Any]:
    """GET /clips/{clip_id}"""
    async with ServiceClient(token) as client:
        resp = await client.get(VIDEO_SVC_BASE, f"/clips/{clip_id}")
        return resp.json()


async def publish_clip(token: str, post_id: str) -> Dict[str, Any]:
    """POST /publish/{post_id}"""
    async with ServiceClient(token) as client:
        resp = await client.post(PLATFORM_SVC_BASE, f"/publish/{post_id}")
        return resp.json()


async def schedule_clip(token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST /schedule"""
    async with ServiceClient(token) as client:
        resp = await client.post(PLATFORM_SVC_BASE, "/schedule", json=payload)
        return resp.json()


async def list_social_accounts(token: str) -> Dict[str, Any]:
    """GET /social-accounts"""
    async with ServiceClient(token) as client:
        resp = await client.get(PLATFORM_SVC_BASE, "/social-accounts")
        return resp.json()


async def get_workspace_context(token: str, tenant_id: str) -> Dict[str, Any]:
    """GET /tenants/{tenant_id}"""
    async with ServiceClient(token) as client:
        resp = await client.get(CORE_SVC_BASE, f"/tenants/{tenant_id}")
        return resp.json()


async def get_job_status(token: str, clip_id: str, render_id: str) -> Dict[str, Any]:
    """GET /render/{render_id}/status"""
    async with ServiceClient(token) as client:
        resp = await client.get(VIDEO_SVC_BASE, f"/render/{render_id}/status")
        return resp.json()
