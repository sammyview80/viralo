"""MCP tools for social account management — proxies platform service, no DB access."""
from mcp_svc.client import ServiceClient, PLATFORM_SVC_BASE
from typing import Dict, Any

async def list_social_accounts(token: str) -> Dict[str, Any]:
    \"\"\"GET /social-accounts → platform service\"\"\"  
    client = ServiceClient(token)
    resp = await client.get(\"/social-accounts\", headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()
