"""Minimal MCP tools discovery endpoint."""
import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mcp_svc.client import (
    UpstreamServiceError,
    generate_clips,
    get_clip,
    get_job_status,
    get_workspace_context,
    import_youtube_video,
    list_clips,
    list_social_accounts,
    publish_clip,
    schedule_clip,
    upload_video,
)
from shared.auth import create_access_token
from shared.deps import get_db_no_rls
from shared.models.public.api_key import TenantApiKey
from shared.models.public.user import User

router = APIRouter(prefix="/mcp", tags=["mcp"])

# Mirrors video-service's ClipConfig/AutoPublishConfig (services/video/video/schemas.py).
# Passed through as-is to the upstream service, which is the source of truth for validation.
CLIP_CONFIG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": "Clip-generation settings. Any field omitted falls back to the service default.",
    "properties": {
        "duration_min": {"type": "integer", "minimum": 5, "maximum": 300, "default": 15, "description": "Min clip length in seconds"},
        "duration_max": {"type": "integer", "minimum": 10, "maximum": 600, "default": 60, "description": "Max clip length in seconds"},
        "max_clips": {"type": "integer", "minimum": 1, "maximum": 30, "default": 5, "description": "Max number of clips to generate from this video"},
        "aspect_ratio": {"type": "string", "enum": ["9:16", "1:1", "16:9", "4:5"], "default": "9:16"},
        "min_score": {"type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.5, "description": "Min virality score (0.5 = balanced, 0.8 = viral only)"},
        "add_captions": {"type": "boolean", "default": False},
        "skip_caption": {"type": "boolean", "default": False, "description": "Skip AI title/description/hashtag generation"},
        "language": {"type": "string", "description": "Caption/AI content language (ISO 639-1); omit for auto-detect"},
        "caption_style": {
            "type": "string",
            "enum": ["capcut", "capcut-bold", "tiktok", "word-pop", "hormozi", "beast", "neon", "karaoke", "classic",
                     "impact", "minimal", "sunset", "royal", "ocean", "bubble", "banger", "money", "reveal-light",
                     "podcast", "pop-yellow", "pop-red", "karaoke-green", "karaoke-cyan", "comic", "cinema",
                     "bounce", "glow", "shadow", "highlighter", "rainbow"],
        },
        "output_quality": {"type": "string", "enum": ["source", "1080p", "720p", "480p", "360p"], "default": "1080p"},
        "topic_focus": {"type": "string", "description": "Guide AI to focus on a specific topic"},
        "template_id": {"type": "string", "enum": ["sports-hype", "gaming-clutch", "cinematic", "music-vibe", "talking-head", "generic"]},
        "music": {"type": "boolean", "default": True},
        "music_track": {"type": "string", "enum": ["hype", "dramatic", "chill"]},
        "voiceover": {"type": "boolean", "default": False, "description": "Generate and mix an AI narrator voiceover"},
        "occasion": {
            "type": "string",
            "enum": ["football", "soccer", "sports", "cricket", "ufc", "boxing", "mma", "f1", "racing", "gaming",
                     "esports", "podcast", "interview", "concert", "music", "wedding", "travel", "general"],
        },
        "auto_publish": {"type": "boolean", "default": False, "description": "Auto-schedule generated clips to social accounts once ready"},
        "auto_publish_config": {
            "type": "object",
            "description": "Required when auto_publish is true.",
            "properties": {
                "social_account_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 20, "description": "Connected account IDs to publish to — see list_social_accounts"},
                "publish_per_day": {"type": "integer", "minimum": 1, "maximum": 10, "default": 3, "description": "Max clips published per day"},
                "publish_interval_hours": {"type": "integer", "minimum": 1, "maximum": 24, "default": 8, "description": "Hours between scheduled posts"},
                "publish_start_at": {"type": "string", "description": "ISO 8601 datetime with timezone; when the schedule begins"},
                "caption_template": {"type": "string", "maxLength": 2000},
            },
        },
    },
}

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
        "description": "Get workspace/tenant context for the authenticated tenant.",
        "inputSchema": {"type": "object", "properties": {}},
        "fn": lambda api_key, args: get_workspace_context(api_key),
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
    {
        "name": "import_youtube_video",
        "description": (
            "Import a YouTube video and queue clip generation from it. Use list_social_accounts first "
            "to get account IDs for auto_publish_config.social_account_ids."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "YouTube video URL"},
                "title": {"type": "string", "description": "Title for the imported video; defaults to the YouTube title"},
                "config": CLIP_CONFIG_SCHEMA,
            },
            "required": ["url"],
        },
        "fn": lambda api_key, args: import_youtube_video(api_key, args["url"], args.get("title"), args.get("config")),
    },
    {
        "name": "upload_video",
        "description": (
            "Upload a video file and queue clip generation from it. Provide the raw file contents "
            "base64-encoded — not a URL or local path. Use list_social_accounts first to get account "
            "IDs for auto_publish_config.social_account_ids."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "filename": {"type": "string", "description": "Original filename, e.g. episode-12.mp4"},
                "content_base64": {"type": "string", "description": "Base64-encoded video file bytes"},
                "title": {"type": "string", "description": "Title for the video"},
                "config": CLIP_CONFIG_SCHEMA,
            },
            "required": ["filename", "content_base64", "title"],
        },
        "fn": lambda api_key, args: upload_video(api_key, args["filename"], args["content_base64"], args["title"], args.get("config")),
    },
    {
        "name": "generate_clips",
        "description": "(Re)generate clips for a video that was already imported, with a new config.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "video_id": {"type": "string"},
                "config": CLIP_CONFIG_SCHEMA,
            },
            "required": ["video_id"],
        },
        "fn": lambda api_key, args: generate_clips(api_key, args["video_id"], args.get("config")),
    },
]
TOOLS_BY_NAME = {tool["name"]: tool for tool in TOOLS}


def _public_tools() -> list[dict[str, Any]]:
    return [{key: value for key, value in tool.items() if key != "fn"} for tool in TOOLS]

async def require_api_key(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_no_rls),
) -> str:
    """Validate the tenant API key and mint a short-lived service JWT for it.

    Downstream services (video/platform/core) authenticate via JWT, not raw
    API keys — forwarding the raw key as a bearer token always fails auth
    there, so tools/call must use this minted token instead.
    """
    api_key = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing x-api-key")
    key_hash = hashlib.sha256(api_key.strip().encode()).hexdigest()
    key = (await db.execute(select(TenantApiKey).where(TenantApiKey.key_hash == key_hash))).scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    user = (await db.execute(select(User).where(User.tenant_id == key.tenant_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=403, detail="No user associated with this tenant")
    return create_access_token(user_id=str(user.id), tenant_id=str(key.tenant_id), email=user.email, plan="")

@router.post("", response_model=None)
async def mcp(
    request: dict[str, Any],
    service_token: str = Depends(require_api_key),
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
        try:
            result = await tool["fn"](service_token, filtered_args)
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
