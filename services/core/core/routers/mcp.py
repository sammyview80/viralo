"""Minimal MCP tools discovery endpoint."""
import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mcp_svc.client import (
    UpstreamServiceError,
    get_clip,
    get_job_status,
    get_workspace_context,
    list_clips,
    list_social_accounts,
    publish_clip,
    schedule_clip,
)
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
        "fn": lambda api_key, args: list_clips(api_key, **args),
    },
    {
        "name": "get_clip",
        "description": "Get a single clip by id.",
        "inputSchema": {
            "type": "object",
            "properties": {"clip_id": {"type": "string"}},
            "required": ["clip_id"],
        },
        "fn": lambda api_key, args: get_clip(api_key, args["clip_id"]),
    },
    {
        "name": "publish_clip",
        "description": "Publish a scheduled post now.",
        "inputSchema": {
            "type": "object",
            "properties": {"post_id": {"type": "string"}},
            "required": ["post_id"],
        },
        "fn": lambda api_key, args: publish_clip(api_key, args["post_id"]),
    },
    {
        "name": "schedule_clip",
        "description": "Schedule a clip for publishing.",
        "inputSchema": {
            "type": "object",
            "properties": {"payload": {"type": "object"}},
            "required": ["payload"],
        },
        "fn": lambda api_key, args: schedule_clip(api_key, args["payload"]),
    },
    {
        "name": "list_social_accounts",
        "description": "List connected social accounts for the workspace.",
        "inputSchema": {"type": "object", "properties": {}},
        "fn": lambda api_key, args: list_social_accounts(api_key),
    },
    {
        "name": "get_workspace_context",
        "description": "Get workspace/tenant context.",
        "inputSchema": {
            "type": "object",
            "properties": {"tenant_id": {"type": "string"}},
            "required": ["tenant_id"],
        },
        "fn": lambda api_key, args: get_workspace_context(api_key, args["tenant_id"]),
    },
    {
        "name": "get_job_status",
        "description": "Get render job status for a clip.",
        "inputSchema": {
            "type": "object",
            "properties": {"clip_id": {"type": "string"}, "render_id": {"type": "string"}},
            "required": ["clip_id", "render_id"],
        },
        "fn": lambda api_key, args: get_job_status(api_key, args["clip_id"], args["render_id"]),
    },
]
TOOLS_BY_NAME = {tool["name"]: tool for tool in TOOLS}


def _public_tools() -> list[dict[str, Any]]:
    return [{key: value for key, value in tool.items() if key != "fn"} for tool in TOOLS]

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
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": _public_tools()}}
    if method == "tools/call":
        params = request.get("params", {})
        tool = TOOLS_BY_NAME.get(params.get("name"))
        if tool is None:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "Unknown tool"}}
        arguments = params.get("arguments", {})
        if not isinstance(arguments, dict):
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": "arguments must be an object"}}
        missing = [key for key in tool["inputSchema"].get("required", []) if key not in arguments]
        if missing:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": f"Missing required arguments: {', '.join(missing)}"}}
        filtered_args = {key: value for key, value in arguments.items() if key in tool["inputSchema"]["properties"]}
        api_key = x_api_key or authorization[7:]
        try:
            result = await tool["fn"](api_key, filtered_args)
        except UpstreamServiceError as exc:
            if exc.status_code == 404:
                return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": json.dumps({})}]}}
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": "Upstream service error"}}
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"content": [{"type": "text", "text": json.dumps(result, default=str)}]},
        }
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}
