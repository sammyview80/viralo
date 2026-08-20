# Webhooks

Viralo can send you an HTTP POST when things happen in your account: a video
finishes processing, a post goes live on a platform, a clip finishes
uploading — or any of those fail. This doc covers setup, the request format,
signature verification, and every event payload shape.

## Setup

**Settings → Webhooks** (developer section, next to API keys):

1. Paste your endpoint URL — must be `http://` or `https://`, save is blocked
   on anything else (empty, `javascript:`, malformed).
2. Check which event types you want (see [Events](#events) below). Unchecked
   events never fire, even if the webhook is otherwise enabled.
3. Toggle **Enable** on.
4. Click **Save**.
5. Click **Rotate secret** to generate your signing secret. **Shown once** —
   copy it immediately. Rotating again invalidates the old secret and issues
   a new one.

There is currently no "send test webhook" button — the backend has no
test-trigger endpoint. To verify your integration, trigger a real event
(process a video, publish a post) and check your endpoint's logs.

## What gets sent

```http
POST <your-webhook-url>
Content-Type: application/json
X-Viralo-Signature: sha256=<hmac-sha256-hex-digest-of-raw-body>

{ ...event payload, see below... }
```

### Verifying the signature

```python
import hmac, hashlib

def verify(secret: str, raw_body: bytes, signature_header: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Compute the HMAC over the **raw request body bytes**, not a re-serialized
version of the parsed JSON (whitespace/key-order differences will break the
signature match).

### Delivery semantics

- Only a `2xx` response counts as delivered.
- `5xx`, `429`, and network errors are retried with exponential backoff
  (up to 5 attempts, `30s * 2^attempt`, capped at 900s).
- Any other non-2xx (other `4xx`, `3xx`) is treated as a **permanent
  failure** — not retried. Redirects are not followed (`allow_redirects=False`),
  so a misconfigured redirect on your end will correctly show up as a
  permanent failure rather than silently resolving.
- `event_id` in every payload is deterministic per `(entity_id, event)` —
  stable across our internal retry/redelivery, so if you ever receive the
  same `event_id` twice, it's safe to treat as a duplicate and ignore the
  second one.

### When nothing happens (silent skips)

These conditions produce **no HTTP call at all** — nothing is sent to your
endpoint, and there is nothing to see in the UI:

| Condition | Result |
|---|---|
| Webhook toggle is OFF | Skipped silently, regardless of which events are checked |
| No URL configured | Skipped silently |
| Toggle ON, but that specific event is unchecked | That event is skipped; other checked events still fire normally |

The only way to observe whether a webhook actually fired is on **your own
server** — check your endpoint's access logs.

## Events

| Event | Fires when | Fires from |
|---|---|---|
| `video.completed` | A video finishes processing successfully | `workers/tasks/webhook.py` → `dispatch_video_webhook`, triggered by `_update_video()` |
| `video.failed` | Video processing fails (after Celery retries are exhausted — not on every intermediate retry) | same as above |
| `post.published` | A scheduled post successfully goes live on a platform | `workers/tasks/post.py`, both the main publish-success path and stale-post reconciliation |
| `post.failed` | A post fails to publish (after retries exhausted, or reconciliation gives up on a stuck post) | same file, `_handle_publish_failure` + reconciliation path |
| `clip.ready` | A clip finishes upload/processing | `workers/tasks/video/tasks.py`, all 4 terminal-ready write sites (direct upload, composite clip, merge-ai clip, ranking clip) |
| `clip.upload_failed` | A clip permanently fails to upload (after Celery retries exhausted) | same file |

Subscription/billing events (`subscription.created`, `payment.failed`, etc.)
are **not implemented yet** — flagged as a known gap, deliberately deferred
because Stripe billing changes need their own careful pass.

### `video.completed` / `video.failed`

```json
{
  "event_id": "b6f1a2c3-...-uuid",
  "event": "video.completed",
  "video_id": "5b3e...",
  "tenant_id": "9c1a...",
  "status": "success",
  "error_reason": null,
  "created_at": "2026-08-20T10:00:00+00:00",
  "completed_at": "2026-08-20T10:05:00+00:00",
  "sent_at": "2026-08-20T10:05:01+00:00",
  "metadata": {
    "title": "My video",
    "storage_url": "https://...",
    "duration_sec": 42,
    "clip_count": 5
  }
}
```

For `video.failed`: `status` is `"failed"`, `error_reason` holds the failure
message, `metadata` fields may be null depending on how far processing got.

### `post.published` / `post.failed`

```json
{
  "event_id": "a1c2...-uuid",
  "event": "post.published",
  "tenant_id": "9c1a...",
  "post_id": "...",
  "platform": "tiktok",
  "clip_id": "...",
  "video_id": "...",
  "status": "success",
  "platform_post_id": "7284...",
  "live_url": "https://tiktok.com/...",
  "error_reason": null,
  "completed_at": "...",
  "sent_at": "..."
}
```

For `post.failed`: `status` is `"failed"`, `error_reason` holds the error
(truncated to 500 chars), `platform_post_id`/`live_url` are null.

### `clip.ready` / `clip.upload_failed`

```json
{
  "event_id": "c3d4...-uuid",
  "event": "clip.ready",
  "tenant_id": "9c1a...",
  "clip_id": "...",
  "video_id": "...",
  "status": "ready",
  "error": null,
  "completed_at": "...",
  "sent_at": "..."
}
```

For `clip.upload_failed`: `status` is `"upload_failed"`, `error` holds the
failure reason.

## Enabling/disabling specific events (API)

```http
GET /settings/webhook
```
```json
{
  "url": "https://example.com/hooks/viralo",
  "enabled": true,
  "events": ["video.completed", "video.failed", "post.published", "post.failed", "clip.ready", "clip.upload_failed"],
  "secret_set": true
}
```

```http
PATCH /settings/webhook
Content-Type: application/json

{ "events": ["video.completed", "video.failed"] }
```
Omitting `events` entirely (or a config created before this field existed)
defaults to **all events enabled** — existing setups from before per-event
opt-in keep working unchanged.

```http
POST /settings/webhook/rotate-secret
```
Returns `{ "secret": "whsec_..." }` — shown once, never echoed again by `GET`.

## Known limitations

- No test-send button / test-trigger endpoint yet.
- No webhook delivery log/history visible in the UI — check your own
  endpoint's logs to confirm delivery.
- Subscription/billing events not implemented.
- One event per HTTP call — no batching.
