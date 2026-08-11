"""MCP tools for publishing/scheduling clips — proxies platform service, no DB access."""
from mcp_svc.client import ServiceClient, PLATFORM_SVC_BASE


async def publish_clip(bearer_token: str, post_id: str) -> dict:
    """publish_clip → platform scheduling endpoint POST /scheduled-posts/{post_id}/publish-now"""
    client = ServiceClient(bearer_token)
    resp = await client.post(PLATFORM_SVC_BASE, f"/scheduled-posts/{post_id}/publish-now")
    resp.raise_for_status()
    return resp.json()


async def schedule_clip(bearer_token: str, payload: dict) -> dict:
    """schedule_clip → scheduling endpoint POST /scheduled-posts"""
    client = ServiceClient(bearer_token)
    resp = await client.post(PLATFORM_SVC_BASE, "/scheduled-posts", json=payload)
    resp.raise_for_status()
    return resp.json()
