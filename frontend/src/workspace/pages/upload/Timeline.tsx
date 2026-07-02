import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* ─── Waveform ─── */
function Waveform({ bars = 80, selStart, selEnd }: { bars?: number; selStart: number; selEnd: number }) {
  const heights = Array.from({ length: bars }, (_, i) => {
    const base = 0.2 + 0.6 * Math.sin(i * 0.3) * Math.sin(i * 0.07);
    return Math.max(0.1, Math.abs(base + Math.sin(i * 1.7) * 0.3));
  });
  return (
    <div className="flex h-full w-full items-end gap-[1.5px]">
      {heights.map((h, i) => {
        const pct = i / bars;
        const inSel = pct >= selStart && pct <= selEnd;
        return (
          <div key={i} className="flex-1 rounded-[1px]" style={{
            height: `${h * 100}%`,
            background: inSel
              ? `rgba(255,61,106,${0.4 + h * 0.5})`
              : `rgba(255,255,255,${0.08 + h * 0.15})`,
          }} />
        );
      })}
    </div>
  );
}

/* ─── Timeline editor modal ─── */
export interface TimelineClip {
  id: string;
  title: string | null;
  startSec: number;
  endSec: number;
  storage_url?: string | null;
}

function fmtSec(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function TimelineEditor({
  clip, totalDur = 600, onClose, onSave,
}: {
  clip: TimelineClip;
  totalDur?: number;
  onClose: () => void;
  onSave: (c: TimelineClip) => void;
}) {
  const [startSec, setStartSec] = useState(clip.startSec);
  const [endSec,   setEndSec]   = useState(clip.endSec);
  const [playing,  setPlaying]  = useState(false);
  const [pos,      setPos]      = useState(0);
  const trackRef  = useRef<HTMLDivElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const dragging  = useRef<"start" | "end" | null>(null);
  const rafRef    = useRef<number | null>(null);
  const pStart = startSec / totalDur;
  const pEnd   = endSec   / totalDur;
  const dur    = endSec - startSec;

  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const spd = 1 / (dur * 60);
    const tick = () => {
      setPos((p) => { if (p >= 1) { setPlaying(false); return 0; } return p + spd; });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, dur]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(p * totalDur);
      if (dragging.current === "start") setStartSec(Math.min(sec, endSec - 3));
      else setEndSec(Math.max(sec, startSec + 3));
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [startSec, endSec, totalDur]);

  const fmtInput = (s: number) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  const parseInput = (v: string) => {
    const [m, s] = v.split(":").map(Number);
    return (m || 0) * 60 + (s || 0);
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(4,7,15,.82)", backdropFilter: "blur(8px)", animation: "fadeUp .15s ease" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full max-w-[700px] flex-col overflow-hidden rounded-[22px] border border-white/[.14] bg-[#0e1420] shadow-[0_40px_100px_rgba(0,0,0,.7)]"
        style={{ maxHeight: "90vh", animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex flex-none items-center gap-3 border-b border-white/[.07] px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>
            </svg>
          </div>
          <div>
            <h3 className="font-display text-[15px] font-bold">Clip Editor</h3>
            <p className="text-[11.5px] text-zinc-500">{clip.title ?? "Untitled clip"}</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] bg-white/[.03] text-[13px] text-zinc-500 transition hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-5 space-y-5">
          {/* Video preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-[13px] bg-black">
            {clip.storage_url ? (
              <video ref={videoRef} src={clip.storage_url} className="h-full w-full object-cover"
                playsInline preload="metadata"
                onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#ff3d6a]/20 to-[#ff7a3d]/20" />
            )}
            <div className="absolute inset-0 grid place-items-center" onClick={() => {
              if (videoRef.current) {
                if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true); }
                else { videoRef.current.pause(); setPlaying(false); }
              } else { setPlaying((p) => !p); }
            }}>
              {!playing && (
                <div className="grid h-12 w-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm">▶</div>
              )}
            </div>
            {/* Playhead */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
              <div className="h-full bg-white transition-[width_.1s_linear]" style={{ width: `${pos * 100}%` }} />
            </div>
            <div className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
              {fmtSec(startSec + pos * dur)} / {fmtSec(dur)}
            </div>
          </div>

          {/* Timeline track */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.1em] text-zinc-600">Timeline — drag handles to trim</div>
            <div ref={trackRef} className="relative h-14 w-full cursor-crosshair overflow-hidden rounded-[9px] bg-white/[.04]"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const p = (e.clientX - rect.left) / rect.width;
                const sec = Math.round(p * totalDur);
                if (Math.abs(p - pStart) < Math.abs(p - pEnd)) setStartSec(Math.min(sec, endSec - 3));
                else setEndSec(Math.max(sec, startSec + 3));
              }}>
              <Waveform bars={90} selStart={pStart} selEnd={pEnd} />
              {/* Selection highlight */}
              <div className="absolute inset-y-0 bg-[#ff3d6a]/10 border-x border-[#ff3d6a]/40 pointer-events-none"
                style={{ left: `${pStart * 100}%`, width: `${(pEnd - pStart) * 100}%` }} />
              {/* Start handle */}
              <div className="absolute inset-y-0 flex cursor-ew-resize flex-col items-center"
                style={{ left: `calc(${pStart * 100}% - 2px)` }}
                onMouseDown={(e) => { e.preventDefault(); dragging.current = "start"; }}>
                <div className="h-full w-[3px] bg-[#ff3d6a]" />
                <div className="absolute -bottom-5 whitespace-nowrap rounded bg-[#ff3d6a] px-1.5 py-0.5 text-[10px] font-bold text-white">{fmtSec(startSec)}</div>
              </div>
              {/* End handle */}
              <div className="absolute inset-y-0 flex cursor-ew-resize flex-col items-center"
                style={{ left: `calc(${pEnd * 100}% - 2px)` }}
                onMouseDown={(e) => { e.preventDefault(); dragging.current = "end"; }}>
                <div className="h-full w-[3px] bg-[#ff3d6a]" />
                <div className="absolute -bottom-5 whitespace-nowrap rounded bg-[#ff3d6a] px-1.5 py-0.5 text-[10px] font-bold text-white">{fmtSec(endSec)}</div>
              </div>
            </div>

            {/* Time inputs */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label:"Start", val:fmtInput(startSec), set:(v:string)=>{ const n=parseInput(v); if(!isNaN(n)) setStartSec(Math.min(n,endSec-3)); } },
                { label:"Duration", val:fmtSec(dur), set:null, accent:true },
                { label:"End",   val:fmtInput(endSec),   set:(v:string)=>{ const n=parseInput(v); if(!isNaN(n)) setEndSec(Math.max(n,startSec+3)); } },
              ].map(({ label, val, set, accent }) => (
                <div key={label} className={cn("rounded-[10px] border p-3 text-center", accent ? "border-[#ff3d6a]/25 bg-[#ff3d6a]/[.06]" : "border-white/[.08] bg-white/[.03]")}>
                  <div className={cn("mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em]", accent ? "text-[#ff3d6a]" : "text-zinc-500")}>{label}</div>
                  {set
                    ? <input defaultValue={val} key={val}
                        onBlur={(e) => set(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && set((e.target as HTMLInputElement).value)}
                        className="w-full bg-transparent text-center font-mono text-[15px] font-bold text-zinc-200 outline-none" />
                    : <div className={cn("font-mono text-[15px] font-bold", accent ? "text-[#ff3d6a]" : "text-zinc-200")}>{val}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Quick trim */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.1em] text-zinc-600">Quick trim</div>
            <div className="flex flex-wrap gap-2">
              {([
                ["−5s start", () => setStartSec((s) => Math.max(0, s - 5))],
                ["+5s start", () => setStartSec((s) => Math.min(s + 5, endSec - 3))],
                ["−5s end",   () => setEndSec((s) => Math.max(startSec + 3, s - 5))],
                ["+5s end",   () => setEndSec((s) => Math.min(s + 5, totalDur))],
              ] as [string, () => void][]).map(([l, fn]) => (
                <button key={l} onClick={fn}
                  className="rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:border-[#ff3d6a]/35 hover:text-white">
                  {l}
                </button>
              ))}
              <button onClick={() => { setStartSec(clip.startSec); setEndSec(clip.endSec); }}
                className="ml-auto rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:text-white">
                ↺ Reset
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-none gap-2.5 border-t border-white/[.07] px-5 py-4">
          <button onClick={onClose}
            className="rounded-[9px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:text-white">
            Cancel
          </button>
          <button onClick={() => { onSave({ ...clip, startSec, endSec }); onClose(); }}
            className="ml-auto flex items-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:shadow-[0_4px_18px_rgba(255,61,106,.4)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18"/></svg>
            Save & re-render
          </button>
        </div>
      </div>
    </div>
  );
}
