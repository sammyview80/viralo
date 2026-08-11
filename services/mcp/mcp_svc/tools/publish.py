"""MCP publishing tools backed by the Platform API."""

from typing import Any

from mcp_svc.client import PLATFORM_SVC_BASE, ServiceClient


async def publish_clip(token: str, post_id: str) -> dict[str, Any]:
    async with ServiceClient(token) as client:
        return (await client.post(PLATFORM_SVC_BASE, f"/scheduled-posts/{post_id}/publish-now")).json()


async def schedule_clip(token: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with ServiceClient(token) as client:
        return (await client.post(PLATFORM_SVC_BASE, "/scheduled-posts", json=payload)).json()
