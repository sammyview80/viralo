# Ranking Guided Builder Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Ranking create page into a cleaner guided builder while preserving every existing feature and API behavior.

**Architecture:** Keep the redesign local to `frontend/src/workspace/pages/RankingPage.tsx`. Reuse the current state, API calls, SSE job tracking, validation, template controls, color controls, trim controls, upload/URL modes, preview, and list view; restructure only the create-view presentation into Sources, Style, and Review steps.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing `videoApi`, existing `TrimBar`, Vite frontend build.

---

## File Structure

- Modify: `frontend/src/workspace/pages/RankingPage.tsx`
  - Keep `RankingList`, `RankingCard`, `TemplatePicker`, `ColorCustomizer`, `MiniPreview`, `VideoTrimPreview`, `handleSuggest`, `handleGenerate`, and SSE behavior.
  - Add local builder UI types/state for step navigation and expanded clip state.
  - Split the create-view JSX into small internal helper components in the same file to avoid changing import boundaries.
  - Replace the current always-visible create layout with a guided builder layout:
    - left step navigation
    - center active-step content
    - right sticky preview/summary/action rail
- Test: no new test file unless the implementation extracts pure validation helpers. This is a UI-only restructure with existing runtime behavior preserved.

## Preserved Features Checklist

The implementation must preserve:

- Existing ranking list view and pagination.
- Existing empty state and `+ New Ranking` entry action.
- URL source mode.
- Upload source mode.
- Platform detection for YouTube and TikTok.
- URL preview behavior for direct video URLs.
- Message that YouTube/TikTok cannot be previewed inline.
- File preview and trim behavior.
- Start/end second numeric inputs.
- Clip labels.
- Add segment, remove segment, move segment up, move segment down.
- Minimum two-segment rule.
- Title field.
- AI title suggestion.
- All templates: `viral`, `classic`, `neon`, `minimal`.
- Color customization for background, title, accent, and number colors.
- Countdown and ascending order options.
- Phone preview.
- Error rendering.
- `videoApi.upload`, `videoApi.createRanking`, `videoApi.suggestRankingTitle`, and `videoApi.clips`.
- SSE progress tracking through `EventSource`.
- Job status, progress, ready, failed, dismiss, and view-link behavior.
- Return-to-list behavior after creating a ranking.

### Task 1: Add Builder Step State And Navigation Helpers

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:9-12`
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:634-644`

- [ ] **Step 1: Add builder step types near existing type aliases**

Add this below `type Order = "countdown" | "ascending";`:

```tsx
type BuilderStep = "sources" | "style" | "review";

const BUILDER_STEPS: Array<{
  id: BuilderStep;
  label: string;
  description: string;
}> = [
  { id: "sources", label: "Sources", description: "Add and trim ranked clips" },
  { id: "style", label: "Style", description: "Choose title, order, and template" },
  { id: "review", label: "Review", description: "Check details and generate" },
];
```

- [ ] **Step 2: Add state inside `CreateView`**

Add after the current `jobs` state:

```tsx
const [builderStep, setBuilderStep] = useState<BuilderStep>("sources");
const [expandedSegmentId, setExpandedSegmentId] = useState<string>(() => segments[0]?.id ?? "");
```

- [ ] **Step 3: Keep expanded segment valid when segments change**

Add after the preview URL cleanup effect:

```tsx
useEffect(() => {
  if (!segments.some((s) => s.id === expandedSegmentId)) {
    setExpandedSegmentId(segments[0]?.id ?? "");
  }
}, [segments, expandedSegmentId]);
```

- [ ] **Step 4: Add step navigation helpers inside `CreateView`**

Add after `const accent = templateConfig.accentColor;`:

```tsx
const currentStepIndex = BUILDER_STEPS.findIndex((step) => step.id === builderStep);
const canGoBackStep = currentStepIndex > 0;
const canGoNextStep = currentStepIndex < BUILDER_STEPS.length - 1;
const goToPreviousStep = () => {
  if (canGoBackStep) setBuilderStep(BUILDER_STEPS[currentStepIndex - 1].id);
};
const goToNextStep = () => {
  if (canGoNextStep) setBuilderStep(BUILDER_STEPS[currentStepIndex + 1].id);
};
```

- [ ] **Step 5: Run frontend type/build check**

Run:

```bash
cd frontend
npm run build
```

Expected: build succeeds. Existing Vite/Radix sourcemap warnings are acceptable if present.

### Task 2: Extract Reusable Preview And Job Strip Helpers

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:628-1078`

- [ ] **Step 1: Add a `RankingPhonePreview` helper above `CreateView`**

Move the existing preview markup from `CreateView` into this component:

```tsx
function RankingPhonePreview({
  title,
  segments,
  order,
  templateConfig,
}: {
  title: string;
  segments: Segment[];
  order: Order;
  templateConfig: TemplateConfig;
}) {
  return (
    <div
      className="relative h-72 w-40 overflow-hidden rounded-[14px] flex flex-col"
      style={{ background: templateConfig.bgColor, fontFamily: templateConfig.font }}
    >
      <p
        className="px-3 pt-3 text-center text-[11px] font-black leading-tight"
        style={{ color: templateConfig.titleColor }}
      >
        {title || "Your Title"}
      </p>
      <div className="flex flex-1 flex-col gap-2 px-3 pt-3">
        {segments.slice(0, 5).map((s, i) => {
          const rank = order === "countdown" ? segments.length - i : i + 1;
          const color = templateConfig.numberColors[i] ?? templateConfig.numberColors.at(-1)!;
          return (
            <div key={s.id} className="flex items-center gap-1.5">
              <span className="text-[15px] font-black leading-none" style={{ color }}>
                {rank}.
              </span>
              {s.segmentTitle && (
                <span className="truncate text-[9px] text-white/70">{s.segmentTitle}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a `RankingJobsStrip` helper above `CreateView`**

Move the current jobs panel markup into this component:

```tsx
function RankingJobsStrip({
  jobs,
  onDismiss,
}: {
  jobs: RankingJob[];
  onDismiss: (jobId: string) => void;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className="mb-5 rounded-[16px] border border-white/[.08] bg-white/[.025] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Ranking Jobs</h2>
        <span className="text-[11px] font-medium text-zinc-600">{jobs.length} active</span>
      </div>
      <div className="grid gap-2">
        {jobs.map((job) => (
          <div key={job.jobId} className="rounded-[12px] border border-white/[.07] bg-[#0b0f17] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-white">{job.label}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {job.failed ? "Failed" : job.done ? "Ready" : job.status}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {job.done && job.clipUrl && <ViewClipButton videoId={job.videoId} />}
                <button
                  onClick={() => onDismiss(job.jobId)}
                  className="grid h-7 w-7 place-items-center rounded-[8px] text-zinc-600 transition hover:bg-white/[.05] hover:text-zinc-300"
                  aria-label={`Dismiss ${job.label}`}
                >
                  x
                </button>
              </div>
            </div>
            {!job.done && !job.failed && (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.06]">
                  <div className="h-full rounded-full bg-[#ff3d6a] transition-all duration-500" style={{ width: `${job.progress}%` }} />
                </div>
                <p className="mt-1 text-right text-[10px] font-semibold text-zinc-500">{job.progress}%</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Fix `ViewClipButton` usage if needed**

If the existing `ViewClipButton` only fetches clip URL and the job already has `clipUrl`, either keep it for consistency or replace the link in `RankingJobsStrip` with:

```tsx
<a href={job.clipUrl} target="_blank" rel="noreferrer"
  className="rounded-[9px] bg-[#ff3d6a] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#e8304f]">
  View
</a>
```

Use the direct `job.clipUrl` link if avoiding a duplicate clip fetch is cleaner.

- [ ] **Step 4: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build succeeds.

### Task 3: Replace Create View Shell With Guided Builder Layout

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:794-1077`

- [ ] **Step 1: Replace the top-level `CreateView` return wrapper**

The create view should use this structure:

```tsx
return (
  <div className="mx-auto w-full max-w-[1240px] px-4 py-6">
    <RankingJobsStrip
      jobs={jobs}
      onDismiss={(jobId) => setJobs((prev) => prev.filter((j) => j.jobId !== jobId))}
    />

    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-[9px] border border-white/[.08] text-zinc-400 transition hover:bg-white/[.04] hover:text-white"
          aria-label="Back to rankings"
        >
          ←
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold text-white">New Video Ranking</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">Create a ranked countdown video from 2 or more clips</p>
        </div>
      </div>
    </div>

    <div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)_300px]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="grid gap-2 rounded-[16px] border border-white/[.08] bg-white/[.02] p-2">
          {BUILDER_STEPS.map((step, index) => {
            const active = step.id === builderStep;
            const complete = index < currentStepIndex;
            return (
              <button
                key={step.id}
                onClick={() => setBuilderStep(step.id)}
                className={cn(
                  "flex items-start gap-3 rounded-[11px] px-3 py-3 text-left transition",
                  active ? "bg-[#ff3d6a]/12 text-white ring-1 ring-[#ff3d6a]/25" : "text-zinc-400 hover:bg-white/[.04] hover:text-zinc-200"
                )}
              >
                <span className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                  active || complete ? "bg-[#ff3d6a] text-white" : "bg-white/[.06] text-zinc-500"
                )}>
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold">{step.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{step.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="min-w-0">
        {builderStep === "sources" && (
          <SourcesStep />
        )}
        {builderStep === "style" && (
          <StyleStep />
        )}
        {builderStep === "review" && (
          <ReviewStep />
        )}
      </main>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <BuilderRail />
      </aside>
    </div>
  </div>
);
```

- [ ] **Step 2: Define helper render functions inside `CreateView` before return**

Use local functions so they can access existing state and handlers without prop drilling:

```tsx
function SourcesStep() {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Source clips</h2>
          <p className="mt-1 text-[13px] text-zinc-500">Add clips in the order they should appear in the ranking.</p>
        </div>
        <button
          onClick={() => {
            const segment = newSegment();
            setSegments((prev) => [...prev, segment]);
            setExpandedSegmentId(segment.id);
          }}
          className="rounded-[11px] border border-white/[.1] bg-white/[.05] px-3 py-2 text-[12px] font-bold text-zinc-200 transition hover:bg-white/[.08]"
        >
          + Add Video ({segments.length} total)
        </button>
      </div>

      <div className="space-y-3">
        {segments.map((s, idx) => (
          <SegmentEditor key={s.id} segment={s} index={idx} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Move the old segment card body into `SegmentEditor`**

Create this local function and paste the existing per-segment UI into it. Preserve all controls and handlers from lines 870-973.

```tsx
function SegmentEditor({ segment: s, index: idx }: { segment: Segment; index: number }) {
  const rankLabel = order === "countdown" ? segments.length - idx : idx + 1;
  const platform = detectPlatform(s.url);
  const expanded = expandedSegmentId === s.id;

  return (
    <div className={cn(
      "rounded-[16px] border bg-white/[.02] transition",
      expanded ? "border-white/[.12]" : "border-white/[.07]"
    )}>
      <button
        type="button"
        onClick={() => setExpandedSegmentId(expanded ? "" : s.id)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: accent }}>
            #{rankLabel}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-white">{s.segmentTitle || `Video ${idx + 1}`}</span>
            <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
              {s.inputType === "upload" ? s.file?.name || "Upload file" : s.url || "URL source"} · {s.startSec}s-{s.endSec}s
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); moveSeg(idx, -1); }} disabled={idx === 0}
            className="grid h-7 w-7 place-items-center rounded-lg border border-white/[.08] text-zinc-400 transition hover:text-white disabled:opacity-30">↑</button>
          <button onClick={(e) => { e.stopPropagation(); moveSeg(idx, 1); }} disabled={idx === segments.length - 1}
            className="grid h-7 w-7 place-items-center rounded-lg border border-white/[.08] text-zinc-400 transition hover:text-white disabled:opacity-30">↓</button>
          {segments.length > 2 && (
            <button onClick={(e) => { e.stopPropagation(); removeSeg(s.id); }}
              className="grid h-7 w-7 place-items-center rounded-lg border border-red-400/20 text-red-400 transition hover:bg-red-400/[.08]">x</button>
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/[.07] px-4 pb-4 pt-3">
          {/* Paste the existing URL/upload toggle, source input, preview, label, and start/end controls here unchanged except for using `s` and `idx` from this helper. */}
        </div>
      )}
    </div>
  );
}
```

Implementation detail: replace the placeholder comment with the exact current controls from lines 894-972. Do not remove any control.

- [ ] **Step 4: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build succeeds.

### Task 4: Move Title, Template, Colors, And Order Into Style Step

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:983-1020`

- [ ] **Step 1: Add `StyleStep` local function inside `CreateView`**

Move the current right-side settings card into this function:

```tsx
function StyleStep() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">Style ranking</h2>
        <p className="mt-1 text-[13px] text-zinc-500">Set the title, visual template, colors, and ranking order.</p>
      </div>

      <div className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Title</span>
        <div className="mt-2 flex items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Top 5 ..." className={inputCls} />
          <button
            onClick={handleSuggest}
            disabled={suggestLoading}
            className="shrink-0 rounded-[11px] border border-white/[.1] bg-white/[.06] px-3 py-3 text-[13px] font-bold text-zinc-200 transition hover:bg-white/[.10] disabled:opacity-40"
          >
            {suggestLoading ? "..." : "AI"}
          </button>
        </div>
      </div>

      <div className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Template</span>
        <div className="mt-3">
          <TemplatePicker
            selected={templateId}
            onSelect={(id, config) => { setTemplateId(id); setTemplateConfig(config); }}
          />
        </div>
        <ColorCustomizer config={templateConfig} onChange={setTemplateConfig} />
      </div>

      <div className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Order</span>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button onClick={() => setOrder("countdown")}
            className={cn("rounded-[10px] border py-2 text-xs font-bold transition",
              order === "countdown" ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-white" : "border-white/[.08] text-zinc-400 hover:text-zinc-200")}>
            5 to 1 Countdown
          </button>
          <button onClick={() => setOrder("ascending")}
            className={cn("rounded-[10px] border py-2 text-xs font-bold transition",
              order === "ascending" ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-white" : "border-white/[.08] text-zinc-400 hover:text-zinc-200")}>
            1 to 5 Ascending
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Preserve exact handlers**

Confirm `handleSuggest`, `setTemplateId`, `setTemplateConfig`, `ColorCustomizer`, and `setOrder` are unchanged in behavior.

- [ ] **Step 3: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build succeeds.

### Task 5: Add Review Step And Sticky Builder Rail

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:1022-1073`

- [ ] **Step 1: Add `ReviewStep` local function inside `CreateView`**

```tsx
function ReviewStep() {
  const selectedTemplate = TEMPLATES.find((tpl) => tpl.id === templateId);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">Review ranking</h2>
        <p className="mt-1 text-[13px] text-zinc-500">Check the final setup before generating the ranking video.</p>
      </div>

      <div className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Title</span>
            <p className="mt-1 text-sm font-bold text-white">{title || "Top Ranking"}</p>
          </div>
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Style</span>
            <p className="mt-1 text-sm font-bold text-white">{selectedTemplate?.name ?? templateId} · {order === "countdown" ? "Countdown" : "Ascending"}</p>
          </div>
        </div>
      </div>

      <div className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Clips</span>
        <div className="mt-3 grid gap-2">
          {segments.map((s, idx) => {
            const rankLabel = order === "countdown" ? segments.length - idx : idx + 1;
            return (
              <button
                key={s.id}
                onClick={() => { setBuilderStep("sources"); setExpandedSegmentId(s.id); }}
                className="flex items-center justify-between gap-3 rounded-[11px] border border-white/[.07] bg-[#0b0f17] px-3 py-2.5 text-left transition hover:border-white/[.14]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: accent }}>
                    #{rankLabel}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-white">{s.segmentTitle || `Video ${idx + 1}`}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                      {s.inputType === "upload" ? s.file?.name || "Upload file" : s.url || "Missing URL"} · {s.startSec}s-{s.endSec}s
                    </span>
                  </span>
                </span>
                <span className="text-[11px] font-semibold text-zinc-500">Edit</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `BuilderRail` local function inside `CreateView`**

```tsx
function BuilderRail() {
  return (
    <div className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Preview</span>
        <span className="rounded-full border border-white/[.08] bg-white/[.03] px-2 py-0.5 text-[10px] font-bold text-zinc-500">9:16</span>
      </div>
      <div className="mt-4 flex justify-center">
        <RankingPhonePreview title={title} segments={segments} order={order} templateConfig={templateConfig} />
      </div>

      {error && (
        <div className="mt-4 rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-3 py-2 text-[12px] font-medium text-red-400">
          {error}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={goToPreviousStep}
          disabled={!canGoBackStep}
          className="rounded-[10px] border border-white/[.08] px-3 py-2 text-[12px] font-bold text-zinc-300 transition hover:bg-white/[.05] disabled:opacity-35"
        >
          Back
        </button>
        {builderStep !== "review" ? (
          <button
            onClick={goToNextStep}
            className="rounded-[10px] bg-[#ff3d6a] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#e8304f]"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-[10px] bg-[#ff3d6a] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#e8304f] disabled:opacity-60"
          >
            {generating ? "Submitting..." : "Generate"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Ensure generate remains review-only**

The final generate action should appear only in the rail when `builderStep === "review"`. Validation remains inside `handleGenerate`, unchanged.

- [ ] **Step 4: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build succeeds.

### Task 6: Clean Up Text, Alignment, And Mobile Behavior

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:794-1077`

- [ ] **Step 1: Check responsive layout classes**

Confirm the main builder grid stacks on mobile and becomes three columns on large screens:

```tsx
<div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)_300px]">
```

- [ ] **Step 2: Keep text inside controls short**

Use these labels:

```tsx
"Sources"
"Style"
"Review"
"Add Video"
"Continue"
"Back"
"Generate"
"Submitting..."
"URL"
"Upload file"
"Start (s)"
"End (s)"
```

- [ ] **Step 3: Remove duplicated old create-layout blocks**

Delete the old always-visible:

- jobs panel block from lines 796-851 after replacing it with `RankingJobsStrip`
- old two-column wrapper from lines 867-1075 after replacing it with the guided layout
- old duplicate preview card from lines 1022-1054 after replacing it with `RankingPhonePreview`
- old duplicate error block from lines 1056-1060 after moving error display into `BuilderRail`
- old duplicate generate button from lines 1062-1073 after moving generate into review rail

- [ ] **Step 4: Confirm no user-facing feature was removed**

Search manually in `RankingPage.tsx` for these strings and confirm they still appear where appropriate:

```bash
rg -n "suggestRankingTitle|createRanking|upload\\(|EventSource|TemplatePicker|ColorCustomizer|VideoTrimPreview|Add Video|Generate|Start \\(s\\)|End \\(s\\)|URL|Upload file" frontend/src/workspace/pages/RankingPage.tsx
```

Expected: every feature from the preserved checklist is still represented.

- [ ] **Step 5: Run final build**

Run:

```bash
cd frontend
npm run build
```

Expected: build succeeds. Existing sourcemap warnings are acceptable if the build exits successfully.

### Task 7: Optional Visual Verification

**Files:**
- No source edits unless a visual issue is found.

- [ ] **Step 1: Start dev server**

Run:

```bash
cd frontend
npm run dev
```

Expected: Vite serves the app locally.

- [ ] **Step 2: Inspect `/ranking` desktop**

Open `/ranking`, click `+ New Ranking`, and confirm:

- left step rail is aligned and does not wrap awkwardly
- center content changes between Sources, Style, and Review
- right preview rail is sticky on desktop
- source cards collapse/expand cleanly
- action buttons stay aligned

- [ ] **Step 3: Inspect `/ranking` mobile width**

Confirm:

- step rail stacks above content
- preview rail appears below content without overlap
- buttons and input labels fit within their containers
- no horizontal scrolling is introduced

- [ ] **Step 4: Commit only if requested**

Do not commit automatically unless the user asks. If committing later, stage only the Ranking redesign files and do not stage unrelated dirty files or ignored companion artifacts.

## Self-Review

- Spec coverage: The plan implements the selected Guided Builder direction and explicitly preserves all existing Ranking features.
- Placeholder scan: The only implementation note is the controlled instruction to paste the existing segment controls into `SegmentEditor`; this is intentional to preserve exact current behavior and avoid rewriting unrelated logic.
- Type consistency: `BuilderStep`, `BUILDER_STEPS`, `RankingPhonePreview`, `RankingJobsStrip`, local `SourcesStep`, `StyleStep`, `ReviewStep`, `BuilderRail`, and `SegmentEditor` all use existing local types and state names.
