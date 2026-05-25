import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Shell } from "../Shell";
import { videoApi, platformApi, type VideoResponse, type ClipApiResponse, type ClipConfig, type SocialAccount } from "@/lib/api";

/* ─── Types ─── */
type Source = "file" | "yt";
type View = "upload" | "processing" | "results";

/* ─── Clip config panel ─── */
const PLATFORM_OPTIONS = [
  { id:"tiktok",    label:"TikTok",    ltr:"♪" },
  { id:"reels",     label:"Reels",     ltr:"◎" },
  { id:"shorts",    label:"Shorts",    ltr:"▶" },
  { id:"youtube",   label:"YouTube",   ltr:"▶" },
  { id:"instagram", label:"Instagram", ltr:"⊙" },
  { id:"twitter",   label:"Twitter/X", ltr:"𝕏" },
];

const ASPECT_OPTIONS = ["9:16","1:1","16:9"];
const LANG_OPTIONS   = ["en","es","fr","de","pt","ja","ko","zh","ar","hi"];

const DEFAULT_CONFIG: ClipConfig = {
  language: "en",
  max_clips: 3,
  min_score: 0.5,
  platforms: ["tiktok","reels","shorts"],
  topic_focus: null,
  add_captions: true,
  caption_style: "capcut",
  aspect_ratio: "9:16",
  duration_min: 20,
  duration_max: 60,
  output_quality: "1080p",
};

const CAPTION_STYLES = [
  { id:"capcut",      label:"CapCut",       desc:"Bold word-by-word, colored highlight" },
  { id:"capcut-bold", label:"CapCut Bold",  desc:"Thicker strokes, high contrast" },
  { id:"classic",     label:"Classic",      desc:"White subtitles, black outline" },
  { id:"minimal",     label:"Minimal",      desc:"Clean lower-third, no outline" },
];

function ClipConfigPanel({ config, onChange }: { config: ClipConfig; onChange: (c: ClipConfig) => void }) {
  const set = (patch: Partial<ClipConfig>) => onChange({ ...config, ...patch });
  const togglePlat = (id: string) => {
    const cur = config.platforms ?? [];
    set({ platforms: cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id] });
  };

  return (
    <div className="mt-5 rounded-[14px] border border-white/[.08] bg-white/[.025] p-5 space-y-5">
      <h4 className="font-display text-[13.5px] font-bold text-zinc-200">Clip settings</h4>

      {/* Platforms */}
      <div>
        <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Platforms</label>
        <div className="flex flex-wrap gap-2">
          {PLATFORM_OPTIONS.map((p) => {
            const active = (config.platforms ?? []).includes(p.id);
            return (
              <button key={p.id} type="button" onClick={() => togglePlat(p.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition",
                  active ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-[#ff3d6a]" : "border-white/[.07] bg-white/[.03] text-zinc-400 hover:border-white/[.12] hover:text-zinc-200"
                )}>
                <span className="text-[10px]">{p.ltr}</span>{p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Aspect ratio */}
        <div>
          <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Aspect ratio</label>
          <div className="flex gap-2">
            {ASPECT_OPTIONS.map((r) => (
              <button key={r} type="button" onClick={() => set({ aspect_ratio: r })}
                className={cn(
                  "flex-1 rounded-[8px] border py-1.5 text-[12px] font-semibold transition",
                  config.aspect_ratio === r ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-[#ff3d6a]" : "border-white/[.07] bg-white/[.03] text-zinc-400 hover:text-zinc-200"
                )}>{r}</button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Language</label>
          <select
            value={config.language ?? "en"}
            onChange={(e) => set({ language: e.target.value })}
            className="w-full rounded-[8px] border border-white/[.07] bg-[#0e1420] px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 outline-none focus:border-[#ff3d6a]/40"
          >
            {LANG_OPTIONS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>

        {/* Duration */}
        <div>
          <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">
            Duration (sec) · {config.duration_min}s – {config.duration_max}s
          </label>
          <div className="flex items-center gap-2">
            <input type="number" min={5} max={config.duration_max} value={config.duration_min}
              onChange={(e) => set({ duration_min: Number(e.target.value) })}
              className="w-full rounded-[8px] border border-white/[.07] bg-[#0e1420] px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 outline-none focus:border-[#ff3d6a]/40" />
            <span className="text-zinc-600">–</span>
            <input type="number" min={config.duration_min} max={300} value={config.duration_max}
              onChange={(e) => set({ duration_max: Number(e.target.value) })}
              className="w-full rounded-[8px] border border-white/[.07] bg-[#0e1420] px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 outline-none focus:border-[#ff3d6a]/40" />
          </div>
        </div>

        {/* Max clips */}
        <div>
          <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Max clips · {config.max_clips}</label>
          <input type="range" min={1} max={20} value={config.max_clips}
            onChange={(e) => set({ max_clips: Number(e.target.value) })}
            className="w-full accent-[#ff3d6a]" />
          <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>1</span><span>20</span></div>
        </div>

        {/* Min virality score */}
        <div>
          <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">
            Min virality score · <span className="text-[#ff3d6a]">{Math.round((config.min_score ?? 0.5) * 10)}/10</span>
          </label>
          <input type="range" min={0} max={10} step={1} value={Math.round((config.min_score ?? 0.5) * 10)}
            onChange={(e) => set({ min_score: Number(e.target.value) / 10 })}
            className="w-full accent-[#ff3d6a]" />
          <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
            <span>0 · any</span><span>5 · balanced</span><span>10 · viral only</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Topic focus */}
        <div>
          <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Topic focus <span className="normal-case text-zinc-600">(optional)</span></label>
          <input type="text" placeholder="e.g. fitness tips, product demo…"
            value={config.topic_focus ?? ""}
            onChange={(e) => set({ topic_focus: e.target.value || null })}
            className="w-full rounded-[8px] border border-white/[.07] bg-[#0e1420] px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 placeholder-zinc-600 outline-none focus:border-[#ff3d6a]/40" />
        </div>

        {/* Captions toggle + style */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-[10px] border border-white/[.07] bg-white/[.02] px-4 py-3">
            <div>
              <div className="text-[12.5px] font-semibold text-zinc-200">Auto captions</div>
              <div className="text-[11px] text-zinc-500">Burn subtitles into clips</div>
            </div>
            <button type="button" onClick={() => set({ add_captions: !config.add_captions })}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors duration-200",
                config.add_captions ? "bg-[#ff3d6a]" : "bg-white/[.12]"
              )}>
              <span className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                config.add_captions ? "left-[calc(100%-22px)]" : "left-0.5"
              )} />
            </button>
          </div>

          {config.add_captions && (
            <div>
              <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Caption style</label>
              <div className="grid grid-cols-2 gap-2">
                {CAPTION_STYLES.map((s) => (
                  <button key={s.id} type="button" onClick={() => set({ caption_style: s.id })}
                    className={cn(
                      "rounded-[9px] border px-3 py-2.5 text-left transition",
                      config.caption_style === s.id
                        ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10"
                        : "border-white/[.07] bg-white/[.03] hover:border-white/[.12]"
                    )}>
                    <div className={cn("text-[12px] font-semibold", config.caption_style === s.id ? "text-[#ff3d6a]" : "text-zinc-200")}>{s.label}</div>
                    <div className="mt-0.5 text-[10.5px] text-zinc-500">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Output quality */}
      <div>
        <label className="mb-2 block text-[11.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">Output quality</label>
        <div className="flex gap-2">
          {(["source","1080p","720p","480p"] as const).map((q) => (
            <button key={q} type="button" onClick={() => set({ output_quality: q })}
              className={cn(
                "flex-1 rounded-[8px] border py-1.5 text-[12px] font-semibold transition",
                config.output_quality === q
                  ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-[#ff3d6a]"
                  : "border-white/[.07] bg-white/[.03] text-zinc-400 hover:border-white/[.12] hover:text-zinc-200"
              )}>
              {q === "source" ? "Full res" : q}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px] text-zinc-600">Full res keeps original quality. Lower = smaller file size.</p>
      </div>
    </div>
  );
}

/* ─── Delete confirm modal ─── */
function DeleteModal({
  video,
  onConfirm,
  onCancel,
}: {
  video: VideoResponse;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,15,.7)", backdropFilter: "blur(6px)", animation: "fadeUp .15s ease" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[380px] overflow-hidden rounded-[18px] border border-white/[.12] bg-[#0e1420] shadow-[0_32px_80px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "fadeUp .18s cubic-bezier(.22,.8,.4,1)" }}
      >
        <div className="p-6">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-[12px] border border-red-400/20 bg-red-400/10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </div>
          <h3 className="font-display text-[16px] font-bold text-white">Delete video?</h3>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-zinc-400">
            <span className="font-semibold text-zinc-200">"{video.title ?? "Untitled"}"</span> and all its generated clips will be permanently deleted. This cannot be undone.
          </p>
        </div>
        <div className="flex gap-2 border-t border-white/[.07] px-6 py-4">
          <button
            onClick={onCancel}
            className="flex-1 rounded-[9px] border border-white/[.08] bg-white/[.04] py-2 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/[.08] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-[9px] bg-red-500 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(239,68,68,.3)] transition hover:bg-red-400 hover:shadow-[0_4px_18px_rgba(239,68,68,.4)]"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */
function fmtSec(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtDur(sec: number | null) {
  if (sec == null) return "—:--";
  return fmtSec(sec);
}

function gradFromId(id: string) {
  const GRADS = [
    "from-[#FF3D6A] to-[#FF7A3D]", "from-[#3DAAFF] to-[#7B66FF]",
    "from-[#22C55E] to-[#3DAAFF]", "from-[#A855F7] to-[#FF3D6A]",
    "from-[#FF7A3D] to-[#FFB347]",
  ];
  const n = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  return GRADS[n % GRADS.length];
}

const PLAT_DISPLAY: Record<string, [string, string]> = {
  tt:              ["♪", "bg-zinc-950 text-white"],
  tiktok:          ["♪", "bg-zinc-950 text-white"],
  ig:              ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white"],
  instagram:       ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white"],
  yt:              ["▶", "bg-red-500 text-white"],
  youtube:         ["▶", "bg-red-500 text-white"],
  youtube_shorts:  ["▶", "bg-red-500 text-white"],
  tw:              ["𝕏", "bg-zinc-100 text-zinc-950"],
  twitter:         ["𝕏", "bg-zinc-100 text-zinc-950"],
  li:              ["in", "bg-blue-700 text-white"],
  linkedin:        ["in", "bg-blue-700 text-white"],
  fb:              ["f",  "bg-blue-600 text-white"],
  facebook:        ["f",  "bg-blue-600 text-white"],
};

function PlatPill({ p }: { p: string }) {
  const [lbl, cls] = PLAT_DISPLAY[p] ?? ["?", "bg-zinc-700 text-white"];
  return <span className={cn("inline-grid h-5 w-5 place-items-center rounded-[4px] border border-white/10 text-[9px] font-black", cls)}>{lbl}</span>;
}

function VirChip({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 75 ? "text-emerald-300 border-emerald-300/30 bg-emerald-400/15"
              : score >= 55 ? "text-yellow-300 border-yellow-300/30 bg-yellow-400/[.12]"
              : "text-zinc-400 border-white/10 bg-white/[.07]";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[7px] border px-2 py-0.5 text-[11px] font-bold", color)}>
      ⚡ {score}
    </span>
  );
}

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
interface TimelineClip {
  id: string;
  title: string | null;
  startSec: number;
  endSec: number;
  storage_url?: string | null;
}

function TimelineEditor({
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
      className="fixed inset-0 z-[400] flex items-center justify-center p-6"
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
            <div className="mt-6 grid grid-cols-3 gap-3">
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

/* ─── Download menu ─── */
function DownloadMenu({ clip, onClose }: { clip: ClipApiResponse; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener("click", fn), 50);
    return () => document.removeEventListener("click", fn);
  }, []);
  const items = [
    { label:"Download MP4",       icon:"🎬", href: clip.storage_url ?? "#" },
    { label:"Download SRT",       icon:"💬", href: "#" },
    { label:"Download thumbnail", icon:"🖼", href: clip.thumbnail_url ?? "#" },
    { label:"Copy transcript",    icon:"📝", href: null },
    { label:"Share link",         icon:"🔗", href: null },
  ];
  return (
    <div ref={ref} className="absolute bottom-[calc(100%+6px)] right-0 z-50 w-48 overflow-hidden rounded-[11px] border border-white/[.10] bg-[#141926] shadow-[0_16px_40px_rgba(0,0,0,.5)]"
      onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) => (
        <div key={item.label}>
          {i === 3 && <div className="mx-3 border-t border-white/[.07]" />}
          {item.href && item.href !== "#"
            ? <a href={item.href} download onClick={onClose}
                className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-zinc-300 transition hover:bg-white/[.05] hover:text-white">
                <span>{item.icon}</span>{item.label}
              </a>
            : <button onClick={onClose}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-zinc-300 transition hover:bg-white/[.05] hover:text-white">
                <span>{item.icon}</span>{item.label}
              </button>}
        </div>
      ))}
    </div>
  );
}

/* ─── Pipeline step label mapping ─── */
const PROC_STEPS = [
  { keys: ["download"],                    emoji:"⬇",  label:"Downloading video",       sub:"Fetching from source" },
  { keys: ["upload","uploading"],          emoji:"⬆",  label:"Uploading file",          sub:"Transferring to secure storage" },
  { keys: ["metadata","probe"],            emoji:"🔎", label:"Probing video",           sub:"Reading resolution, duration, codec" },
  { keys: ["transcribe","speech"],         emoji:"📝", label:"Transcribing speech",     sub:"AI speech-to-text in progress" },
  { keys: ["scoring","analyze","signal"],  emoji:"⚡", label:"Finding viral moments",   sub:"Step 1: detecting viral signals in transcript" },
  { keys: ["captions","caption"],          emoji:"💬", label:"Generating captions",     sub:"Building word-level caption timeline" },
  { keys: ["export","render","encode"],    emoji:"🎬", label:"Rendering clips",         sub:"Cutting, cropping, burning captions" },
  { keys: ["complete","done"],             emoji:"✅", label:"Done",                    sub:"All clips ready" },
];

function pipelineStepIdx(step: string | null): number {
  if (!step) return 0;
  const s = step.toLowerCase();
  const idx = PROC_STEPS.findIndex((p) => p.keys.some((k) => s.includes(k)));
  return idx >= 0 ? idx : 0;
}

/* ─── Social connect banner shown during processing ─── */
const SOCIAL_PLATFORMS = [
  { id: "youtube",   label: "YouTube",   icon: "▶", color: "bg-red-500" },
  { id: "instagram", label: "Instagram", icon: "◎", color: "bg-gradient-to-br from-fuchsia-500 to-orange-400" },
  { id: "tiktok",    label: "TikTok",    icon: "♪", color: "bg-zinc-900" },
  { id: "twitter",   label: "Twitter/X", icon: "𝕏", color: "bg-zinc-100 text-zinc-900" },
  { id: "linkedin",  label: "LinkedIn",  icon: "in", color: "bg-blue-700" },
  { id: "facebook",  label: "Facebook",  icon: "f",  color: "bg-blue-600" },
];

function SocialConnectBanner() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    platformApi.listAccounts()
      .then(setAccounts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const connectedIds = new Set(accounts.filter((a) => a.is_active).map((a) => a.platform));
  const unconnected = SOCIAL_PLATFORMS.filter((p) => !connectedIds.has(p.id));

  if (unconnected.length === 0) {
    return (
      <div className="mt-6 rounded-[13px] border border-emerald-300/15 bg-emerald-400/[.04] p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-emerald-300/25 bg-emerald-400/10 text-emerald-300 text-sm">✓</div>
          <div>
            <div className="text-[13px] font-semibold text-emerald-300">All platforms connected</div>
            <div className="text-[11.5px] text-zinc-500">Clips will be ready to publish when processing completes.</div>
          </div>
          <a href="/integrations" className="ml-auto text-[11.5px] font-semibold text-zinc-400 transition hover:text-white">Manage →</a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {accounts.filter((a) => a.is_active).map((a) => {
            const plat = SOCIAL_PLATFORMS.find((p) => p.id === a.platform);
            return (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
                <span className={cn("inline-grid h-4 w-4 place-items-center rounded-[3px] text-[8px] font-black text-white", plat?.color ?? "bg-zinc-700")}>{plat?.icon}</span>
                {a.platform_username ?? a.platform}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-[13px] border border-[#ff3d6a]/15 bg-[#ff3d6a]/[.04] p-4" style={{ animation: "fadeUp .3s .4s cubic-bezier(.22,.8,.4,1) both" }}>
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a] text-sm">↗</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">Connect social accounts while you wait</div>
          <div className="mt-0.5 text-[11.5px] text-zinc-500">
            {connectedIds.size > 0
              ? `${connectedIds.size} connected · connect more to publish clips instantly`
              : "Your clips will be ready soon — connect accounts to publish with one click"}
          </div>
        </div>
        <a href="/integrations"
          className="ml-auto flex-none rounded-[8px] border border-[#ff3d6a]/30 bg-[#ff3d6a]/10 px-3 py-1.5 text-[12px] font-semibold text-[#ff3d6a] transition hover:bg-[#ff3d6a]/20">
          Connect →
        </a>
      </div>

      {connectedIds.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {accounts.filter((a) => a.is_active).map((a) => {
            const plat = SOCIAL_PLATFORMS.find((p) => p.id === a.platform);
            return (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                <span className={cn("inline-grid h-3.5 w-3.5 place-items-center rounded-[2px] text-[7px] font-black text-white", plat?.color ?? "bg-zinc-700")}>{plat?.icon}</span>
                {a.platform_username ?? a.platform}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {unconnected.map((p) => (
          <a key={p.id} href="/integrations"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition hover:border-white/[.12] hover:text-zinc-200">
            <span className={cn("inline-grid h-3.5 w-3.5 place-items-center rounded-[2px] text-[7px] font-black", p.color, p.id === "twitter" ? "" : "text-white")}>{p.icon}</span>
            + {p.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─── Processing view (SSE + polling fallback) ─── */
function ProcessingView({
  video,
  onDone,
}: {
  video: VideoResponse;
  onDone: (updated: VideoResponse) => void;
}) {
  const [current, setCurrent] = useState(video);
  const [liveMsg, setLiveMsg] = useState<string>("");
  const doneRef = useRef(false);

  const isTerminal = (v: VideoResponse) =>
    v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

  // SSE for real-time progress messages
  useEffect(() => {
    if (!current.celery_task_id || doneRef.current) return;
    const token = localStorage.getItem("viralo_access_token") || "";
    const url = `http://localhost:8003/api/v1/video/progress/${current.celery_task_id}`;
    const es = new EventSource(`${url}?token=${encodeURIComponent(token)}`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "keepalive") return;
        if (d.message) setLiveMsg(d.message);
        if (d.status === "complete" || d.status === "failed") {
          es.close();
          if (!doneRef.current) {
            doneRef.current = true;
            videoApi.get(current.id).then(onDone).catch(() => onDone(current));
          }
        }
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [current.celery_task_id]);

  // Polling fallback — keeps video state fresh
  useEffect(() => {
    if (doneRef.current) return;
    if (isTerminal(current)) {
      if (!doneRef.current) { doneRef.current = true; setTimeout(() => onDone(current), 400); }
      return;
    }
    const id = setTimeout(async () => {
      try {
        const updated = await videoApi.get(current.id);
        setCurrent(updated);
        if (isTerminal(updated) && !doneRef.current) {
          doneRef.current = true;
          setTimeout(() => onDone(updated), 400);
        }
      } catch { /* retry next tick */ }
    }, 3000);
    return () => clearTimeout(id);
  }, [current]);

  const overallPct = Math.min(Math.max(current.pipeline_pct ?? 0, 0), 100);
  const stepIdx = pipelineStepIdx(current.pipeline_step);
  const grad = gradFromId(current.id);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3.5 rounded-[13px] border border-white/[.07] bg-[#0e1420] p-4">
        <div className={cn("grid h-12 w-16 flex-none place-items-center overflow-hidden rounded-[9px] bg-gradient-to-br", grad)}>
          <span className="text-xl">🎬</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{current.title ?? "Untitled"}</div>
          <div className="mt-0.5 flex gap-1.5 text-[11.5px] text-zinc-500">
            <span>{current.source_type === "youtube" ? "YouTube" : "Uploaded file"}</span>
            {current.duration_sec && <><span>·</span><span>{fmtDur(current.duration_sec)}</span></>}
          </div>
        </div>
        {current.status === "failed"
          ? <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed</span>
          : <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-300/20 bg-yellow-400/10 px-2.5 py-1 text-[11px] font-semibold text-yellow-300"><span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />Processing</span>}
      </div>

      <div>
        <div className="mb-2 flex justify-between text-[12px] font-medium">
          <span className="text-zinc-500">Overall progress</span>
          <span className="font-mono font-semibold text-zinc-200">{overallPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] transition-[width_.3s_linear]" style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      <SocialConnectBanner />

      <div className="space-y-2">
        {PROC_STEPS.map((step, i) => {
          const done = overallPct === 100 ? true : i < stepIdx;
          const active = !done && i === stepIdx;
          const state = done ? "done" : active ? "active" : "wait";
          return (
            <div key={step.keys[0]} className={cn(
              "flex items-start gap-3.5 rounded-[11px] border p-3.5 transition",
              state === "done"   ? "border-white/[.05] bg-white/[.015] opacity-70"
            : state === "active" ? "border-[#ff3d6a]/20 bg-[#ff3d6a]/[.04]"
            : "border-white/[.04] bg-transparent opacity-40"
            )}>
              <div className={cn(
                "mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-[8px] border text-sm",
                state === "done"   ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-300"
              : state === "active" ? "border-[#ff3d6a]/25 bg-[#ff3d6a]/10"
              : "border-white/[.07] bg-white/[.03] text-zinc-600"
              )}>
                {state === "done"   ? "✓"
               : state === "active" ? <span className="block h-4 w-4 rounded-full border-2 border-[#ff3d6a] border-t-transparent animate-spin" />
               : <span className="opacity-50">{step.emoji}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("text-[13px] font-semibold", state === "done" ? "text-zinc-400" : state === "active" ? "text-white" : "text-zinc-600")}>{step.label}</div>
                <div className="mt-0.5 text-[11.5px] text-zinc-500">{state === "done" ? "Completed" : step.sub}</div>
                {state === "active" && liveMsg && (
                  <div className="mt-1.5 text-[11px] text-zinc-400 leading-snug">{liveMsg}</div>
                )}
                {state === "active" && !liveMsg && current.pipeline_step && (
                  <div className="mt-1 text-[10.5px] font-mono text-zinc-600">{current.pipeline_step}</div>
                )}
              </div>
              {state === "done" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Done
                </span>
              )}
              {state === "active" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300/20 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />{overallPct}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Clip card ─── */
function ClipCard({ clip, idx, selected = false, onToggleSelect }: {
  clip: ClipApiResponse;
  idx: number;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [playing,        setPlaying]        = useState(false);
  const [showEditor,     setShowEditor]     = useState(false);
  const [showDl,         setShowDl]         = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showPublish,    setShowPublish]    = useState(false);
  const [regenerating,   setRegenerating]   = useState(false);
  const [localClip,      setLocalClip]      = useState(clip);
  const videoRef = useRef<HTMLVideoElement>(null);

  const durMs   = localClip.duration_ms ?? ((localClip.end_ms ?? 0) - (localClip.start_ms ?? 0));
  const durSec  = durMs / 1000;
  const startSec = (localClip.start_ms ?? 0) / 1000;
  const endSec   = (localClip.end_ms ?? durMs) / 1000;
  const grad     = gradFromId(localClip.id);
  const plats    = localClip.platform ? [localClip.platform] : [];
  const hasVideo = Boolean(localClip.storage_url);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true); }
    else { videoRef.current.pause(); setPlaying(false); }
  };

  const handleRegen = () => {
    setRegenerating(true);
    setTimeout(() => setRegenerating(false), 2200);
  };

  return (
    <>
      <div className={cn("overflow-hidden rounded-[13px] border bg-[#0e1420] transition hover:border-white/[.12]", selected ? "border-[#ff3d6a]/50 shadow-[0_0_0_1px_rgba(255,61,106,.15)]" : "border-white/[.07]")}
        style={{ animation: `fadeUp .3s ${idx * 60}ms cubic-bezier(.22,.8,.4,1) both` }}>

        {/* Thumbnail / video */}
        <div
          className={cn("relative aspect-[9/12] cursor-pointer overflow-hidden",
            !hasVideo && !localClip.thumbnail_url ? `bg-gradient-to-br ${grad}` : "bg-black")}
          onClick={hasVideo ? togglePlay : undefined}
        >
          {hasVideo ? (
            <video ref={videoRef} src={localClip.storage_url!}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline preload="metadata"
              onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
          ) : localClip.thumbnail_url ? (
            <img src={localClip.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}

          {!playing && <div className="absolute inset-0 bg-black/20" />}
          {regenerating && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="block h-10 w-10 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
            </div>
          )}

          {onToggleSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              className={cn(
                "absolute left-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-[5px] border-2 transition",
                selected
                  ? "border-[#ff3d6a] bg-[#ff3d6a] text-white"
                  : "border-white/40 bg-black/40 text-transparent hover:border-white/70"
              )}
            >
              {selected && <span className="text-[10px] font-bold leading-none">✓</span>}
            </button>
          )}
          {plats.length > 0 && (
            <div className="absolute left-2 top-2 flex gap-1">{plats.map((p) => <PlatPill key={p} p={p} />)}</div>
          )}
          {localClip.score != null && (
            <div className="absolute right-2 top-2"><VirChip score={localClip.score} /></div>
          )}
          {hasVideo && !playing && !regenerating && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm">▶</div>
            </div>
          )}
          {durSec > 0 && (
            <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
              {fmtSec(durSec)}
            </div>
          )}
          {localClip.start_ms != null && localClip.end_ms != null && !playing && (
            <div className="absolute left-2 bottom-2 text-[10px] font-mono text-white/70">
              {fmtSec(startSec)} → {fmtSec(endSec)}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-3.5">
          <div className="mb-1.5 text-[13px] font-semibold leading-snug">{localClip.title ?? "Clip"}</div>
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
            {plats.length > 0 && <><span className="flex gap-1">{plats.map((p) => <PlatPill key={p} p={p} />)}</span><span>·</span></>}
            {durSec > 0 && <span>{fmtSec(durSec)} clip</span>}
          </div>

          {/* Transcript */}
          {showTranscript && localClip.caption_srt && (
            <div className="mb-3 max-h-24 overflow-y-auto rounded-[9px] border border-white/[.07] bg-white/[.03] px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-zinc-400">
              {localClip.caption_srt}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {hasVideo && (
              <button onClick={togglePlay}
                className="flex items-center gap-1 rounded-[7px] border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white">
                {playing ? "⏸ Pause" : "▶ Preview"}
              </button>
            )}
            <button onClick={() => setShowEditor(true)}
              className="flex items-center gap-1 rounded-[7px] border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white">
              ✂ Edit
            </button>
            {localClip.caption_srt && (
              <button onClick={() => setShowTranscript((p) => !p)}
                className={cn("flex items-center gap-1 rounded-[7px] border px-2.5 py-1.5 text-[11.5px] font-medium transition",
                  showTranscript ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/10 text-[#ff3d6a]" : "border-white/[.08] bg-white/[.03] text-zinc-300 hover:bg-white/[.07] hover:text-white")}>
                👁 {showTranscript ? "Hide" : "Transcript"}
              </button>
            )}
            <button onClick={handleRegen} disabled={regenerating}
              className="flex items-center gap-1 rounded-[7px] border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white disabled:opacity-50">
              ✦ {regenerating ? "…" : "Regen"}
            </button>
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={() => setShowPublish(true)}
                className="flex items-center gap-1 rounded-[7px] bg-[#ff3d6a] px-2.5 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_2px_10px_rgba(255,61,106,.25)] transition hover:shadow-[0_4px_16px_rgba(255,61,106,.4)]">
                ↗ Publish
              </button>
              <div className="relative">
                <button onClick={(e) => { e.stopPropagation(); setShowDl((p) => !p); }}
                  className="flex items-center rounded-[7px] border border-white/[.08] bg-white/[.03] px-2 py-1.5 text-[11.5px] font-medium text-zinc-400 transition hover:text-white">
                  ↓
                </button>
                {showDl && <DownloadMenu clip={localClip} onClose={() => setShowDl(false)} />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showEditor && (
        <TimelineEditor
          clip={{ id: localClip.id, title: localClip.title, startSec, endSec, storage_url: localClip.storage_url }}
          totalDur={Math.max(endSec + 60, 600)}
          onClose={() => setShowEditor(false)}
          onSave={(c) => setLocalClip((prev) => ({
            ...prev,
            start_ms: c.startSec * 1000,
            end_ms:   c.endSec   * 1000,
            duration_ms: (c.endSec - c.startSec) * 1000,
          }))}
        />
      )}

      {showPublish && (
        <BulkPublishModal
          clips={[localClip]}
          onClose={() => setShowPublish(false)}
        />
      )}
    </>
  );
}

const REGEN_OPTS = [
  { id:"hook",        label:"Optimize hooks"    },
  { id:"top-moments", label:"More top moments"  },
  { id:"captions",    label:"Recaption"          },
  { id:"short",       label:"Shorten to 30s"    },
  { id:"vertical",    label:"Reformat vertical" },
];

/* ─── Bulk publish modal ─── */
function BulkPublishModal({ clips, onClose }: { clips: ClipApiResponse[]; onClose: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [groups, setGroups] = useState<Array<{ id: string; clipIds: string[]; accountId: string; scheduledAt: string }>>(() => {
    const base = new Date(Date.now() + 60 * 60 * 1000);
    return [{ id: crypto.randomUUID(), clipIds: clips.map((c) => c.id), accountId: "", scheduledAt: base.toISOString().slice(0, 16) }];
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformApi.listAccounts()
      .then((accs) => {
        const active = accs.filter((a) => a.is_active);
        setAccounts(active);
        setGroups((prev) => prev.map((g) => ({ ...g, accountId: active[0]?.id ?? "" })));
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
  }, []);

  const addGroup = () => {
    const last = groups[groups.length - 1];
    const nextTime = new Date(new Date(last.scheduledAt).getTime() + 2 * 60 * 60 * 1000);
    setGroups((prev) => [...prev, { id: crypto.randomUUID(), clipIds: [], accountId: accounts[0]?.id ?? "", scheduledAt: nextTime.toISOString().slice(0, 16) }]);
  };

  const removeGroup = (gid: string) => setGroups((prev) => prev.filter((g) => g.id !== gid));

  const toggleClipInGroup = (gid: string, clipId: string) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      return { ...g, clipIds: g.clipIds.includes(clipId) ? g.clipIds.filter((id) => id !== clipId) : [...g.clipIds, clipId] };
    }));
  };

  const updateGroup = (gid: string, patch: Partial<typeof groups[0]>) =>
    setGroups((prev) => prev.map((g) => g.id === gid ? { ...g, ...patch } : g));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      for (const g of groups) {
        const account = accounts.find((a) => a.id === g.accountId);
        if (!account || g.clipIds.length === 0) continue;
        for (const clipId of g.clipIds) {
          await platformApi.schedulePost({
            clip_id: clipId,
            social_account_id: g.accountId,
            platform: account.platform,
            scheduled_at: new Date(g.scheduledAt).toISOString(),
          });
        }
      }
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalScheduled = groups.reduce((n, g) => n + g.clipIds.length, 0);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,15,.85)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-[560px] flex-col rounded-[20px] border border-white/[.1] bg-[#0e1420] shadow-[0_40px_100px_rgba(0,0,0,.7)]"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[.07] px-5 py-4 shrink-0">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a]">↗</div>
          <div>
            <h3 className="font-display text-[15px] font-bold">Bulk Schedule</h3>
            <p className="text-[11.5px] text-zinc-500">Assign clips to time slots across accounts</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] text-zinc-500 hover:text-white">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-green-500/10 text-2xl">✓</div>
              <p className="font-semibold text-green-400">Scheduled!</p>
              <p className="text-xs text-zinc-500">{totalScheduled} clips queued for publishing.</p>
            </div>
          ) : loadingAccounts ? (
            <div className="space-y-3">{[1,2].map((i) => <div key={i} className="h-24 animate-pulse rounded-[10px] bg-white/[.04]" />)}</div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-6 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-lg">⚡</div>
              <p className="text-sm font-semibold text-white">No social accounts connected</p>
              <a href="/integrations" className="rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff3d6a]/85">Connect social media →</a>
            </div>
          ) : (
            <>
              {groups.map((g, gi) => (
                <div key={g.id} className="rounded-[12px] border border-white/[.07] bg-white/[.02] p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11.5px] font-bold text-zinc-400">Slot {gi + 1}</span>
                    {groups.length > 1 && (
                      <button onClick={() => removeGroup(g.id)} className="ml-auto text-[11px] text-zinc-600 hover:text-red-400">Remove</button>
                    )}
                  </div>

                  {/* Account + time */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-600">Account</label>
                      <select value={g.accountId} onChange={(e) => updateGroup(g.id, { accountId: e.target.value })}
                        className="w-full rounded-[8px] border border-white/[.08] bg-[#111827] px-2.5 py-1.5 text-[12px] text-white focus:outline-none">
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.platform.charAt(0).toUpperCase() + a.platform.slice(1)} — @{a.platform_username ?? "?"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-600">Scheduled at</label>
                      <input type="datetime-local" value={g.scheduledAt}
                        onChange={(e) => updateGroup(g.id, { scheduledAt: e.target.value })}
                        className="w-full rounded-[8px] border border-white/[.08] bg-[#111827] px-2.5 py-1.5 text-[12px] text-white focus:outline-none [color-scheme:dark]" />
                    </div>
                  </div>

                  {/* Clip chips */}
                  <div>
                    <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-600">Clips ({g.clipIds.length})</label>
                    <div className="flex flex-wrap gap-1.5">
                      {clips.map((c) => (
                        <button key={c.id} onClick={() => toggleClipInGroup(g.id, c.id)}
                          className={cn("rounded-[7px] border px-2.5 py-1 text-[11px] font-medium transition",
                            g.clipIds.includes(c.id)
                              ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-200"
                              : "border-white/[.07] bg-white/[.03] text-zinc-500 hover:text-zinc-300"
                          )}>
                          {c.title ?? `Clip ${clips.indexOf(c) + 1}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={addGroup}
                className="w-full rounded-[10px] border border-dashed border-white/[.1] py-2.5 text-[12px] font-semibold text-zinc-500 transition hover:border-white/20 hover:text-zinc-300">
                + Add time slot
              </button>

              {error && <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && accounts.length > 0 && (
          <div className="flex gap-2.5 border-t border-white/[.07] px-5 py-4 shrink-0">
            <button onClick={onClose} className="rounded-[9px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-300 hover:text-white">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting || totalScheduled === 0}
              className="ml-auto flex items-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
              {submitting ? "Scheduling…" : `↗ Schedule ${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Results view ─── */
function ResultsView({
  video,
  clips,
  onBack,
}: {
  video: VideoResponse;
  clips: ClipApiResponse[];
  onBack: () => void;
}) {
  const grad = gradFromId(video.id);
  const [regenModal, setRegenModal] = useState(false);
  const [regenOpts, setRegenOpts] = useState(["hook","top-moments","captions"]);
  const toggleOpt = (id: string) => setRegenOpts((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const toggleSelect = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const selectAll = () => setSelected(new Set(clips.map((c) => c.id)));
  const clearSel = () => setSelected(new Set());

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white">
          ‹ New upload
        </button>
        <div className={cn("h-7 w-10 flex-none rounded-[6px] bg-gradient-to-br", grad)} />
        <h2 className="font-display text-[18px] font-bold">{video.title ?? "Untitled"}</h2>
        <span className="rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">
          {clips.length} clips
        </span>
        {(video.status === "done" || video.status === "ready")
          ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Ready</span>
          : <span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed</span>}
        <div className="ml-auto flex shrink-0 gap-2">
          <button
            onClick={() => { selectAll(); setBulkModal(true); }}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#ff3d6a]/85"
          >
            ↗ Publish all
          </button>
          <button onClick={() => setRegenModal(true)}
            className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:text-white">
            ✦ Regenerate all
          </button>
          {video.storage_url && (
            <a
              href={video.storage_url}
              download
              className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white"
            >
              ↓ Source video
            </a>
          )}
          <button className="flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)]">
            ↓ Download all
          </button>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold text-rose-300">{selected.size} clip{selected.size > 1 ? "s" : ""} selected</span>
          <button onClick={clearSel} className="text-[11.5px] text-zinc-500 hover:text-zinc-300">Clear</button>
          <button onClick={selectAll} className="text-[11.5px] text-zinc-500 hover:text-zinc-300">Select all</button>
          <button
            onClick={() => setBulkModal(true)}
            className="ml-auto flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            ↗ Schedule {selected.size} clip{selected.size > 1 ? "s" : ""}
          </button>
        </div>
      )}
      {clips.length > 0
        ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{clips.map((c, i) => (
            <ClipCard
              key={c.id}
              clip={c}
              idx={i}
              selected={selected.has(c.id)}
              onToggleSelect={() => toggleSelect(c.id)}
            />
          ))}</div>
        : <div className="py-16 text-center text-zinc-500">No clips generated yet.</div>}

      {bulkModal && (
        <BulkPublishModal
          clips={clips.filter((c) => selected.has(c.id))}
          onClose={() => { setBulkModal(false); clearSel(); }}
        />
      )}

      {/* Regenerate modal */}
      {regenModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6"
          style={{ background: "rgba(4,7,15,.8)", backdropFilter: "blur(6px)", animation: "fadeUp .15s ease" }}
          onClick={(e) => e.target === e.currentTarget && setRegenModal(false)}>
          <div className="w-full max-w-[460px] overflow-hidden rounded-[20px] border border-white/[.12] bg-[#0e1420] p-6 shadow-[0_40px_100px_rgba(0,0,0,.7)]"
            style={{ animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a]">✦</div>
              <div>
                <h3 className="font-display text-[16px] font-bold">Regenerate clips</h3>
                <p className="text-[12px] text-zinc-500">Choose what to optimize in the new batch</p>
              </div>
              <button onClick={() => setRegenModal(false)} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] text-[13px] text-zinc-500 hover:text-white">✕</button>
            </div>

            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[.1em] text-zinc-600">Optimization options</div>
            <div className="mb-5 flex flex-wrap gap-2">
              {REGEN_OPTS.map((o) => (
                <button key={o.id} onClick={() => toggleOpt(o.id)}
                  className={cn("rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition",
                    regenOpts.includes(o.id)
                      ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-[#ff3d6a]"
                      : "border-white/[.07] bg-white/[.03] text-zinc-400 hover:border-white/[.12] hover:text-zinc-200"
                  )}>
                  {o.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5">
              <button onClick={() => setRegenModal(false)}
                className="rounded-[9px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:text-white">
                Cancel
              </button>
              <button onClick={() => setRegenModal(false)}
                className="ml-auto flex items-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)]">
                ✦ Regenerate {clips.length} clips
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main UploadPage ─── */
export function UploadPage() {
  const [source, setSource] = useState<Source>("file");
  const [view, setView] = useState<View>("upload");
  const [activeVideo, setActiveVideo] = useState<VideoResponse | null>(null);
  const [clips, setClips] = useState<ClipApiResponse[]>([]);
  const [drag, setDrag] = useState(false);
  const [urlVal, setUrlVal] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [history, setHistory] = useState<VideoResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoResponse | null>(null);
  const [clipConfig, setClipConfig] = useState<ClipConfig>(DEFAULT_CONFIG);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTerminalStatus = (v: VideoResponse) =>
    v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

  /* Load history on mount */
  useEffect(() => {
    videoApi.list().then((res) => {
      setHistory(res.items);
    }).catch(() => {}).finally(() => setHistoryLoading(false));
  }, []);

  /* Poll in-progress videos in history every 3s */
  useEffect(() => {
    const inProgress = history.filter((v) => !isTerminalStatus(v));
    if (inProgress.length === 0) return;
    const t = setTimeout(async () => {
      const updates = await Promise.allSettled(inProgress.map((v) => videoApi.get(v.id)));
      setHistory((prev) =>
        prev.map((v) => {
          const idx = inProgress.findIndex((p) => p.id === v.id);
          if (idx === -1) return v;
          const result = updates[idx];
          return result.status === "fulfilled" ? result.value : v;
        })
      );
    }, 3000);
    return () => clearTimeout(t);
  }, [history]);

  /* YouTube URL validation */
  useEffect(() => {
    if (!urlVal.trim()) { setUrlReady(false); return; }
    const t = setTimeout(() => {
      const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/.test(urlVal.trim());
      setUrlReady(valid);
      if (!valid) setUploadError("Enter a valid YouTube URL (youtube.com/watch?v=… or youtu.be/…)");
      else setUploadError("");
    }, 600);
    return () => clearTimeout(t);
  }, [urlVal]);

  const handleFile = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.upload(file, file.name.replace(/\.[^.]+$/, ""), clipConfig);
      setHistory((h) => [video, ...h]);
      setActiveVideo(video);
      setView("processing");
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [clipConfig]);

  const handleUrlFetch = useCallback(async () => {
    if (!urlVal.trim()) return;
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.youtube(urlVal.trim(), undefined, clipConfig);
      setHistory((h) => [video, ...h]);
      setActiveVideo(video);
      setUrlVal("");
      setUrlReady(false);
      setView("processing");
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(false);
    }
  }, [urlVal, clipConfig]);

  const handleDone = useCallback(async (updated: VideoResponse) => {
    setHistory((h) => h.map((v) => v.id === updated.id ? updated : v));
    setActiveVideo(updated);
    if (updated.status === "done" || updated.status === "ready") {
      try {
        const clipList = await videoApi.clips(updated.id);
        setClips(clipList);
      } catch { setClips([]); }
    }
    setView("results");
  }, []);

  const loadVideo = useCallback(async (vid: VideoResponse) => {
    if (vid.status === "processing" || vid.status === "pending") {
      setActiveVideo(vid);
      setView("processing");
      return;
    }
    setActiveVideo(vid);
    if (vid.status === "done" || vid.status === "ready") {
      try {
        const clipList = await videoApi.clips(vid.id);
        setClips(clipList);
      } catch { setClips([]); }
    }
    setView("results");
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, vid: VideoResponse) => {
    e.stopPropagation();
    setDeleteTarget(vid);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const vid = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(vid.id);
    try {
      await videoApi.delete(vid.id);
      setHistory((h) => h.filter((v) => v.id !== vid.id));
      if (activeVideo?.id === vid.id) {
        setActiveVideo(null);
        setClips([]);
        setView("upload");
      }
    } catch { /* ignore — leave in list */ }
    finally { setDeletingId(null); }
  }, [deleteTarget, activeVideo]);

  return (
    <Shell active="upload">
      {deleteTarget && (
        <DeleteModal
          video={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <div className="flex h-[calc(100vh-116px)] overflow-hidden rounded-[13px] border border-white/[.07] bg-[#0e1420]">
        {/* ─── Left: History ─── */}
        <div className="flex w-[264px] flex-none flex-col border-r border-white/[.07]">
          <div className="flex-none border-b border-white/[.07] px-4 py-4">
            <h3 className="font-display text-[14px] font-bold">Project History</h3>
            <p className="mt-0.5 text-[11.5px] text-zinc-500">{historyLoading ? "Loading…" : `${history.length} projects`}</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {historyLoading && (
              <div className="flex items-center justify-center py-8 text-zinc-600 text-[12px]">
                <span className="mr-2 block h-3 w-3 rounded-full border-2 border-[#ff3d6a] border-t-transparent animate-spin" />Loading…
              </div>
            )}
            {!historyLoading && history.length === 0 && (
              <div className="py-8 text-center text-[12px] text-zinc-600">No uploads yet</div>
            )}
            {history.map((vid) => {
              const grad = gradFromId(vid.id);
              const isProc = vid.status === "pending" || vid.status === "processing";
              const isDeleting = deletingId === vid.id;
              return (
                <div
                  key={vid.id}
                  onClick={() => !isDeleting && loadVideo(vid)}
                  className={cn(
                    "group flex items-center gap-3 border-b border-white/[.05] px-4 py-3 transition cursor-pointer hover:bg-white/[.03]",
                    activeVideo?.id === vid.id ? "bg-white/[.04]" : "",
                    isDeleting ? "opacity-50 pointer-events-none" : ""
                  )}
                >
                  <div className={cn("relative grid h-9 w-12 flex-none place-items-center overflow-hidden rounded-[7px] bg-gradient-to-br", grad)}>
                    {vid.thumbnail_url
                      ? <img src={vid.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      : isProc
                        ? <span className="block h-3 w-3 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
                        : <span className="text-[10px] text-white">▶</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold">{vid.title ?? "Untitled"}</div>
                    <div className="mt-0.5 flex gap-1 text-[11px] text-zinc-500">
                      <span>{vid.source_type === "youtube" || vid.source_type === "youtube_url" ? "YouTube" : "File"}</span>
                      <span>·</span>
                      {isTerminalStatus(vid) && vid.status !== "failed"
                        ? <span className="font-semibold text-emerald-400">Ready</span>
                        : vid.status === "failed"
                          ? <span className="font-semibold text-red-400">Failed</span>
                          : <span className="font-semibold text-yellow-400">Processing…</span>}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, vid)}
                    className="ml-auto flex-none opacity-0 group-hover:opacity-100 grid h-6 w-6 place-items-center rounded-[5px] text-zinc-600 transition hover:bg-red-400/10 hover:text-red-400"
                    title="Delete"
                  >
                    {isDeleting
                      ? <span className="block h-3 w-3 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex-none border-t border-white/[.07] p-3">
            <button
              onClick={() => { setView("upload"); setActiveVideo(null); setClips([]); setUploadError(""); }}
              className="flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-[#ff3d6a] py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.25)] transition hover:shadow-[0_4px_18px_rgba(255,61,106,.4)]"
            >
              + New upload
            </button>
          </div>
        </div>

        {/* ─── Right: Main ─── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-none border-b border-white/[.07] px-7 py-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-[22px] font-bold tracking-[-0.01em]">
                  {view === "upload" ? "Upload & Clip"
                  : view === "processing" ? "Processing…"
                  : "Generated Clips"}
                </h2>
                <p className="mt-1 text-[13px] text-zinc-500">
                  {view === "upload"      ? "Upload a video or paste a YouTube URL — AI clips the best moments automatically"
                  : view === "processing" ? "AI is analyzing your video and generating clips"
                  : "Preview, edit, download or publish your clips below"}
                </p>
              </div>
            </div>

            {view === "upload" && (
              <div className="mt-4 flex gap-1 rounded-[9px] border border-white/[.07] bg-white/[.03] p-1 w-fit">
                {(["file", "yt"] as Source[]).map((s) => (
                  <button key={s} onClick={() => { setSource(s); setUploadError(""); }}
                    className={cn("rounded-[7px] px-4 py-1.5 text-[12.5px] font-semibold transition",
                      source === s ? "bg-white/[.08] text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                    )}>
                    {s === "file" ? "🎬 Upload File" : "🌐 YouTube URL"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-7 py-6">
            {/* Upload — file */}
            {view === "upload" && source === "file" && (
              <div>
                <div
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files); }}
                  className={cn(
                    "grid min-h-[300px] cursor-pointer place-items-center rounded-[18px] border border-dashed p-10 text-center transition",
                    uploading ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.02] cursor-default"
                    : drag    ? "border-[#ff3d6a]/60 bg-[#ff3d6a]/[.04]"
                    : "border-white/15 bg-white/[.02] hover:border-white/25 hover:bg-white/[.03]"
                  )}
                >
                  <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />
                  <div>
                    {uploading
                      ? <>
                          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center">
                            <span className="block h-10 w-10 rounded-full border-[3px] border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
                          </div>
                          <h3 className="font-display text-xl font-bold">Uploading…</h3>
                          <p className="mt-2 text-[13px] text-zinc-500">Transferring your video to Viralo</p>
                        </>
                      : <>
                          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-2xl">🎬</div>
                          <h3 className="font-display text-2xl font-bold">{drag ? "Drop to upload" : "Drop your video here"}</h3>
                          <p className="mt-2 text-[13px] text-zinc-500">MP4, MOV, WebM, MKV · up to 4 GB</p>
                          <p className="mt-1 text-[12.5px] text-zinc-600">AI will transcribe, score, and clip the best moments automatically.</p>
                          <div className="mt-5 flex flex-wrap justify-center gap-2">
                            {["MP4","MOV","WebM","MKV","AVI"].map((f) => (
                              <span key={f} className="rounded-[6px] border border-white/[.08] bg-white/[.04] px-2.5 py-1 text-[11px] font-mono font-semibold text-zinc-400">{f}</span>
                            ))}
                          </div>
                          <button className="mt-5 rounded-[9px] border border-white/[.10] bg-white/[.05] px-5 py-2 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/[.09] hover:text-white">
                            Browse files
                          </button>
                        </>}
                  </div>
                </div>

                {uploadError && (
                  <div className="mt-3 rounded-[9px] border border-red-400/20 bg-red-400/[.07] px-4 py-2.5 text-[12.5px] font-medium text-red-400">
                    {uploadError}
                  </div>
                )}

                <ClipConfigPanel config={clipConfig} onChange={setClipConfig} />

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {[
                    { emoji:"📝", title:"Auto transcription",   sub:"Full speech-to-text in 60+ languages" },
                    { emoji:"✂",  title:"Smart clip selection", sub:"AI picks top moments by virality score" },
                    { emoji:"📤", title:"One-click publish",    sub:"Post to TikTok, Reels, Shorts + more" },
                  ].map((f) => (
                    <div key={f.title} className="rounded-[13px] border border-white/[.07] bg-white/[.025] p-4">
                      <div className="mb-2.5 text-2xl">{f.emoji}</div>
                      <div className="text-[13.5px] font-semibold">{f.title}</div>
                      <div className="mt-1 text-[12.5px] leading-[1.55] text-zinc-500">{f.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload — YouTube */}
            {view === "upload" && source === "yt" && (
              <div>
                <div className="rounded-[16px] border border-white/[.08] bg-white/[.025] p-6">
                  <h3 className="font-display text-[16px] font-bold">YouTube URL</h3>
                  <p className="mt-1 text-[13px] text-zinc-500">Paste any YouTube link — we'll download, transcribe, and clip the best moments.</p>
                  <div className="mt-5 flex gap-2">
                    <input
                      value={urlVal}
                      onChange={(e) => setUrlVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && urlReady && !uploading && handleUrlFetch()}
                      placeholder="https://youtube.com/watch?v=…"
                      className="flex-1 rounded-[9px] border border-white/[.08] bg-white/[.04] px-4 py-2.5 text-[13px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]"
                    />
                    <button
                      disabled={!urlReady || uploading}
                      onClick={handleUrlFetch}
                      className="rounded-[9px] border border-white/[.08] bg-white/[.05] px-4 py-2.5 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/[.09] disabled:opacity-40"
                    >
                      {uploading ? <span className="block h-4 w-4 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" /> : "🔍"}
                    </button>
                  </div>

                  {urlReady && !uploading && (
                    <div className="mt-4 flex items-center gap-4 rounded-[11px] border border-white/[.08] bg-white/[.03] p-3.5" style={{ animation: "fadeUp .2s ease" }}>
                      <div className="relative grid h-14 w-[88px] flex-none place-items-center overflow-hidden rounded-[9px] bg-gradient-to-br from-red-600 to-[#FF7A3D]">
                        <span className="relative z-[1] text-xl text-white">▶</span>
                      </div>
                      <div className="flex-1">
                        <div className="text-[13.5px] font-semibold">YouTube video detected</div>
                        <div className="mt-0.5 text-[12px] text-zinc-500">Ready to import and clip</div>
                      </div>
                      <button onClick={handleUrlFetch}
                        className="flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_10px_rgba(255,61,106,.3)]">
                        ✦ Clip it
                      </button>
                    </div>
                  )}

                  {uploadError && (
                    <div className="mt-3 rounded-[9px] border border-red-400/20 bg-red-400/[.07] px-4 py-2.5 text-[12.5px] font-medium text-red-400">
                      {uploadError}
                    </div>
                  )}
                </div>

                <ClipConfigPanel config={clipConfig} onChange={setClipConfig} />

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    { emoji:"🌐", title:"Any YouTube video",   sub:"Paste any public URL — channels, playlists, individual videos" },
                    { emoji:"✂",  title:"Auto-clip to Shorts", sub:"3–7 viral clips extracted, formatted for every platform" },
                  ].map((f) => (
                    <div key={f.title} className="rounded-[13px] border border-white/[.07] bg-white/[.025] p-4">
                      <div className="mb-2.5 text-2xl">{f.emoji}</div>
                      <div className="text-[13.5px] font-semibold">{f.title}</div>
                      <div className="mt-1 text-[12.5px] leading-[1.55] text-zinc-500">{f.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Processing */}
            {view === "processing" && activeVideo && (
              <ProcessingView video={activeVideo} onDone={handleDone} />
            )}

            {/* Results */}
            {view === "results" && activeVideo && (
              <ResultsView
                video={activeVideo}
                clips={clips}
                onBack={() => { setView("upload"); setActiveVideo(null); setClips([]); setUploadError(""); }}
              />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Shell>
  );
}
