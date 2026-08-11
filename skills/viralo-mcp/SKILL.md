---
name: viralo-mcp
description: Platform-neutral guide for connecting to and operating Viralo through MCP. Use for Claude, Codex, Cursor, Hermes, and other MCP clients when managing clips, projects, uploads, publishing, scheduling, social accounts, settings, billing, or integrations.
---

# Viralo MCP

## Connect

Endpoint: `https://app.viraloapp.tech/api/v1/mcp`.

Authenticate with a Viralo API key as a bearer token. Create/revoke keys in Viralo Settings → API Keys. Never include a key in source control, prompts, or logs.

For clients supporting custom headers, send `x-api-key: vk_live_...`. For bearer-token clients, send `Authorization: Bearer vk_live_...`.

## Client configuration

Use the endpoint above in each client’s MCP connection UI. Configure either custom `x-api-key` header or bearer token according to client support.

## Use tools

1. Call `initialize`, then `tools/list`.
2. Use exact tool names and input schemas returned by server.
3. Present read results concisely.
4. Confirm before publishing, scheduling, deleting, revoking, billing, or changing workspace settings.
5. If tool missing, say so; do not invent data or actions.

## Current tools

- `list_clips`: list workspace clips.
- `get_clip`: retrieve clip by `clip_id`.
- `list_social_accounts`: list connected publishing accounts.

## Planned UI parity

Expose tools for projects, uploads, clip editing, publishing, scheduling, channels, analytics, billing, settings, API-key management, and integrations. Add each tool to `tools/list` and implement matching `tools/call` support before documenting it as available.
