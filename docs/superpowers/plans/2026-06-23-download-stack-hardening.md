# Download Stack Hardening — Sequenced Plan

Date: 2026-06-23
Scope: `workers/tasks/video.py` download path (currently ~6000 lines)
Goal: close gaps vs Vizard / OpusClip — proxy quality, source caching, maintainability.

Order is deliberate: **caching first** (cheap, high ROI, no external deps), **proxies second**
(biggest quality win, needs vendor account), **split last** (mechanical, riskiest to rush, do
once behavior is stable).

---

## Phase 1 — Source caching by video_id

**Why first:** zero external deps, immediately cuts proxy burn + latency on repeat jobs. Every
re-clip of the same YouTube URL today triggers a full re-download. Lowers load before proxy work,
making proxy savings measurable.

**Current state**
- `process_youtube_video` (video.py:5162) downloads to `VIDEO_TEMP_DIR/<video_id>/source.mp4`.
- No dedup. `video_id` here is the internal DB id, not the YouTube id — two users posting the same
  URL get two downloads.

**Design**
1. Extract canonical YouTube id from URL (already parsed at 5171-5173; reuse).
2. Cache key = `yt:<youtube_id>:<format_signature>` where format_signature captures
   `output_quality` (now always "source", so effectively just youtube_id for now).
3. Store source in object storage (the same provider used for clips) under
   `source-cache/<youtube_id>.mp4` + a small metadata row (duration, max_height, won_client, bytes,
   created_at).
4. On job start: check cache → if hit and fresh (TTL e.g. 7d), download cached source to work_dir
   instead of yt-dlp. Skip the entire 8-tier client dance.
5. On miss: download as today, then upload source to cache (best-effort, non-blocking on failure).
6. Redis lock per youtube_id so two concurrent jobs for the same URL don't both download —
   second waits on first (reuse the cookie-refresh lock pattern at ~6023).

**Gotchas**
- Don't cache live/private/age-gated misses as success.
- Respect storage cost: TTL + a periodic prune task (Celery beat) for cache entries older than TTL.
- `won_client != "tv"` downgrade warning (5217) must still fire on cache hit if cached source was
  standard-quality — store won_client in cache metadata and replay the notification.

**Done when:** second job on a known URL skips yt-dlp entirely (log line confirms cache hit) and
produces identical output.

---

## Phase 2 — Residential proxy pool

**Why second:** biggest HD-quality win. Datacenter IPs (current `YTDLP_PROXY_LIST`) get 360p-capped
and bot-blocked fast — this is the likely root cause of `won_client != "tv"` downgrades. Needs a
vendor account (Bright Data / Oxylabs / IPRoyal), so it gates on procurement.

**Current state**
- `_ytdlp_proxies()` (video.py:3628) reads a static comma-list from env. No rotation intelligence,
  no health, no geo.
- Proxy selection: `_pick_proxy(attempt % len(proxies))` — round-robin only.

**Design**
1. Introduce a `ProxyProvider` abstraction (small, in its own module — seeds Phase 3 split):
   - `static` provider = today's env-list behavior (keep as fallback / dev).
   - `residential` provider = vendor gateway. Most residential vendors expose a single rotating
     gateway endpoint (`host:port` with session-id in the username), so rotation is server-side —
     we just vary the session token per attempt to force a fresh IP.
2. Geo control: pass country in the session username (e.g. `user-country-us-session-<rand>`) so we
   can match the video's region when geo-blocked.
3. Health/backoff: track per-session 429/bot-block rate in Redis; rotate session token on block
   instead of cycling a fixed list.
4. Keep client-major ordering (exhaust `tv` across fresh IPs first) — already correct at 4050-4056.
5. Config: `PROXY_PROVIDER=residential|static`, `RESIDENTIAL_PROXY_GATEWAY`, `RESIDENTIAL_PROXY_USER`,
   `RESIDENTIAL_PROXY_PASS`, `RESIDENTIAL_PROXY_COUNTRY`.

**Gotchas**
- Residential is metered by GB — combine with Phase 1 caching to avoid paying twice for same source.
- Per-attempt fresh session raises cost; cap attempts and lean on cache.
- Keep the static path working so local dev / CI doesn't need a paid account.

**Done when:** `tv` client win-rate on a test set of HD videos goes up materially vs datacenter
proxies, and downgrade notifications drop.

---

## Phase 3 — Split video.py

**Why last:** mechanical, no behavior change intended — do it once Phase 1/2 have stabilized the
download logic, so we're not refactoring a moving target. Also: Phases 1 & 2 each introduce a
natural module (`cache`, `proxies`) that seeds the split.

**Current state:** one ~6000-line file mixing download, proxy, cookies, AI clipping, ffmpeg render,
storage, Celery tasks. Violates CLAUDE.md <500-line rule; hard to debug when YouTube breaks
extraction (~monthly).

**Target layout** (under `workers/tasks/video/`)
- `download.py` — `_download_youtube`, client tiers, format probe, pytubefix/RapidAPI fallbacks.
- `proxies.py` — `ProxyProvider` (from Phase 2), `_ytdlp_proxies`.
- `cookies.py` — cookie file mgmt + `refresh_youtube_cookies` task.
- `cache.py` — source cache (from Phase 1).
- `render.py` — ffmpeg: transcode, caption burn, concat, enhance.
- `ai.py` — transcribe → viral-moment selection → clip metadata.
- `pipeline.py` — `run_video_pipeline` orchestration.
- `tasks.py` — Celery task entry points (`process_youtube_video`, etc.) + retry policy.
- `__init__.py` — re-export task symbols so Celery routing keys in `celery_app.py` stay valid.

**Gotchas**
- Celery routes reference `workers.tasks.video.<name>` (celery_app.py:45-59). Re-export from
  `__init__.py` to keep those import paths stable, OR update routes — pick one and verify beat +
  worker still register all tasks.
- Watch shared module-level constants (`VIDEO_TEMP_DIR`, cookie paths, client tier lists) — put in
  a small `config.py` to avoid circular imports.
- Pure move + re-export; no logic edits in this phase. Verify with a diff that only imports moved.

**Done when:** every file <500 lines, `celery -A ... inspect registered` lists all prior tasks,
a real YouTube job runs end-to-end unchanged.

---

## Sequencing summary

1. **Cache** — no deps, cuts load, makes proxy savings measurable. ~1-2 days.
2. **Residential proxies** — gated on vendor account; biggest quality win. ~2-3 days + procurement.
3. **Split** — mechanical, do once 1+2 stable. ~1 day.

Each phase ships independently and is reversible via env flag (cache TTL=0, PROXY_PROVIDER=static,
re-exports keep old import paths).
