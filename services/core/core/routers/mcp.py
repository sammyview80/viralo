"""Minimal MCP tools discovery endpoint."""
import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mcp_svc.client import UpstreamServiceError, list_clips
from shared.deps import get_db_no_rls
from shared.models.public.api_key import TenantApiKey

router = APIRouter(prefix="/mcp", tags=["mcp"])
TOOLS = [
    {
        "name": "list_clips",
        "description": "List workspace clips.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "video_id": {"type": "string"},
                "min_virality_score": {"type": "number", "minimum": 0, "maximum": 10},
                "sort_by": {"type": "string", "enum": ["created_at", "score"]},
                "page": {"type": "integer", "minimum": 1, "default": 1},
                "per_page": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
        },
    },
]

async def require_api_key(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_no_rls),
) -> TenantApiKey:
    api_key = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing x-api-key")
    key_hash = hashlib.sha256(api_key.strip().encode()).hexdigest()
    key = (await db.execute(select(TenantApiKey).where(TenantApiKey.key_hash == key_hash))).scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key

@router.post("", response_model=None)
async def mcp(
    request: dict[str, Any],
    _: TenantApiKey = Depends(require_api_key),
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any] | Response:
    request_id = request.get("id")
    if request.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32600, "message": "Invalid Request"}}
    method = request.get("method")
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": request.get("params", {}).get("protocolVersion", "2025-03-26"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "viralo", "version": "0.1.0"},
            },
        }
    if method == "notifications/initialized":
        return Response(status_code=202)
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        params = request.get("params", {})
        if params.get("name") != "list_clips":
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "Unknown tool"}}
        arguments = params.get("arguments", {})
        if not isinstance(arguments, dict):
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "arguments must be an object"}}
        api_key = x_api_key or authorization[7:]
        try:
            clips = await list_clips(api_key, **{key: arguments[key] for key in TOOLS[0]["inputSchema"]["properties"] if key in arguments})
        except UpstreamServiceError as exc:
            if exc.status_code == 404:
                return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": json.dumps({"clips": [], "total": 0})}]}}
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": "Upstream video service error"}}
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"content": [{"type": "text", "text": json.dumps(clips, default=str)}]},
        }
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}
