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
  template: CaptionTemplate;
}

interface CaptionEditorProps {
  captions: Caption[];
  duration: number;
  onChange: (captions: Caption[]) => void;
}

export type CaptionTemplate =
  | "default"
  | "modern"
  | "bouncy"
  | "mr-beast"
  | "business"
  | "clean"
  | "neon"
  | "podcast"
  | "cinematic"
  | "gaming"
  | "news"
  | "luxury"
  | "karaoke"
  | "meme"
  | "documentary"
  | "sports"
  | "soft";

const POSITION_OPTS: Caption["position"][] = ["top", "center", "bottom"];
const PRESET_COLORS = ["#ffffff", "#ffee00", "#ff3d6a", "#00d9ff", "#a855f7", "#22c55e"];
const CAPTION_TEMPLATES: Array<{ id: CaptionTemplate; label: string; bg: string; fg: string; box?: string; cls: string }> = [
  { id: "default", label: "Default", bg: "bg-[#34343a]", fg: "text-white", box: "bg-white", cls: "" },
  { id: "modern", label: "Modern", bg: "bg-gradient-to-b from-orange-700 to-orange-950", fg: "text-yellow-300", box: "bg-black", cls: "" },
  { id: "bouncy", label: "Bouncy", bg: "bg-gradient-to-b from-violet-500 to-fuchsia-900", fg: "text-white", box: "bg-white", cls: "" },
  { id: "mr-beast", label: "Mr. Beast", bg: "bg-gradient-to-b from-sky-500 to-blue-900", fg: "text-cyan-500", box: "bg-yellow-400", cls: "uppercase" },
  { id: "business", label: "Business", bg: "bg-gradient-to-b from-stone-500 to-stone-900", fg: "text-white", cls: "" },
  { id: "clean", label: "Clean", bg: "bg-gradient-to-b from-slate-600 to-slate-950", fg: "text-white", cls: "" },
  { id: "neon", label: "Neon", bg: "bg-gradient-to-b from-indigo-800 to-black", fg: "text-lime-300", box: "bg-[#101026]", cls: "" },
  { id: "podcast", label: "Podcast", bg: "bg-gradient-to-b from-zinc-700 to-zinc-950", fg: "text-white", box: "bg-zinc-900", cls: "" },
  { id: "cinematic", label: "Cinematic", bg: "bg-gradient-to-b from-neutral-700 to-black", fg: "text-yellow-200", cls: "" },
  { id: "gaming", label: "Gaming", bg: "bg-gradient-to-b from-fuchsia-700 to-indigo-950", fg: "text-cyan-300", box: "bg-violet-950", cls: "" },
  { id: "news", label: "News", bg: "bg-gradient-to-b from-red-700 to-zinc-950", fg: "text-white", box: "bg-rose-700", cls: "uppercase" },
  { id: "luxury", label: "Luxury", bg: "bg-gradient-to-b from-zinc-800 to-black", fg: "text-yellow-500", box: "bg-black", cls: "" },
  { id: "karaoke", label: "Karaoke", bg: "bg-gradient-to-b from-blue-700 to-blue-950", fg: "text-yellow-100", box: "bg-blue-700", cls: "" },
  { id: "meme", label: "Meme", bg: "bg-gradient-to-b from-zinc-500 to-zinc-900", fg: "text-white", box: "bg-black", cls: "uppercase" },
  { id: "documentary", label: "Doc", bg: "bg-gradient-to-b from-stone-700 to-black", fg: "text-stone-100", box: "bg-black/70", cls: "" },
  { id: "sports", label: "Sports", bg: "bg-gradient-to-b from-emerald-700 to-zinc-950", fg: "text-lime-300", box: "bg-zinc-950", cls: "uppercase" },
  { id: "soft", label: "Soft", bg: "bg-gradient-to-b from-indigo-500 to-pink-800", fg: "text-pink-100", box: "bg-indigo-900/70", cls: "" },
];

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
      template: "default",
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

  const inputCls = "w-full rounded-[8px] border border-c-border bg-surface-2 px-3 py-1.5 text-sm text-c-text placeholder:text-c-text-muted focus:border-[#ff3d6a]/40 focus:outline-none transition";

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[.1em] text-c-text-muted">Edit Caption</p>
          <button onClick={() => setEditing(null)} className="text-c-text-muted hover:text-c-text-secondary transition text-xs cursor-pointer">✕ Cancel</button>
        </div>

        <textarea
          className={cn(inputCls, "min-h-[70px] resize-none")}
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          placeholder="Caption text…"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-c-text-muted">Start (s)</label>
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
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-c-text-muted">End (s)</label>
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
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-c-text-muted">Template</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
            {CAPTION_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setEditing({ ...editing, template: tpl.id })}
                className={cn(
                  "rounded-[10px] border p-1.5 text-left transition cursor-pointer",
                  editing.template === tpl.id ? "border-[#ff3d6a] bg-[#ff3d6a]/10" : "border-c-border bg-surface-1 hover:border-c-border-hover"
                )}
              >
                <div className={cn("relative aspect-[9/16] overflow-hidden rounded-[7px]", tpl.bg)}>
                  <div className="absolute left-1/2 top-[16%] -translate-x-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-bold text-white">Your video</div>
                  <div className={cn("absolute left-2 right-2 top-[68%] rounded px-1 py-1 text-center text-[9px] font-black leading-tight", tpl.box, tpl.fg, tpl.cls)}>
                    subtitle
                  </div>
                </div>
                <div className={cn("mt-1 truncate text-center text-[10px] font-bold", editing.template === tpl.id ? "text-[#ff7a9a]" : "text-c-text-muted")}>{tpl.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-c-text-muted">Position</label>
          <div className="flex gap-1.5">
            {POSITION_OPTS.map((p) => (
              <button
                key={p}
                onClick={() => setEditing({ ...editing, position: p })}
                className={cn(
                  "flex-1 rounded-[7px] border py-1.5 text-[11px] font-semibold capitalize transition cursor-pointer",
                  editing.position === p
                    ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-300"
                    : "border-c-border bg-surface-1 text-c-text-muted hover:text-c-text-secondary"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-c-text-muted">Color</label>
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
          <label className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-c-text-muted">
            Font size <span className="normal-case text-c-text-secondary">{editing.fontSize}px</span>
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
        <p className="text-[10px] font-bold uppercase tracking-[.12em] text-c-text-muted">Captions</p>
        <button
          onClick={add}
          className="rounded-[7px] border border-c-border bg-surface-1 px-3 py-1 text-[11px] font-semibold text-c-text-secondary hover:bg-surface-2 transition cursor-pointer"
        >
          + Add
        </button>
      </div>

      {captions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-c-text-muted shrink-0">Style all</p>
          {CAPTION_TEMPLATES.slice(0, 6).map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => onChange(captions.map(c => ({ ...c, template: tpl.id })))}
              className="rounded-[6px] border border-c-border bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-c-text-secondary hover:bg-surface-2 transition cursor-pointer"
            >
              {tpl.label}
            </button>
          ))}
        </div>
      )}

      {captions.length === 0 ? (
        <div className="py-8 text-center">
          <div className="text-3xl opacity-20 mb-2">💬</div>
          <p className="text-[12px] text-c-text-muted">No captions yet</p>
          <button onClick={add} className="mt-3 text-[11px] text-[#ff3d6a] hover:underline cursor-pointer">Add your first caption</button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...captions].sort((a, b) => a.startSec - b.startSec).map((cap) => (
            <button
              key={cap.id}
              onClick={() => setEditing(cap)}
              className="group w-full flex items-start gap-2 rounded-[9px] border border-c-border bg-surface-1 px-3 py-2 text-left hover:border-c-border-hover hover:bg-surface-2 transition cursor-pointer"
            >
              <div
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: cap.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-c-text">{cap.text}</p>
                <p className="text-[10px] text-c-text-muted mt-0.5">{fmt(cap.startSec)} – {fmt(cap.endSec)} · {cap.position}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); remove(cap.id); }}
                className="opacity-0 group-hover:opacity-100 shrink-0 text-c-text-muted hover:text-red-400 transition cursor-pointer text-xs"
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
