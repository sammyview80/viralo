# Brainstorm Page Redesign

**Date:** 2026-06-20  
**File:** `frontend/src/workspace/pages/BrainstormPage.tsx`  
**Problem:** Page is cluttered — 5 stacked cards with overlapping info, busy agent grid, no clear hierarchy.

---

## Goal

Reduce visual clutter and establish clear information hierarchy using a tabbed detail layout.

---

## Layout

```
┌──────────────┬──────────────────────────────────────────────┐
│  Sidebar     │  Session title  [status]  ████░░ 60%         │
│  ─────────── │  ──────────────────────────────────────────  │
│  New         │  [Overview]  [Ideas 10]  [Full Analysis]     │
│  Brainstorm  │                                              │
│  ─────────── │  (tab content)                               │
│  Sessions    │                                              │
│  list        │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

---

## Sidebar

- Remove the 3 stats counters (Sessions / Done / Running) from page header — low-value noise
- Input card and sessions list unchanged structurally
- Sidebar header simplified: title + description only

---

## Session Detail Header Strip

Replaces the current large `bg-gradient-to-br` card wrapper. Lean strip with:
- Session topic as `h2`
- Status badge (existing `statusClasses` helper)
- Created-at timestamp
- Progress bar + percentage
- Retry button (if failed)

No card wrapper — just padding + bottom border.

---

## Tabs

Three tabs rendered below the header strip.

### Tab 1 — Overview (default)

**Agent stepper** (top, full-width):
- Horizontal row of 7 steps
- Each step: number dot + label + status (queued / active / done)
- Active step pulses; done step shows checkmark
- Replaces current `AgentSteps` 3-col card grid

**2-col section below stepper:**
- Left (60%): Stats — avg virality score badge, idea count, strong-bet count, dominant format
- Right (40%): Active agent description when running ("Viral Search — Finding live YouTube signals…")

**Verdict brief** (below 2-col, full-width):
- Shows when `niche_verdict` exists
- Title + 2-sentence executive read + watch-out + suggested move
- No expand/collapse toggle (full text lives in Tab 3)

**While running with no ideas yet:** Show spinner + "Agents are researching…" message in place of verdict brief.

### Tab 2 — Ideas `[N]`

- Full-width 2-col grid of `IdeaCard` components (unchanged)
- Tab badge shows count: `Ideas 10`
- Tab grayed + badge shows "…" while running
- Empty state if complete but no ideas

### Tab 3 — Full Analysis

- Full raw `niche_verdict` text in readable prose block
- Each completed agent listed with its label + description
- Tab disabled while running

---

## Components Changed

| Component | Change |
|-----------|--------|
| `BrainstormPage` | Remove header stats; add tab state; restructure detail panel |
| `AgentSteps` | Rewrite as horizontal stepper |
| `ResultsOverview` | Dissolve into Overview tab sections |
| `VerdictCard` | Split: brief goes into Overview tab; full text goes into Full Analysis tab |
| `SessionRow` | No change |
| `IdeaCard` | No change |
| `EmptyState` | No change |

---

## Behavior

- Default tab on session select: Overview
- Tab selection persists while same session is selected; resets on session change
- Ideas tab count badge updates live during polling
- Full Analysis tab disabled (not hidden) while running
