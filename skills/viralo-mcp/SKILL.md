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
- `import_youtube_video` — import a YouTube video and queue clip generation. Args: `url` (required), `title`, `config` (clip-generation settings, see below).
- `upload_video` — upload a video file and queue clip generation. Args: `filename`, `content_base64` (base64-encoded raw file bytes), `title` (all required), `config`.
- `generate_clips` — (re)generate clips for an already-imported video with a new config. Args: `video_id` (required), `config`.

### `config` (clip-generation settings)

Shared by `import_youtube_video`, `upload_video`, `generate_clips`. All fields optional — omitted fields fall back to service defaults.

- `duration_min` / `duration_max` — clip length bounds in seconds (5-300 / 10-600).
- `max_clips` — max number of clips to generate (1-30, default 5).
- `aspect_ratio` — `9:16` | `1:1` | `16:9` | `4:5`.
- `min_score` — min virality score 0.0-1.0 (0.5 balanced, 0.8 viral-only).
- `add_captions`, `skip_caption`, `language`, `caption_style`, `output_quality`, `topic_focus`, `template_id`, `music`, `music_track`, `voiceover`, `occasion` — see `tools/list` for full enums.
- `auto_publish` — auto-schedule generated clips to social accounts once ready.
- `auto_publish_config` — required when `auto_publish` is true:
  - `social_account_ids` — connected account IDs to publish to (call `list_social_accounts` first).
  - `publish_per_day` — max clips published per day (1-10, default 3).
  - `publish_interval_hours` — hours between scheduled posts (1-24, default 8).
  - `publish_start_at` — ISO 8601 datetime with timezone; when the schedule begins.
  - `caption_template` — optional caption template string.

## Planned UI parity

Expose tools for projects, uploads, clip editing, channels, analytics, billing, and integrations. Add each tool to `tools/list` and implement matching `tools/call` support before documenting it as available.
