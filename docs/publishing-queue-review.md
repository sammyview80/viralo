# Publishing queue review

Customer report: scheduled post went live much later than chosen time; YouTube publish failed.

## Root causes & fixes

### 1. Due-post scanner blocked by publish workers

`process_due_posts` (runs every 60s via Beat) was routed to `viralo.post.publish` — the same queue as long-running `publish_post` jobs. When all publish workers were busy, the scanner waited behind uploads (observed ~22 min lag).

**Fix:** Dedicated queue `viralo.post.schedule` for `process_due_posts`. A lightweight worker (concurrency 1) runs alongside Beat and only consumes that queue. `publish_post` stays on `viralo.post.publish`.

### 2. Schedule time timezone

Scheduler modal used `new Date(datetimeLocalValue)` which browsers can parse as UTC for `YYYY-MM-DDTHH:mm` strings, shifting the stored UTC time.

**Fix:** `datetimeLocalToUtcIso()` builds the instant from local wall-clock components; API still receives UTC ISO.

### 3. YouTube upload failures

Upload used `video/*` MIME (rejected for MP4). API errors were often opaque or empty.

**Fix:** `video/mp4` MIME. `HttpError` mapped to auth / quota / transient retry messages; blank errors get a fallback string.

### 4. Stale token after refresh failure

When the access token was near expiry, a failed refresh was logged and publish continued with the old token.

**Fix:** Fail fast via `_handle_publish_failure` with a reconnect message; no publish attempt on expired/missing refresh token.

## Retry behavior

| Outcome | Post status | Notes |
|---------|-------------|-------|
| Success | `posted` | Notification with live URL |
| Rate limit (`retry_after_seconds`) | `pending`, rescheduled | Counts toward retry |
| Publisher failure | `pending` or `failed` after 3 retries | `last_error` set |
| Token refresh failure | `pending` or `failed` | User must reconnect account |
| Clip not ready | `pending`, +60s | Waits for storage URL |

## Rollout

1. Deploy code (routes + worker compose change on `celery-beat`).
2. Restart `celery-beat` so the schedule-queue worker starts.
3. Confirm in Flower/RabbitMQ: `viralo.post.schedule` has a consumer; due-scan tasks no longer appear on `viralo.post.publish`.

## Observability

- Logs: `process_due_posts: enqueued N posts`, `publish_post: token refresh failed`, YouTube error strings in `scheduled_posts.last_error`.
- Flower: queue depth on `viralo.post.schedule` should stay near zero; spikes on `viralo.post.publish` are expected during bulk publish.
- Alert if `process_due_posts` tasks sit unacked on `viralo.post.schedule` for >2 minutes (Beat consumer down).
