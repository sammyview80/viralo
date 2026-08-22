"""MCP server for Viralo app.

Provides Model Context Protocol (MCP) integration for the Viralo
platform, enabling external clients to interact with video clips,
publishing, scheduling, social accounts, workspace context, and render
job status.

Architecture:
- All service calls go through a thin HTTP client
- Auth is passed via bearer token header
- All endpoints return JSON with proper error handling

Endpoints:
- GET /mcp/tools/list - List available MCP tools and their schemas
- POST /mcp/tools/call - Invoke a named MCP tool

All tool calls use the existing Viralo service endpoints via shared.client.
No database access is performed; all data flows through HTTP.

Requires:
- VIRALO_API_KEY environment variable for authentication
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from mcp_svc.client import (
    UpstreamServiceError,
    analyze_viral,
    create_ranking_video,
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
from mcp_svc.tools.get_project_details import get_project_details
from mcp_svc.tools.list_projects import list_projects

router = APIRouter(prefix="/mcp", tags=["mcp"])

bearer_scheme = HTTPBearer()


def _token(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> str:
    return creds.credentials


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
        "fn": lambda api_key, args: get_clip(api_key, **args),
    },
    {
        "name": "publish_clip",
        "description": "Publish a clip to social media.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "post_id": {"type": "string"},
                "platform": {"type": "string"},
                "caption": {"type": "string"},
                "hashtags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["post_id", "platform"],
        },
        "fn": lambda api_key, args: publish_clip(api_key, **args),
    },
    {
        "name": "schedule_clip",
        "description": "Schedule a clip for future publishing.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "clip_id": {"type": "string"},
                "platform": {"type": "string"},
                "scheduled_at": {"type": "string", "description": "ISO 8601 datetime"},
                "caption": {"type": "string"},
                "hashtags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["clip_id", "platform", "scheduled_at"],
        },
        "fn": lambda api_key, args: schedule_clip(api_key, **args),
    },
    {
        "name": "list_social_accounts",
        "description": "List all connected social media accounts.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "platform": {"type": "string"},
            },
        },
        "fn": lambda api_key, args: list_social_accounts(api_key, **args),
    },
    {
        "name": "get_workspace_context",
        "description": "Get workspace/tenant context including stats and settings.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tenant_id": {"type": "string"},
            },
        },
        "fn": lambda api_key, args: get_workspace_context(api_key, **args),
    },
    {
        "name": "get_job_status",
        "description": "Get the status of a render job.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
            },
            "required": ["job_id"],
        },
        "fn": lambda api_key, args: get_job_status(api_key, **args),
    },
    {
        "name": "list_projects",
        "description": "List all projects/videos available to the user.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "minimum": 1, "default": 1},
                "per_page": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                "sort_by": {"type": "string", "enum": ["newest", "oldest", "title", "status"]},
                "search": {"type": "string", "description": "Search projects by title or content"},
                "status_filter": {"type": "string", "enum": ["all", "ready", "processing", "failed"]},
            },
        },
        "fn": lambda api_key, args: list_projects(api_key, **args),
    },
    {
        "name": "get_project_details",
        "description": "Get detailed information about a specific project.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "include_clips": {"type": "boolean", "default": True},
            },
            "required": ["project_id"],
        },
        "fn": lambda api_key, args: get_project_details(api_key, **args),
    },
    {
        "name": "import_youtube_video",
        "description": "Import a YouTube video and queue clip generation.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "title": {"type": "string"},
                "config": CLIP_CONFIG_SCHEMA,
            },
            "required": ["url"],
        },
        "fn": lambda api_key, args: import_youtube_video(api_key, **args),
    },
    {
        "name": "upload_video",
        "description": "Upload a video file and queue clip generation.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "filename": {"type": "string"},
                "content_base64": {"type": "string"},
                "title": {"type": "string"},
                "config": CLIP_CONFIG_SCHEMA,
            },
            "required": ["filename", "content_base64", "title"],
        },
        "fn": lambda api_key, args: upload_video(api_key, **args),
    },
    {
        "name": "generate_clips",
        "description": "Generate clips for an existing video.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "video_id": {"type": "string"},
                "config": CLIP_CONFIG_SCHEMA,
            },
            "required": ["video_id"],
        },
        "fn": lambda api_key, args: generate_clips(api_key, **args),
    },
    {
        "name": "analyze_viral",
        "description": "Analyze a YouTube video for virality potential and return AI-picked clip_moments (start_sec/end_sec/reason/clip_score) to feed into create_ranking_video.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "YouTube video URL"},
            },
            "required": ["url"],
        },
        "fn": lambda api_key, args: analyze_viral(api_key, **args),
    },
    {
        "name": "create_ranking_video",
        "description": "Render a ranking/countdown video by stitching together AI- or user-picked clip segments (e.g. clip_moments from analyze_viral).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "template": {"type": "string", "enum": ["viral", "classic", "neon", "minimal"], "default": "viral"},
                "order": {"type": "string", "enum": ["countdown", "ascending"], "default": "countdown"},
                "template_config": {"type": "object"},
                "segments": {
                    "type": "array",
                    "minItems": 2,
                    "description": "At least 2 segments, e.g. taken from analyze_viral's clip_moments",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_type": {"type": "string", "enum": ["url", "upload"]},
                            "url": {"type": "string", "description": "Required when source_type is 'url'"},
                            "video_id": {"type": "string", "description": "Required when source_type is 'upload'"},
                            "start_sec": {"type": "number", "minimum": 0},
                            "end_sec": {"type": "number", "exclusiveMinimum": 0},
                            "segment_title": {"type": "string"},
                        },
                        "required": ["source_type", "start_sec", "end_sec"],
                    },
                },
            },
            "required": ["title", "segments"],
        },
        "fn": lambda api_key, args: create_ranking_video(api_key, **args),
    },
]

_TOOLS_BY_NAME = {tool["name"]: tool for tool in TOOLS}


class ToolCallRequest(BaseModel):
    name: str
    arguments: dict[str, Any] = {}


@router.get("/tools/list")
async def list_tools(_token: str = Depends(_token)) -> dict:
    """List available MCP tools with their input schemas."""
    return {
        "tools": [
            {"name": tool["name"], "description": tool["description"], "inputSchema": tool["inputSchema"]}
            for tool in TOOLS
        ]
    }


@router.post("/tools/call")
async def call_tool(payload: ToolCallRequest, token: str = Depends(_token)) -> dict:
    """Invoke a named MCP tool with the given arguments."""
    tool = _TOOLS_BY_NAME.get(payload.name)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {payload.name}")

    try:
        result = await tool["fn"](token, payload.arguments)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return {"result": result}
