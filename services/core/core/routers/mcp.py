"""Minimal MCP tools discovery endpoint."""
import hashlib
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deps import get_db_no_rls
from shared.models.public.api_key import TenantApiKey

router = APIRouter(prefix="/mcp", tags=["mcp"])
TOOLS = [
    {"name": "list_clips", "description": "List workspace clips.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "get_clip", "description": "Get a clip by ID.", "inputSchema": {"type": "object", "properties": {"clip_id": {"type": "string"}}, "required": ["clip_id"]}},
    {"name": "list_social_accounts", "description": "List connected social accounts.", "inputSchema": {"type": "object", "properties": {}}},
]

async def require_api_key(x_api_key: str | None = Header(default=None), db: AsyncSession = Depends(get_db_no_rls)) -> TenantApiKey:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing x-api-key")
    key_hash = hashlib.sha256(x_api_key.strip().encode()).hexdigest()
    key = (await db.execute(select(TenantApiKey).where(TenantApiKey.key_hash == key_hash))).scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key

@router.post("")
async def mcp(request: dict[str, Any], _: TenantApiKey = Depends(require_api_key)) -> dict[str, Any]:
    request_id = request.get("id")
    if request.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32600, "message": "Invalid Request"}}
    if request.get("method") == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}
