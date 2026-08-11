"""MCP social-account tools backed by the Platform API."""

from typing import Any

from mcp_svc.client import PLATFORM_SVC_BASE, ServiceClient


async def list_social_accounts(token: str) -> dict[str, Any]:
    async with ServiceClient(token) as client:
        return (await client.get(PLATFORM_SVC_BASE, "/social-accounts")).json()
