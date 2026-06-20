# Editor Components

Reusable video editing components. Each works standalone — import only what you need.

---

## TrimBar

Dual-handle trim bar. No video, no audio — just the UI.

```tsx
import { TrimBar } from "@/workspace/components/editor/TrimBar";

<TrimBar
  duration={120}        // total video duration in seconds
  startSec={10}         // current trim start
  endSec={45}           // current trim end
  onChange={(start, end) => setSeg({ startSec: start, endSec: end })}
  className="mt-2"      // optional
/>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `duration` | `number` | Total video length (seconds) |
| `startSec` | `number` | Trim start position |
| `endSec` | `number` | Trim end position |
| `onChange` | `(s: number, e: number) => void` | Called on drag |
| `className` | `string?` | Extra CSS classes |

Returns `null` when `duration <= 0`.

---

## VideoPlayer

Video preview with play/pause, ±5s skip, and canvas overlay.

```tsx
import { VideoPlayer } from "@/workspace/components/editor/VideoPlayer";

<VideoPlayer
  videoRef={videoRef}
  canvasRef={canvasRef}
  playing={playing}
  currentTime={currentTime}
  duration={duration}
  storageUrl={clip.storage_url}
  thumbnailUrl={clip.thumbnail_url}
  onTogglePlay={togglePlay}
  onSeekDelta={(delta) => { videoRef.current.currentTime += delta; }}
  onTimeUpdate={setCurrentTime}
  onEnded={() => setPlaying(false)}
  onLoadedMetadata={(d) => setDuration(d)}
/>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `videoRef` | `RefObject<HTMLVideoElement>` | Ref for video element |
| `canvasRef` | `RefObject<HTMLCanvasElement>` | Ref for canvas overlay |
| `playing` | `boolean` | Playback state |
| `currentTime` | `number` | Current position (seconds) |
| `duration` | `number` | Total duration (seconds) |
| `storageUrl` | `string?` | Video src URL |
| `thumbnailUrl` | `string?` | Poster image URL |
| `onTogglePlay` | `() => void` | Play/pause handler |
| `onSeekDelta` | `(delta: number) => void` | Seek by ±5s |
| `onTimeUpdate` | `(t: number) => void` | Time update callback |
| `onEnded` | `() => void` | Video ended callback |
| `onLoadedMetadata` | `(duration: number) => void` | Duration loaded |

---

## CaptionEditor

Add/edit/delete text caption overlays. Emits a `Caption[]` array.

```tsx
import { CaptionEditor, type Caption } from "@/workspace/components/editor/CaptionEditor";

const [captions, setCaptions] = useState<Caption[]>([]);

<CaptionEditor
  captions={captions}
  duration={duration}
  onChange={setCaptions}
/>
```

**Caption shape:**
```ts
interface Caption {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  position: "top" | "center" | "bottom";
  color: string;     // hex e.g. "#ffffff"
  fontSize: number;  // 12–48
}
```

**Render captions on canvas:**
```ts
for (const cap of captions) {
  if (nowSec >= cap.startSec && nowSec <= cap.endSec) {
    const y = cap.position === "top" ? H * 0.1 : cap.position === "center" ? H * 0.5 : H * 0.88;
    ctx.font = `bold ${cap.fontSize}px sans-serif`;
    ctx.fillStyle = cap.color;
    ctx.fillText(cap.text, W / 2, y);
  }
}
```

---

## SoundEffectPalette

Grid of sound effect chips. Emits selected item.

```tsx
import { SoundEffectPalette, PALETTE, type PaletteItem } from "@/workspace/components/editor/SoundEffectPalette";

const [selected, setSelected] = useState<PaletteItem>(PALETTE[0]);

<SoundEffectPalette
  selected={selected}
  onSelect={setSelected}
/>
```

**`PALETTE`** is exported as a constant — 12 items (Quack, Applause, Ding, Airhorn, Womp, Tada, Fire, Love, 100, Dead, Zap, Rocket).

---

## Timeline

Full-width scrollable time ruler with playhead, effect markers, and optional trim region overlay.

```tsx
import { Timeline, type EffectMarker } from "@/workspace/components/editor/Timeline";

<Timeline
  duration={duration}
  currentTime={currentTime}
  markers={markers}
  selectedEffect={selected}
  trimStart={trimStart}      // optional — dims region before this
  trimEnd={trimEnd}          // optional — dims region after this
  onSeek={(t) => { videoRef.current.currentTime = t; }}
  onAddMarker={(timeMs) => addMarker(timeMs)}
  onRemoveMarker={(id) => removeMarker(id)}
/>
```

**EffectMarker shape:**
```ts
interface EffectMarker {
  id: string;
  timeMs: number;
  sound: string;
  emoji: string;
  label: string;
}
```

---

## Minimal standalone example — trim only

```tsx
import { useState } from "react";
import { TrimBar } from "@/workspace/components/editor/TrimBar";

export function TrimOnly({ duration }: { duration: number }) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);

  return (
    <TrimBar
      duration={duration}
      startSec={start}
      endSec={end}
      onChange={(s, e) => { setStart(s); setEnd(e); }}
    />
  );
}
```
