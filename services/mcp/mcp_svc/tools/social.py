"""MCP tool for social accounts — proxies platform service, no DB access."""
from mcp_svc.client import ServiceClient, PLATFORM_SVC_BASE


async def list_social_accounts(bearer_token: str) -> dict:
    """list_social_accounts → social_accounts service GET /social-accounts"""
    client = ServiceClient(bearer_token)
    resp = await client.get(PLATFORM_SVC_BASE, "/social-accounts")
    resp.raise_for_status()
    return resp.json()
