---
name: viralo-mcp
description: Platform-neutral guide for connecting to and operating Viralo through MCP. Use for Claude, Codex, Cursor, Hermes, and other MCP clients when managing clips, projects, uploads, publishing, scheduling, social accounts, settings, billing, or integrations.
---

# Viralo MCP

## Connect

Endpoint: `https://app.viraloapp.tech/api/v1/mcp`.

Authenticate with a Viralo API key. Create/revoke keys in Viralo → Settings → API Keys (or the MCP page). Never include a key in source control, prompts, or logs.

For clients supporting custom headers, send `x-api-key: vk_live_...`. For bearer-token clients, send `Authorization: Bearer vk_live_...`.

## Client configuration

Use the endpoint above in each client's MCP connection UI. Configure either custom `x-api-key` header or bearer token according to client support.

Example (generic `mcp.json`):

```json
{
  "mcpServers": {
    "viralo": {
      "url": "https://app.viraloapp.tech/api/v1/mcp",
      "headers": { "x-api-key": "vk_live_..." }
    }
  }
}
```

## Use tools

1. Call `initialize`, then `tools/list`.
2. Use exact tool names and input schemas returned by server.
3. Present read results concisely.
4. Confirm before publishing, scheduling, deleting, revoking, billing, or changing workspace settings.
5. If tool missing, say so; do not invent data or actions.
6. If a call returns a JSON-RPC error, surface the message; do not retry silently.

## Current tools

- `list_clips` — list workspace clips. Args (all optional): `video_id`, `min_virality_score` (0-10), `sort_by` (`created_at`|`score`), `page`, `per_page` (max 100).
- `get_clip` — retrieve a clip. Args: `clip_id` (required).
- `publish_clip` — publish a scheduled post now. Args: `post_id` (required).
- `schedule_clip` — schedule a clip for publishing. Args: `payload` (required, object — scheduled-post fields).
- `list_social_accounts` — list connected publishing accounts. No args.
- `get_workspace_context` — get the authenticated tenant's workspace context. No args.
- `get_job_status` — get render job status. Args: `clip_id`, `render_id` (both required).

## Planned UI parity

Expose tools for projects, uploads, clip editing, channels, analytics, billing, and integrations. Add each tool to `tools/list` and implement matching `tools/call` support before documenting it as available.
