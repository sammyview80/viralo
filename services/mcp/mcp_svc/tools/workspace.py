"""MCP tool for workspace/tenant context — proxies core service, no DB access."""
from mcp_svc.client import ServiceClient, CORE_SVC_BASE


async def get_workspace_context(bearer_token: str, tenant_id: str) -> dict:
    """get_workspace_context → tenants endpoint GET /tenants/{tenant_id}"""
    client = ServiceClient(bearer_token)
    resp = await client.get(CORE_SVC_BASE, f"/tenants/{tenant_id}")
    resp.raise_for_status()
    return resp.json()
