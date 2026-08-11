"""MCP tool for render status checks."""
from mcp_svc.client import ServiceClient, VIDEO_SVC_BASE


async def get_render_status(token: str, clip_id: str, render_id: str) -> dict:
    """Get render job status from video service."""
    client = ServiceClient(token)
    resp = await client.get(VIDEO_SVC_BASE, f"/clips/{clip_id}/render/{render_id}")
    resp.raise_for_status()
    return resp.json()