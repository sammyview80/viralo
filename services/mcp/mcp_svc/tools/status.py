"""MCP tool for render job status — proxies video service, no DB access."""
from mcp_svc.client import ServiceClient, VIDEO_SVC_BASE


async def get_job_status(bearer_token: str, clip_id: str, render_id: str) -> dict:
    """get_job_status → render job polling endpoint GET /clips/{clip_id}/render/{render_id}"""
    client = ServiceClient(bearer_token)
    resp = await client.get(VIDEO_SVC_BASE, f"/clips/{clip_id}/render/{render_id}")
    resp.raise_for_status()
    return resp.json()
