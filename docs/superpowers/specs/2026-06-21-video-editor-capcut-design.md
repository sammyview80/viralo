# Video Editor — CapCut Redesign & Component Extraction

**Date:** 2026-06-21

## Goal

Redesign `VideoEditor.tsx` into a professional CapCut-like layout with reusable extracted components. Each component works standalone so e.g. `TrimBar` can be dropped into RankingPage without the full editor.

## Layout (bottom-timeline, CapCut style)

```
┌──────────────────────────────────────────────────────┐
│  ← Video Editor  [BETA]         [Save][Post][Export] │  header
├─────────────────────────┬────────────────────────────┤
│                         │  [Trim][Captions][Effects] │  tool tabs
│    VideoPlayer          │  ──────────────────────    │
│    (9:16, canvas        │  <TrimBar />               │  tab content
│     overlay, controls)  │   or <CaptionEditor />     │
│                         │   or <SoundEffectPalette/> │
├─────────────────────────┴────────────────────────────┤
│  <Timeline /> — full width, playhead + markers       │  bottom
└──────────────────────────────────────────────────────┘
```

## New Components — `components/editor/`

| File | Props | Standalone |
|------|-------|------------|
| `VideoPlayer.tsx` | videoRef, canvasRef, playing, currentTime, duration, onTogglePlay, onSeekDelta | yes |
| `TrimBar.tsx` | duration, startSec, endSec, onChange(s,e) | **yes** |
| `Timeline.tsx` | duration, currentTime, markers, selectedEffect, onSeek, onAddMarker, onRemoveMarker | no |
| `CaptionEditor.tsx` | captions, onChange | yes |
| `SoundEffectPalette.tsx` | selected, onSelect | yes |

## Caption Data Shape

```ts
interface Caption {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  position: "top" | "center" | "bottom";
  color: string;  // hex
  fontSize: number; // 12–48
}
```

Canvas render loop reads active captions at current time and draws text overlay.

## TrimBar Standalone Usage

```tsx
import { TrimBar } from "@/workspace/components/editor/TrimBar";

<TrimBar
  duration={120}
  startSec={10}
  endSec={45}
  onChange={(start, end) => setSeg({ startSec: start, endSec: end })}
/>
```

No timeline, no effects, no audio — just the dual-handle range UI.

## Files Changed

- Create: `frontend/src/workspace/components/editor/VideoPlayer.tsx`
- Create: `frontend/src/workspace/components/editor/TrimBar.tsx`
- Create: `frontend/src/workspace/components/editor/Timeline.tsx`
- Create: `frontend/src/workspace/components/editor/CaptionEditor.tsx`
- Create: `frontend/src/workspace/components/editor/SoundEffectPalette.tsx`
- Create: `frontend/src/workspace/components/editor/COMPONENTS.md`
- Modify: `frontend/src/workspace/components/VideoEditor.tsx` (compose sub-components, new layout)
- Modify: `frontend/src/workspace/pages/RankingPage.tsx` (swap VideoTrimPreview → TrimBar)

## Preserved

- All sound synthesis logic (`synthSound`)
- MediaRecorder export pipeline
- Save/Post/Export header buttons and their handlers
- Marker add/remove logic
- Canvas rendering frame loop
- `createPortal` fullscreen overlay
