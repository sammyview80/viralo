# Scheduler — URL State & Calendar UX

**Date:** 2026-06-21

## Problem

1. Tab/filter/month state lost on refresh — no URL persistence
2. Month navigation hidden inside calendar tab only
3. Calendar 35-cell grid breaks months that need 6 rows (42 cells)
4. "All Posts" tab shows correct data but month context unclear

## Goals

- URL params drive all major view state (tab, month, platform, status)
- Month nav visible in both Calendar and Posts tabs
- Calendar handles all months correctly (42 cells max)
- All existing features preserved exactly

## Architecture

### `lib/router.ts` — add `useSearchParams`

New hook mirrors `usePathname` pattern:
- Reads `window.location.search` via `URLSearchParams`
- Listens to `popstate`
- Returns `[params, setParam]` where `setParam(key, value)` calls `history.pushState` + dispatches `popstate`

### `SchedulerPage.tsx` — URL-driven state

Replace `useState` for view state with URL-synced equivalents:

| State | URL param | Default |
|-------|-----------|---------|
| `activeTab` | `tab` | `calendar` |
| `year` + `month` | `month` (YYYY-MM) | current month |
| `platformFilter` | `platform` | `all` |
| `statusFilter` | `status` | `all` |
| `postsListFilter` | `status` | `active` (Posts tab) |

Internal state (no URL): `calendarData`, `accounts`, `loading`, `selectedPost`, `showModal`, `expandedDay`.

### Calendar grid fix

Change `35` → `42` cells. Grid always renders 6 rows. Empty tail cells render transparent (same as leading empty cells).

### Month nav placement

Move month nav out of `{activeTab === "calendar" && ...}` block into main header — visible always.

## Preserved Features (complete list)

- DayDrawer: time grid, drag-resize, expand fullscreen, overflow chip, status click → Posts tab
- PostPopover: cancel confirm, publish now, posted/failed state display
- ScheduleModal: YouTube kwargs, hashtags, all platform fields
- PostsListView: status chips + counts, platform chips, sort, pagination, inline cancel
- Calendar: CAL_PILL colors, today highlight, failed-day border, platform pills, "+N more" button
- Left sidebar: platform filter, status filter, connected accounts
- All color maps (PLATFORM_COLORS, PLATFORM_DOT, STATUS_COLORS, PILL_COLORS, CAL_PILL, ACCENT_*)
- loadData, handleSchedule, onCancelled, onPublished mutations

## Out of Scope

- Cross-month post history API
- New schedule form improvements
- Analytics or bulk actions
