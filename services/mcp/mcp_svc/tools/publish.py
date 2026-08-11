"""MCP tools for publishing and scheduling — proxies platform service, no DB access."""
from mcp_svc.client import ServiceClient, PLATFORM_SVC_BASE
from typing import Dict, Any

async def publish_clip(token: str, post_id: str) -> Dict[str, Any]:
    \"\"\"POST /publish/{post_id} → platform service\"\"\"  
    client = ServiceClient(token)
    resp = await client.post(f\"/publish/{post_id}\", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()

async def schedule_clip(token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    \"\"\"POST /schedule → platform service\"\"\"  
    client = ServiceClient(token)
    resp = await client.post(\"/schedule\", json=payload, headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()
