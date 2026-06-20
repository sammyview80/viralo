import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface TrimBarProps {
  duration: number;
  startSec: number;
  endSec: number;
  onChange: (startSec: number, endSec: number) => void;
  className?: string;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Standalone dual-handle trim bar.
 * No timeline, no effects — just start/end handles over a duration.
 *
 * Usage:
 *   <TrimBar duration={120} startSec={10} endSec={45} onChange={(s, e) => ...} />
 */
export function TrimBar({ duration, startSec, endSec, onChange, className }: TrimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const pctToSec = useCallback((pct: number) => Math.max(0, Math.min(duration, pct * duration)), [duration]);

  const startDrag = useCallback((handle: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;

    const onMove = (ev: PointerEvent) => {
      const { left, width } = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - left) / width));
      const sec = pctToSec(pct);
      if (handle === "start") {
        onChange(Math.min(sec, endSec - 1), endSec);
      } else {
        onChange(startSec, Math.max(sec, startSec + 1));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [duration, startSec, endSec, onChange, pctToSec]);

  if (duration <= 0) return null;

  const startPct = (startSec / duration) * 100;
  const endPct = (endSec / duration) * 100;

  return (
    <div className={cn("w-full select-none", className)}>
      <div className="mb-2 flex justify-between text-[10px] font-mono text-zinc-500">
        <span>{fmt(startSec)}</span>
        <span className="text-zinc-600">{fmt(endSec - startSec)} selected</span>
        <span>{fmt(endSec)}</span>
      </div>

      <div
        ref={trackRef}
        className="relative h-10 rounded-[8px] bg-white/[.04] border border-white/[.06] overflow-visible"
      >
        {/* Dimmed regions outside trim */}
        <div
          className="absolute inset-y-0 left-0 bg-black/40 rounded-l-[8px]"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/40 rounded-r-[8px]"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Selected region highlight */}
        <div
          className="absolute inset-y-0 bg-[#ff3d6a]/15 border-y border-[#ff3d6a]/40"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
        />

        {/* Start handle */}
        <div
          className="absolute top-0 bottom-0 w-3 -translate-x-1/2 cursor-ew-resize z-10 flex items-center justify-center group"
          style={{ left: `${startPct}%` }}
          onPointerDown={startDrag("start")}
        >
          <div className="h-full w-[3px] rounded-full bg-[#ff3d6a] group-active:w-1 transition-all shadow-[0_0_8px_rgba(255,61,106,.6)]" />
        </div>

        {/* End handle */}
        <div
          className="absolute top-0 bottom-0 w-3 -translate-x-1/2 cursor-ew-resize z-10 flex items-center justify-center group"
          style={{ left: `${endPct}%` }}
          onPointerDown={startDrag("end")}
        >
          <div className="h-full w-[3px] rounded-full bg-[#ff3d6a] group-active:w-1 transition-all shadow-[0_0_8px_rgba(255,61,106,.6)]" />
        </div>

        {/* Tick marks */}
        {Array.from({ length: Math.min(10, Math.floor(duration)) }).map((_, i, arr) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-white/[.08]"
            style={{ left: `${((i + 1) / (arr.length + 1)) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
