import { useState } from "react";
import { cn } from "@/lib/utils";

export interface Caption {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  position: "top" | "center" | "bottom";
  color: string;
  fontSize: number;
}

interface CaptionEditorProps {
  captions: Caption[];
  duration: number;
  onChange: (captions: Caption[]) => void;
}

const POSITION_OPTS: Caption["position"][] = ["top", "center", "bottom"];
const PRESET_COLORS = ["#ffffff", "#ffee00", "#ff3d6a", "#00d9ff", "#a855f7", "#22c55e"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function CaptionEditor({ captions, duration, onChange }: CaptionEditorProps) {
  const [editing, setEditing] = useState<Caption | null>(null);

  function add() {
    const cap: Caption = {
      id: uid(),
      text: "New caption",
      startSec: 0,
      endSec: Math.min(3, duration),
      position: "bottom",
      color: "#ffffff",
      fontSize: 24,
    };
    setEditing(cap);
  }

  function save(cap: Caption) {
    const idx = captions.findIndex((c) => c.id === cap.id);
    if (idx >= 0) {
      onChange(captions.map((c) => (c.id === cap.id ? cap : c)));
    } else {
      onChange([...captions, cap]);
    }
    setEditing(null);
  }

  function remove(id: string) {
    onChange(captions.filter((c) => c.id !== id));
    if (editing?.id === id) setEditing(null);
  }

  const inputCls = "w-full rounded-[8px] border border-white/[.07] bg-[#0b101a] px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#ff3d6a]/40 focus:outline-none transition";

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[.1em] text-zinc-500">Edit Caption</p>
          <button onClick={() => setEditing(null)} className="text-zinc-600 hover:text-zinc-300 transition text-xs cursor-pointer">✕ Cancel</button>
        </div>

        <textarea
          className={cn(inputCls, "min-h-[70px] resize-none")}
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          placeholder="Caption text…"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Start (s)</label>
            <input
              type="number"
              className={inputCls}
              min={0}
              max={editing.endSec - 0.5}
              step={0.5}
              value={editing.startSec}
              onChange={(e) => setEditing({ ...editing, startSec: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-600">End (s)</label>
            <input
              type="number"
              className={inputCls}
              min={editing.startSec + 0.5}
              max={duration}
              step={0.5}
              value={editing.endSec}
              onChange={(e) => setEditing({ ...editing, endSec: parseFloat(e.target.value) || 1 })}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Position</label>
          <div className="flex gap-1.5">
            {POSITION_OPTS.map((p) => (
              <button
                key={p}
                onClick={() => setEditing({ ...editing, position: p })}
                className={cn(
                  "flex-1 rounded-[7px] border py-1.5 text-[11px] font-semibold capitalize transition cursor-pointer",
                  editing.position === p
                    ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-300"
                    : "border-white/[.07] bg-white/[.02] text-zinc-500 hover:text-zinc-300"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Color</label>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setEditing({ ...editing, color: c })}
                style={{ background: c }}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition cursor-pointer",
                  editing.color === c ? "border-white scale-110" : "border-transparent hover:border-white/40"
                )}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            Font size <span className="normal-case text-zinc-400">{editing.fontSize}px</span>
          </label>
          <input
            type="range"
            min={12}
            max={48}
            value={editing.fontSize}
            onChange={(e) => setEditing({ ...editing, fontSize: parseInt(e.target.value) })}
            className="w-full accent-[#ff3d6a]"
          />
        </div>

        <button
          onClick={() => save(editing)}
          className="w-full rounded-[9px] bg-[#ff3d6a] py-2 text-[13px] font-bold text-white hover:bg-[#e8304f] transition cursor-pointer"
        >
          Save Caption
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">Captions</p>
        <button
          onClick={add}
          className="rounded-[7px] border border-white/[.08] bg-white/[.03] px-3 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-white/[.07] transition cursor-pointer"
        >
          + Add
        </button>
      </div>

      {captions.length === 0 ? (
        <div className="py-8 text-center">
          <div className="text-3xl opacity-20 mb-2">💬</div>
          <p className="text-[12px] text-zinc-500">No captions yet</p>
          <button onClick={add} className="mt-3 text-[11px] text-[#ff3d6a] hover:underline cursor-pointer">Add your first caption</button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...captions].sort((a, b) => a.startSec - b.startSec).map((cap) => (
            <button
              key={cap.id}
              onClick={() => setEditing(cap)}
              className="group w-full flex items-start gap-2 rounded-[9px] border border-white/[.06] bg-white/[.02] px-3 py-2 text-left hover:border-white/[.1] hover:bg-white/[.04] transition cursor-pointer"
            >
              <div
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: cap.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-zinc-200">{cap.text}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{fmt(cap.startSec)} – {fmt(cap.endSec)} · {cap.position}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); remove(cap.id); }}
                className="opacity-0 group-hover:opacity-100 shrink-0 text-zinc-600 hover:text-red-400 transition cursor-pointer text-xs"
              >
                ✕
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
