# Ranking Video Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 visual templates (Viral, Classic, Neon, Minimal) to the ranking video creator with per-template color customization and an improved live preview showing a numbered list.

**Architecture:** Templates are defined as frontend constants with a `TemplateConfig` shape (bgColor, titleColor, accentColor, numberColors[], font). The selected template + config is sent to the backend as `template` + `template_config` fields on `CreateRankingRequest`, stored in `video_metadata`, and forwarded to the Celery worker. The frontend replaces the current 3-button theme picker with visual template cards + a color customizer panel.

**Tech Stack:** React 18, TypeScript, Tailwind CSS (frontend); FastAPI, Pydantic (backend).

## Global Constraints

- Keep all frontend changes in `frontend/src/workspace/pages/RankingPage.tsx` (single file, <500 lines — split is OK if it grows past that)
- Keep all backend changes in `services/video/video/routers/videos.py`
- No new npm packages
- `template_config` is stored as JSON in `video_metadata` alongside existing `theme`/`order` keys
- Existing `theme` field stays in the request for backward compat but is superseded by `template` when present
- All 4 templates must have exactly 5 `numberColors` entries (index 0 = rank 1)

---

### Task 1: Template types + constants in frontend

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx:8-41`

**Interfaces:**
- Produces:
  - `type TemplateId = "viral" | "classic" | "neon" | "minimal"`
  - `interface TemplateConfig { bgColor: string; titleColor: string; accentColor: string; numberColors: string[]; font: string }`
  - `const TEMPLATES: { id: TemplateId; name: string; desc: string; config: TemplateConfig }[]`
  - `const DEFAULT_CONFIG: Record<TemplateId, TemplateConfig>`

- [ ] **Step 1: Replace type + constant block**

Replace lines 8–41 in `RankingPage.tsx`:

```typescript
type View = "list" | "create";
type InputType = "url" | "upload";
type TemplateId = "viral" | "classic" | "neon" | "minimal";
type Order = "countdown" | "ascending";

interface TemplateConfig {
  bgColor: string;
  titleColor: string;
  accentColor: string;
  numberColors: string[]; // index 0 = rank-1 color
  font: string;
}

const TEMPLATES: { id: TemplateId; name: string; desc: string; config: TemplateConfig }[] = [
  {
    id: "viral",
    name: "Viral",
    desc: "Bold numbers, pure black",
    config: {
      bgColor: "#000000",
      titleColor: "#ffffff",
      accentColor: "#e53e3e",
      numberColors: ["#ffd700", "#9ca3af", "#f97316", "#ffffff", "#ffffff"],
      font: "Impact, Arial Black, sans-serif",
    },
  },
  {
    id: "classic",
    name: "Classic",
    desc: "Brand pink on dark",
    config: {
      bgColor: "#0a0d14",
      titleColor: "#ff3d6a",
      accentColor: "#ff3d6a",
      numberColors: ["#ff3d6a", "#ff3d6a", "#ff3d6a", "#ff3d6a", "#ff3d6a"],
      font: "Inter, sans-serif",
    },
  },
  {
    id: "neon",
    name: "Neon",
    desc: "Glowing cyan on dark",
    config: {
      bgColor: "#050d1a",
      titleColor: "#22d3ee",
      accentColor: "#a78bfa",
      numberColors: ["#22d3ee", "#a78bfa", "#22d3ee", "#a78bfa", "#22d3ee"],
      font: "Inter, sans-serif",
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "Clean white on black",
    config: {
      bgColor: "#000000",
      titleColor: "#ffffff",
      accentColor: "#d4d4d4",
      numberColors: ["#ffffff", "#d4d4d4", "#a3a3a3", "#737373", "#525252"],
      font: "Inter, sans-serif",
    },
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors referencing `THEME_COLOR` or `Theme` (the old names are gone).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/workspace/pages/RankingPage.tsx
git commit -m "feat(ranking): add TemplateId + TEMPLATES constant"
```

---

### Task 2: Update CreateView state — swap theme for templateId + templateConfig

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx` (CreateView function, ~line 459–470)

**Interfaces:**
- Consumes: `TemplateId`, `TemplateConfig`, `TEMPLATES` from Task 1
- Produces: `templateId: TemplateId` state, `templateConfig: TemplateConfig` state replacing `theme`

- [ ] **Step 1: Replace state declarations in CreateView**

Find this block (around line 459–465):
```typescript
  const [theme, setTheme] = useState<Theme>("classic");
```

Replace with:
```typescript
  const [templateId, setTemplateId] = useState<TemplateId>("viral");
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(TEMPLATES[0].config);
```

Also remove the `accent` constant at the bottom of CreateView (was `const accent = THEME_COLOR[theme]`). It will be `const accent = templateConfig.accentColor` — add this instead before the return statement.

- [ ] **Step 2: Update segment rank-badge color**

The rank badge inside each segment card uses `accent` as background color. This reference stays valid since `accent` is now `templateConfig.accentColor`. Verify the line:

```typescript
style={{ background: accent }}
```

still compiles after removing `THEME_COLOR`.

- [ ] **Step 3: Compile check**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workspace/pages/RankingPage.tsx
git commit -m "feat(ranking): swap theme state → templateId + templateConfig"
```

---

### Task 3: TemplatePicker component — visual cards replacing theme buttons

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx` (add component before CreateView; replace settings panel in JSX)

**Interfaces:**
- Consumes: `TEMPLATES`, `TemplateId`, `TemplateConfig`
- Produces: `function TemplatePicker(props: { selected: TemplateId; onSelect: (id: TemplateId, config: TemplateConfig) => void }): JSX.Element`

- [ ] **Step 1: Add TemplatePicker component**

Add this before the `CreateView` function:

```typescript
function MiniPreview({ config, title }: { config: TemplateConfig; title?: string }) {
  const nums = [1, 2, 3, 4, 5];
  return (
    <div
      className="relative h-24 w-14 overflow-hidden rounded-[8px] flex flex-col"
      style={{ background: config.bgColor, fontFamily: config.font }}
    >
      {/* Title */}
      <p
        className="px-1.5 pt-1.5 text-[6px] font-black leading-tight line-clamp-2"
        style={{ color: config.titleColor }}
      >
        {title || "Your Title"}
      </p>
      {/* Numbered list */}
      <div className="flex flex-col gap-[2px] px-1.5 pt-1 flex-1">
        {nums.map((n, i) => (
          <div key={n} className="flex items-center gap-0.5">
            <span
              className="text-[7px] font-black leading-none"
              style={{ color: config.numberColors[i] ?? config.numberColors.at(-1) }}
            >
              {n}.
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplatePicker({
  selected,
  onSelect,
}: {
  selected: TemplateId;
  onSelect: (id: TemplateId, config: TemplateConfig) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {TEMPLATES.map((tpl) => (
        <button
          key={tpl.id}
          onClick={() => onSelect(tpl.id, tpl.config)}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-[12px] border p-2.5 transition",
            selected === tpl.id
              ? "border-[#ff3d6a] bg-[#ff3d6a]/[.08]"
              : "border-white/[.08] hover:border-white/20"
          )}
        >
          <MiniPreview config={tpl.config} />
          <div className="text-center">
            <p className="text-[11px] font-bold text-zinc-200">{tpl.name}</p>
            <p className="text-[9.5px] text-zinc-500">{tpl.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Replace old theme picker in settings panel**

In the JSX of `CreateView`, find the theme picker block (~line 817–826):

```typescript
<span className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Theme</span>
<div className="mt-2 grid grid-cols-3 gap-2">
  {(["classic", "neon", "minimal"] as Theme[]).map((t) => (
    <button key={t} onClick={() => setTheme(t)}
      className={cn("rounded-[10px] border py-2 text-xs font-bold capitalize transition",
        theme === t ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-white" : "border-white/[.08] text-zinc-400 hover:text-zinc-200")}>
      {t}
    </button>
  ))}
</div>
```

Replace with:

```typescript
<span className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Template</span>
<div className="mt-2">
  <TemplatePicker
    selected={templateId}
    onSelect={(id, config) => { setTemplateId(id); setTemplateConfig(config); }}
  />
</div>
```

- [ ] **Step 3: Compile + visual check**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit 2>&1 | head -20
```

Open `http://localhost:5173` → Settings → navigate to Ranking → New Ranking. Confirm 4 template cards render in a 2×2 grid with mini previews.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workspace/pages/RankingPage.tsx
git commit -m "feat(ranking): add TemplatePicker with visual mini preview cards"
```

---

### Task 4: Color customizer panel

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx` (add ColorCustomizer component; insert in settings panel after TemplatePicker)

**Interfaces:**
- Consumes: `TemplateConfig`
- Produces: `function ColorCustomizer(props: { config: TemplateConfig; onChange: (config: TemplateConfig) => void }): JSX.Element`

- [ ] **Step 1: Add ColorCustomizer component**

Add after `TemplatePicker`:

```typescript
function ColorCustomizer({
  config,
  onChange,
}: {
  config: TemplateConfig;
  onChange: (c: TemplateConfig) => void;
}) {
  const field = (label: string, key: keyof TemplateConfig, value: string) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-zinc-500 min-w-0 flex-1">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <div
          className="h-5 w-5 rounded-[4px] border border-white/[.1] cursor-pointer"
          style={{ background: value }}
          onClick={() => {
            const el = document.getElementById(`color-${key}`);
            if (el) (el as HTMLInputElement).click();
          }}
        />
        <input
          id={`color-${key}`}
          type="color"
          value={value}
          className="sr-only"
          onChange={(e) => onChange({ ...config, [key]: e.target.value })}
        />
        <span className="font-mono text-[10px] text-zinc-500 w-14">{value}</span>
      </div>
    </div>
  );

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Customize</span>
      {field("Background", "bgColor", config.bgColor)}
      {field("Title", "titleColor", config.titleColor)}
      {field("Accent", "accentColor", config.accentColor)}
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Number colors</span>
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          {config.numberColors.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div
                className="h-5 w-5 rounded-full border border-white/[.1] cursor-pointer"
                style={{ background: c }}
                onClick={() => {
                  const el = document.getElementById(`color-num-${i}`);
                  if (el) (el as HTMLInputElement).click();
                }}
              />
              <input
                id={`color-num-${i}`}
                type="color"
                value={c}
                className="sr-only"
                onChange={(e) => {
                  const next = [...config.numberColors];
                  next[i] = e.target.value;
                  onChange({ ...config, numberColors: next });
                }}
              />
              <span className="text-[8px] text-zinc-600">#{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Insert ColorCustomizer into settings panel**

In CreateView JSX, after the `TemplatePicker` usage, insert:

```typescript
<ColorCustomizer
  config={templateConfig}
  onChange={setTemplateConfig}
/>
```

- [ ] **Step 3: Compile check**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit 2>&1 | head -20
```

Open the ranking creator. Verify color swatches appear below template cards, clicking a swatch opens native color picker, changing a color updates the customizer display.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workspace/pages/RankingPage.tsx
git commit -m "feat(ranking): add per-template color customizer"
```

---

### Task 5: Improved live preview — numbered list style

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx` (replace the preview card JSX inside CreateView)

**Interfaces:**
- Consumes: `templateConfig: TemplateConfig`, `title: string`, `segments: Segment[]`, `order: Order`

- [ ] **Step 1: Replace preview panel JSX**

Find the preview card block (~line 843–857):

```typescript
{/* Preview */}
<div className="flex flex-col items-center gap-3 rounded-[18px] border border-white/[.08] bg-white/[.02] p-5">
  <span className="self-start text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Preview</span>
  <div className="relative h-72 w-40 overflow-hidden rounded-[14px] bg-zinc-800">
    <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-zinc-500">Preview</div>
    <div className="absolute left-0 right-0 top-0 px-3 py-3 text-center text-sm font-bold leading-tight"
      style={{ color: accent, textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>
      {title || "Your Title"}
    </div>
    <div className="absolute bottom-3 left-3 rounded-lg px-2.5 py-1 text-sm font-extrabold text-white"
      style={{ background: accent }}>
      #{order === "countdown" ? segments.length : 1}
    </div>
  </div>
</div>
```

Replace with:

```typescript
{/* Preview */}
<div className="flex flex-col items-center gap-3 rounded-[18px] border border-white/[.08] bg-white/[.02] p-5">
  <span className="self-start text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Preview</span>
  <div
    className="relative h-72 w-40 overflow-hidden rounded-[14px] flex flex-col"
    style={{ background: templateConfig.bgColor, fontFamily: templateConfig.font }}
  >
    {/* Title */}
    <p
      className="px-3 pt-3 text-[11px] font-black leading-tight text-center"
      style={{ color: templateConfig.titleColor }}
    >
      {title || "Your Title"}
    </p>
    {/* Numbered list */}
    <div className="flex flex-col gap-2 px-3 pt-3 flex-1">
      {segments.slice(0, 5).map((s, i) => {
        const rank = order === "countdown" ? segments.length - i : i + 1;
        const color = templateConfig.numberColors[i] ?? templateConfig.numberColors.at(-1)!;
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <span className="text-[15px] font-black leading-none" style={{ color }}>
              {rank}.
            </span>
            {s.segmentTitle && (
              <span className="text-[9px] text-white/70 truncate">{s.segmentTitle}</span>
            )}
          </div>
        );
      })}
    </div>
  </div>
</div>
```

- [ ] **Step 2: Visual test**

Open ranking creator, add 3 segments. Verify preview shows numbered list with correct colors per template. Change template — preview updates immediately. Edit segment title — appears next to number.

- [ ] **Step 3: Compile check**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workspace/pages/RankingPage.tsx
git commit -m "feat(ranking): improve preview to show numbered list per template"
```

---

### Task 6: Wire template config into generate payload

**Files:**
- Modify: `frontend/src/workspace/pages/RankingPage.tsx` (`handleGenerate` function ~line 530)

**Interfaces:**
- Consumes: `templateId: TemplateId`, `templateConfig: TemplateConfig`

- [ ] **Step 1: Add template fields to payload**

In `handleGenerate`, find the payload object (~line 530):

```typescript
const payload = {
  title: title || "Top Ranking",
  theme,
  order,
  segments: await Promise.all(...)
};
```

Replace with:

```typescript
const payload = {
  title: title || "Top Ranking",
  theme: templateId,        // backward compat field
  template: templateId,
  template_config: templateConfig,
  order,
  segments: await Promise.all(
    segments.map(async (s) => {
      if (s.inputType === "upload") {
        let vid = s.videoId;
        if (!vid && s.file) {
          const up = await videoApi.upload(s.file, s.file.name);
          vid = up.id;
          updateSeg(s.id, { videoId: vid });
        }
        return { source_type: "upload", video_id: vid, start_sec: s.startSec, end_sec: s.endSec, segment_title: s.segmentTitle };
      }
      return { source_type: "url", url: s.url.trim(), start_sec: s.startSec, end_sec: s.endSec, segment_title: s.segmentTitle };
    })
  ),
};
```

- [ ] **Step 2: Compile check**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/workspace/pages/RankingPage.tsx
git commit -m "feat(ranking): pass template + template_config in generate payload"
```

---

### Task 7: Backend — accept + store template and template_config

**Files:**
- Modify: `services/video/video/routers/videos.py:1196–1268`

**Interfaces:**
- Consumes: frontend payload `{ template: str, template_config: dict, theme: str, ... }`
- Produces: `video_metadata` includes `template`, `template_config`, `segment_count`; celery task receives `template` + `template_config` args

- [ ] **Step 1: Extend CreateRankingRequest**

Find `CreateRankingRequest` (~line 1196):

```python
class CreateRankingRequest(_BaseModel):
    title: str
    theme: str = "classic"
    order: str = "countdown"  # "countdown" or "ascending"
    segments: list[RankingSegmentRequest]
```

Replace with:

```python
class CreateRankingRequest(_BaseModel):
    title: str
    theme: str = "classic"                   # kept for backward compat
    template: str = "viral"
    template_config: dict | None = None
    order: str = "countdown"
    segments: list[RankingSegmentRequest]
```

- [ ] **Step 2: Relax theme validation + add template validation**

Find (~line 1216):
```python
    if req.theme not in ("classic", "neon", "minimal"):
        raise HTTPException(status_code=400, detail="invalid theme")
```

Replace with:

```python
    VALID_TEMPLATES = ("viral", "classic", "neon", "minimal")
    effective_template = req.template if req.template in VALID_TEMPLATES else req.theme
    if effective_template not in VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="invalid template")
```

- [ ] **Step 3: Store template + template_config in video_metadata**

Find (~line 1244):
```python
        video_metadata={"title": req.title, "theme": req.theme, "order": req.order},
```

Replace with:

```python
        video_metadata={
            "title": req.title,
            "theme": effective_template,
            "template": effective_template,
            "template_config": req.template_config,
            "order": req.order,
            "segment_count": len(req.segments),
        },
```

- [ ] **Step 4: Pass template to celery task**

Find (~line 1263–1265):
```python
    celery_app.send_task(
        "workers.tasks.video.generate_video_ranking",
        args=[str(tenant_id), str(video_id), segments, req.title, req.theme, req.order],
        task_id=job_id,
    )
```

Replace with:

```python
    celery_app.send_task(
        "workers.tasks.video.generate_video_ranking",
        args=[str(tenant_id), str(video_id), segments, req.title, effective_template, req.order],
        kwargs={"template_config": req.template_config},
        task_id=job_id,
    )
```

- [ ] **Step 5: Rebuild + smoke test**

```bash
docker compose up -d --build video-service 2>&1 | tail -5
sleep 8 && docker ps --filter name=viralo-video --format "{{.Status}}"
```

Expected: `Up N seconds (healthy)`

Manual smoke test: open ranking creator, select "Neon" template, change accent color, click Generate. Backend should accept the request (202) without validation error.

- [ ] **Step 6: Commit**

```bash
git add services/video/video/routers/videos.py
git commit -m "feat(ranking): accept template + template_config in backend, store in metadata"
```

---

### Task 8: Final integration + push

- [ ] **Step 1: Full compile**

```bash
cd /Users/saman/Documents/personal/viralo/frontend && npx tsc --noEmit
```

- [ ] **Step 2: End-to-end test**

1. Open `http://localhost:5173` → Ranking → New Ranking
2. Add 2 segments (any URLs)
3. Select "Viral" template — mini cards should show yellow/gray/orange numbers
4. Customize accent color — preview updates in real time
5. Select "Neon" — number circles in picker change to cyan/purple
6. Click Generate — check Network tab: request body contains `template: "neon"` and `template_config: { bgColor: ... }`
7. Backend returns 202 (not 400)

- [ ] **Step 3: Push**

```bash
git push origin dev
```

---

## Self-Review

**Spec coverage check:**
- ✅ 4 templates (Viral, Classic, Neon, Minimal) — Tasks 1, 3
- ✅ Visual template picker with mini previews — Task 3
- ✅ Customizable colors per template — Task 4
- ✅ Improved live preview with numbered list — Task 5
- ✅ Template config sent to backend — Tasks 6, 7
- ✅ Backend stores template_config in metadata — Task 7
- ✅ Celery worker receives template (existing worker signature extended) — Task 7

**Placeholder scan:** None found. All steps have exact code.

**Type consistency:**
- `TemplateId` defined Task 1, used Tasks 2–6 ✅
- `TemplateConfig` defined Task 1, produced by `TemplatePicker` (Task 3), consumed by `ColorCustomizer` (Task 4) and preview (Task 5) ✅
- `templateId` / `templateConfig` state defined Task 2, used Tasks 3–6 ✅
- Backend `effective_template` defined Step 2 Task 7, used Steps 3–4 Task 7 ✅
