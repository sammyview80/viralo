# Scheduler URL State & Calendar UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync SchedulerPage view state (tab, month, platform filter, status filter) to URL search params, fix 42-cell calendar grid, and show month nav in both tabs.

**Architecture:** Extend `lib/router.ts` with a `useSearchParams` hook (same pattern as existing `usePathname`). Replace `useState` for view state in `SchedulerPage` with URL-backed state. Calendar grid bumped from 35 to 42 cells. Month navigation moved to header so it's visible in both tabs. All existing features preserved.

**Tech Stack:** React, TypeScript, `window.history.pushState`, `URLSearchParams`, Tailwind CSS

## Global Constraints

- No new npm dependencies
- All existing SchedulerPage features preserved (DayDrawer, PostPopover, ScheduleModal, PostsListView, sidebar, color maps)
- File must stay under 500 lines — SchedulerPage.tsx is already 1472 lines; do not add significant length
- Follow existing dark theme tokens (`#0e1420`, `#0b101a`, `[#ff3d6a]`, `zinc-*`)

---

### Task 1: Add `useSearchParams` hook to `lib/router.ts`

**Files:**
- Modify: `frontend/src/lib/router.ts`

**Interfaces:**
- Produces: `useSearchParams(): [URLSearchParams, (key: string, value: string) => void, (key: string) => void]`
  - `params` — current search params
  - `setParam(key, value)` — sets one param, pushes to history
  - `deleteParam(key)` — removes one param, pushes to history

- [ ] **Step 1: Read current file**

Read `frontend/src/lib/router.ts` to confirm current content before editing.

- [ ] **Step 2: Add `useSearchParams` hook**

Append to `frontend/src/lib/router.ts`:

```typescript
export function useSearchParams(): [
  URLSearchParams,
  (key: string, value: string) => void,
  (key: string) => void,
] {
  const [search, setSearch] = useState(window.location.search);

  useEffect(() => {
    const handler = () => setSearch(window.location.search);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(window.location.search);
    p.set(key, value);
    history.pushState(null, "", `${window.location.pathname}?${p.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const deleteParam = (key: string) => {
    const p = new URLSearchParams(window.location.search);
    p.delete(key);
    const qs = p.toString();
    history.pushState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return [new URLSearchParams(search), setParam, deleteParam];
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from `lib/router.ts`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/router.ts
git commit -m "feat(router): add useSearchParams hook"
```

---

### Task 2: Wire URL state into SchedulerPage

**Files:**
- Modify: `frontend/src/workspace/pages/SchedulerPage.tsx`

**Interfaces:**
- Consumes: `useSearchParams` from `@/lib/router`
- URL params used:
  - `tab` — `"calendar"` | `"posts"` (default: `"calendar"`)
  - `month` — `"YYYY-MM"` (default: current month)
  - `platform` — platform id or `"all"` (default: `"all"`)
  - `status` — status id or `"all"` (default: `"all"`)

- [ ] **Step 1: Add import**

In `SchedulerPage.tsx`, add `useSearchParams` to the router import:

```typescript
import { useSearchParams } from "@/lib/router";
```

- [ ] **Step 2: Replace view state with URL-backed state inside `SchedulerPage()`**

Replace the existing `useState` declarations for `year`, `month`, `activeTab`, `platformFilter`, `statusFilter`, `postsListFilter` with:

```typescript
const [params, setParam] = useSearchParams();

// Derive tab
const activeTab = (params.get("tab") === "posts" ? "posts" : "calendar") as "calendar" | "posts";
const setActiveTab = (t: "calendar" | "posts") => setParam("tab", t);

// Derive month/year from ?month=YYYY-MM
const monthParam = params.get("month");
const parsedMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
  ? { year: parseInt(monthParam.slice(0, 4)), month: parseInt(monthParam.slice(5, 7)) - 1 }
  : { year: now.getFullYear(), month: now.getMonth() };
const year = parsedMonth.year;
const month = parsedMonth.month;

const setYearMonth = (y: number, m: number) =>
  setParam("month", `${y}-${pad(m + 1)}`);

// Derive platform + status filters
const platformFilter = params.get("platform") ?? "all";
const setPlatformFilter = (v: string) => setParam("platform", v);

const statusFilter = params.get("status") ?? "all";
const setStatusFilter = (v: string) => setParam("status", v);

// postsListFilter: separate from calendar statusFilter — driven by same ?status param when on posts tab
const postsListFilter = params.get("status") ?? "active";
const setPostsListFilter = (v: string) => setParam("status", v);
```

- [ ] **Step 3: Update `prevMonth` / `nextMonth`**

Replace:
```typescript
function prevMonth() {
  if (month === 0) { setYear((y) => y - 1); setMonth(11); }
  else setMonth((m) => m - 1);
}

function nextMonth() {
  if (month === 11) { setYear((y) => y + 1); setMonth(0); }
  else setMonth((m) => m + 1);
}
```

With:
```typescript
function prevMonth() {
  if (month === 0) setYearMonth(year - 1, 11);
  else setYearMonth(year, month - 1);
}

function nextMonth() {
  if (month === 11) setYearMonth(year + 1, 0);
  else setYearMonth(year, month + 1);
}
```

- [ ] **Step 4: Remove old `useState` declarations**

Delete these lines (they are replaced by URL-backed derivations above):
```typescript
const [year, setYear] = useState(now.getFullYear());
const [month, setMonth] = useState(now.getMonth());
const [platformFilter, setPlatformFilter] = useState<string>("all");
const [statusFilter, setStatusFilter] = useState<string>("all");
const [activeTab, setActiveTab] = useState<"calendar" | "posts">("calendar");
const [postsListFilter, setPostsListFilter] = useState<string>("active");
```

- [ ] **Step 5: Move month nav outside calendar-only block**

In the header JSX, the month nav is currently inside:
```tsx
{activeTab === "calendar" && (
  <div className="flex items-center justify-between gap-2 sm:justify-start">
    ...
  </div>
)}
```

Remove the `{activeTab === "calendar" && ...}` guard so month nav always shows:
```tsx
<div className="flex items-center justify-between gap-2 sm:justify-start">
  <button onClick={prevMonth} className="rounded-lg border border-white/[.07] bg-[#141926] px-2.5 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition">‹</button>
  <span className="min-w-0 flex-1 text-center text-sm font-semibold text-zinc-200 sm:min-w-[150px] sm:flex-none">{monthName} {year}</span>
  <button onClick={nextMonth} className="rounded-lg border border-white/[.07] bg-[#141926] px-2.5 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition">›</button>
</div>
```

- [ ] **Step 6: Fix DayDrawer `onStatusClick` to use new setters**

The existing call:
```tsx
onStatusClick={(status) => {
  setPostsListFilter(status);
  setActiveTab("posts");
}}
```
Now `setPostsListFilter` and `setActiveTab` are the URL-backed setters — no change needed to call site, just verify it still compiles.

- [ ] **Step 7: TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/workspace/pages/SchedulerPage.tsx
git commit -m "feat(scheduler): sync tab/month/filter state to URL params"
```

---

### Task 3: Fix 42-cell calendar grid

**Files:**
- Modify: `frontend/src/workspace/pages/SchedulerPage.tsx`

**Interfaces:**
- Consumes: `year`, `month`, `daysInMonth`, `firstDay` (same as existing)
- Change: `cells` array from 35 to 42 entries max (trim trailing empty rows only if not needed)

- [ ] **Step 1: Replace 35-cell grid with 42-cell**

Find:
```typescript
const cells: Array<{ day: number | null; ymd: string | null }> = [];
for (let i = 0; i < 35; i++) {
  const dayNum = i - firstDay + 1;
  if (dayNum < 1 || dayNum > daysInMonth) {
    cells.push({ day: null, ymd: null });
  } else {
    cells.push({ day: dayNum, ymd: toYMD(year, month, dayNum) });
  }
}
```

Replace with:
```typescript
const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
const cells: Array<{ day: number | null; ymd: string | null }> = [];
for (let i = 0; i < totalCells; i++) {
  const dayNum = i - firstDay + 1;
  if (dayNum < 1 || dayNum > daysInMonth) {
    cells.push({ day: null, ymd: null });
  } else {
    cells.push({ day: dayNum, ymd: toYMD(year, month, dayNum) });
  }
}
```

This computes exactly how many rows are needed (5 or 6) and generates only those cells.

- [ ] **Step 2: Update skeleton loader cell count**

Find:
```tsx
{Array.from({ length: 35 }).map((_, i) => (
```

Replace with:
```tsx
{Array.from({ length: totalCells }).map((_, i) => (
```

Note: `totalCells` must be computed before the return statement (it already is after Step 1).

- [ ] **Step 3: TypeScript compile check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workspace/pages/SchedulerPage.tsx
git commit -m "fix(scheduler): use dynamic cell count for 5 or 6 row calendar months"
```

---

## Self-Review

**Spec coverage:**
- ✅ URL params for tab, month, platform, status — Task 2
- ✅ Month nav in both tabs — Task 2 Step 5
- ✅ 42-cell grid — Task 3
- ✅ All existing features preserved — no deletions, only targeted replacements
- ✅ `useSearchParams` hook — Task 1

**Placeholder scan:** None found. All steps have concrete code.

**Type consistency:**
- `useSearchParams` returns `[URLSearchParams, setParam, deleteParam]` — Task 1 defines, Task 2 consumes `[params, setParam]` (ignores `deleteParam`) — consistent.
- `setYearMonth(y, m)` defined and used in `prevMonth`/`nextMonth` — consistent.
- `totalCells` defined in grid build, referenced in skeleton loader — consistent.
