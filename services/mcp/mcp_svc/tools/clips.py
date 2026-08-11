"""MCP tools for clip listing/detail — proxies video service, no DB access."""
from mcp_svc.client import ServiceClient, VIDEO_SVC_BASE


async def list_clips(bearer_token: str, video_id: str) -> dict:
    """list_clips → video service GET /videos/{video_id}/clips"""
    client = ServiceClient(bearer_token)
    resp = await client.get(VIDEO_SVC_BASE, f"/videos/{video_id}/clips")
    resp.raise_for_status()
    return resp.json()


async def get_clip(bearer_token: str, clip_id: str) -> dict:
    """get_clip → video service GET /clips/{clip_id}"""
    client = ServiceClient(bearer_token)
    resp = await client.get(VIDEO_SVC_BASE, f"/clips/{clip_id}")
    resp.raise_for_status()
    return resp.json()
