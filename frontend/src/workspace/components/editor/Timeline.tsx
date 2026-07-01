import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { PaletteItem } from "./SoundEffectPalette";

export interface EffectMarker {
  id: string;
  timeMs: number;
  sound: string;
  emoji: string;
  label: string;
}

interface TimelineProps {
  duration: number;
  currentTime: number;
  markers: EffectMarker[];
  selectedEffect: PaletteItem;
  trimStart?: number;
  trimEnd?: number;
  onSeek: (timeSec: number) => void;
  onAddMarker: (timeMs: number) => void;
  onRemoveMarker: (id: string) => void;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function Timeline({
  duration,
  currentTime,
  markers,
  selectedEffect,
  trimStart,
  trimEnd,
  onSeek,
  onAddMarker,
  onRemoveMarker,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = duration > 0 ? currentTime / duration : 0;
  const ticks = duration > 0 ? Math.min(20, Math.floor(duration) + 1) : 0;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const { left, width } = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - left) / width));
    const timeSec = pct * duration;
    const timeMs = timeSec * 1000;

    // Check if near an existing marker — if so, let marker button handle it
    const hit = markers.find((m) => {
      const mPct = m.timeMs / (duration * 1000);
      return Math.abs(mPct - pct) < 0.02;
    });
    if (!hit) {
      onAddMarker(timeMs);
      onSeek(timeSec);
    }
  }

  if (duration <= 0) return (
    <div className="h-20 flex items-center justify-center text-c-text-muted text-[12px]">
      Load a video to see the timeline
    </div>
  );

  const trimStartPct = trimStart !== undefined ? (trimStart / duration) * 100 : null;
  const trimEndPct = trimEnd !== undefined ? (trimEnd / duration) * 100 : null;

  return (
    <div className="flex flex-col gap-1 px-4 pb-3 pt-2">
      {/* Label row */}
      <div className="flex items-center justify-between text-[10px] text-c-text-muted mb-1">
        <span>
          Click to place{" "}
          <span className="font-bold text-rose-400">
            {selectedEffect.emoji} {selectedEffect.label}
          </span>
          {" "}· click marker to remove
        </span>
        <span className="font-mono">{fmt(0)} – {fmt(duration)}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onClick={handleClick}
        className="relative h-16 cursor-crosshair overflow-hidden rounded-[10px] border border-c-border bg-surface-1 hover:border-[#ff3d6a]/20 select-none transition"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)" }}
      >
        {/* Tick grid */}
        {Array.from({ length: ticks }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-c-border"
            style={{ left: `${(i / Math.max(1, ticks - 1)) * 100}%` }}
          >
            {i > 0 && (
              <span className="absolute top-1 left-1 text-[8px] font-mono text-c-text-muted">
                {Math.round((i / (ticks - 1)) * duration)}s
              </span>
            )}
          </div>
        ))}

        {/* Trim region overlay */}
        {trimStartPct !== null && (
          <div
            className="absolute inset-y-0 left-0 bg-black/50 rounded-l-[10px]"
            style={{ width: `${trimStartPct}%` }}
          />
        )}
        {trimEndPct !== null && (
          <div
            className="absolute inset-y-0 right-0 bg-black/50 rounded-r-[10px]"
            style={{ width: `${100 - trimEndPct}%` }}
          />
        )}

        {/* Elapsed fill */}
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#ff3d6a]/10 to-transparent pointer-events-none"
          style={{ width: `${progress * 100}%` }}
        />

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-[#ff3d6a] pointer-events-none z-20"
          style={{ left: `${progress * 100}%` }}
        >
          <div className="absolute -top-px -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-[#ff3d6a] shadow-[0_0_6px_rgba(255,61,106,.8)]" />
        </div>

        {/* Markers */}
        {markers.map((m) => {
          const pct = duration > 0 ? (m.timeMs / (duration * 1000)) * 100 : 0;
          return (
            <div
              key={m.id}
              className="absolute top-0 bottom-0 flex flex-col items-center justify-center z-30"
              style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onRemoveMarker(m.id)}
                title={`${m.label} @ ${fmt(m.timeMs / 1000)} — click to remove`}
                className="flex flex-col items-center cursor-pointer hover:scale-125 active:scale-95 transition"
              >
                <span className="text-xl drop-shadow-lg leading-none">{m.emoji}</span>
                <div className="mt-0.5 h-3 w-px bg-[#ff3d6a]/70" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Markers list — compact */}
      {markers.length > 0 && (
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-c-text-muted font-semibold uppercase tracking-wide">
            {markers.length} effect{markers.length !== 1 ? "s" : ""}:
          </span>
          {[...markers].sort((a, b) => a.timeMs - b.timeMs).map((m) => (
            <button
              key={m.id}
              onClick={() => onRemoveMarker(m.id)}
              title="Click to remove"
              className={cn(
                "flex items-center gap-1 rounded-full border border-c-border bg-surface-1 px-2 py-0.5",
                "text-[10px] text-c-text-secondary hover:border-red-500/30 hover:text-red-400 transition cursor-pointer"
              )}
            >
              {m.emoji} {fmt(m.timeMs / 1000)} ✕
            </button>
          ))}
          <button
            onClick={() => markers.forEach((m) => onRemoveMarker(m.id))}
            className="text-[10px] text-c-text-muted hover:text-red-400 transition cursor-pointer ml-auto"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
