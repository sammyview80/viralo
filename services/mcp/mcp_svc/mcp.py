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
- POST /oauth/token - Issue bearer token (validates API key)
- GET /tools/list_clips - List clips for a video
- GET /tools/get_clip - Get clip detail
- POST /tools/publish_clip - Publish a clip
- POST /tools/schedule_clip - Schedule a clip
- GET /tools/list_social_accounts - List social accounts
- GET /tools/get_workspace_context - Get workspace context
- GET /tools/get_job_status - Check render job status

All tool calls use the existing Viralo service endpoints via shared.client.
No database access is performed; all data flows through HTTP.

Requires:
- VIRALO_API_KEY environment variable for authentication
"""
