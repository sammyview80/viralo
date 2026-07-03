import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import { videoApi, type ClipConfig, type VideoResponse } from "@/lib/api";
import { DEFAULT_CONFIG } from "./UploadPage";
import { CAPTION_STYLES, type CaptionStyleOption } from "./upload/constants";

// ── YouTube Import Modal ──────────────────────────────────────────────────────

type YtMeta = { title: string; thumbnail: string; duration: number | null; quality: string };

interface YoutubeModalProps {
  onClose: () => void;
  initialUrl?: string;
  prefetched?: YtMeta | null;
}

function fmtClock(sec: number | null): string {
  if (!sec) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ── Config option sets ──────────────────────────────────────────────────────

const RATIOS = ["9:16", "1:1", "16:9", "4:5"] as const;

const CLIP_LENGTHS: { id: string; label: string; min?: number; max?: number }[] = [
  { id: "any",    label: "Any length" },
  { id: "<30",    label: "Under 30s", min: 5,  max: 30 },
  { id: "30-60",  label: "30 – 60s",  min: 30, max: 60 },
  { id: "60-90",  label: "60 – 90s",  min: 60, max: 90 },
  { id: "90+",    label: "90s and up", min: 90, max: 180 },
];

const CLIP_COUNTS: { id: string; label: string; value?: number }[] = [
  { id: "auto", label: "Auto" },
  { id: "3",    label: "3",  value: 3 },
  { id: "5",    label: "5",  value: 5 },
  { id: "10",   label: "10", value: 10 },
];

const TEMPLATE_TABS = ["9:16 template", "My template", "Brand template"] as const;

// One card per backend caption style (CAPTION_STYLES is the same list the
// ClipConfigPanel picker uses — kept in sync with GET /caption-styles).
const TEMPLATE_BG: Record<string, string> = {
  auto:          "from-zinc-800 to-zinc-950",
  "tiktok":      "from-zinc-700 to-zinc-950",
  "word-pop":    "from-rose-700 to-red-950",
  "capcut":      "from-amber-700 to-orange-900",
  "capcut-bold": "from-orange-600 to-amber-950",
  "hormozi":     "from-emerald-700 to-green-950",
  "beast":       "from-sky-600 to-blue-900",
  "neon":        "from-indigo-700 to-violet-950",
  "karaoke":     "from-fuchsia-700 to-purple-950",
  "bounce":      "from-yellow-600 to-amber-950",
  "glow":        "from-cyan-800 to-slate-950",
  "shadow":      "from-pink-700 to-rose-950",
  "highlighter": "from-lime-700 to-emerald-950",
  "rainbow":     "from-purple-600 to-indigo-950",
  "classic":     "from-zinc-600 to-zinc-900",
  "impact":      "from-stone-600 to-stone-900",
  "minimal":     "from-slate-600 to-slate-900",
};

function CaptionCard({ s, selected, onSelect }: { s: CaptionStyleOption; selected: boolean; onSelect: () => void }) {
  const outlineShadow = "0 0 2px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000";
  const hl = s.highlight ?? "#f5c518";
  const tx = (w: string) => (s.uppercase ? w.toUpperCase() : w);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hl.slice(i, i + 2), 16));
  const pillText = 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000" : "#fff";

  const sample = (() => {
    if (!s.id) {
      return <span className="text-[13px]">✨<br /><span className="text-[9px] font-black text-emerald-300">Best match</span></span>;
    }
    switch (s.family) {
      case "pill":
        return (
          <span className="inline-flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
            <span className="text-[9px] font-black text-white" style={{ textShadow: "1px 1px 0 #000" }}>{tx("here is")}</span>
            <span className="rounded-[3px] px-1 py-px text-[9px] font-black" style={{ background: hl, color: pillText }}>{tx("your")}</span>
            <span className="text-[9px] font-black text-white" style={{ textShadow: "1px 1px 0 #000" }}>{tx("subtitle")}</span>
          </span>
        );
      case "reveal":
        return (
          <span className="inline-flex flex-col items-center gap-0.5">
            <span className="rounded-[4px] bg-black/85 px-1.5 py-0.5 text-[9px] font-bold text-white">Here is your</span>
            <span className="rounded-[4px] bg-black/85 px-1.5 py-0.5 text-[9px] font-bold text-white">subtitle</span>
          </span>
        );
      case "pop":
        return <span className="text-[16px] font-black text-white" style={{ textShadow: outlineShadow }}>WOW</span>;
      case "karaoke":
        return (
          <span className="whitespace-nowrap rounded-[3px] bg-black/75 px-1.5 py-0.5 text-[8.5px] font-bold text-white">
            here is <span style={{ color: hl }}>your</span> subtitle
          </span>
        );
      case "outline":
        return (
          <span className={cn("font-black leading-tight text-white", s.uppercase ? "text-[10px]" : "text-[9.5px]")}
            style={{ textShadow: outlineShadow }}>{tx("Here is your subtitle")}</span>
        );
      case "bounce":
        return (
          <span className="inline-flex items-end justify-center gap-1 font-black" style={{ textShadow: outlineShadow }}>
            <span className="text-[9px] text-white">here is</span>
            <span className="text-[12px]" style={{ color: hl }}>your</span>
            <span className="text-[9px] text-white">subtitle</span>
          </span>
        );
      case "glow":
        return (
          <span className="text-[9.5px] font-black text-white"
            style={{ textShadow: `0 0 5px ${hl}, 0 0 10px ${hl}, 0 0 2px #000` }}>
            here is <span style={{ color: hl }}>your</span> subtitle
          </span>
        );
      case "shadow":
        return (
          <span className="text-[10.5px] font-black uppercase leading-tight text-white"
            style={{ textShadow: `3px 3px 0 ${hl}, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000` }}>
            here is your subtitle
          </span>
        );
      case "highlighter":
        return (
          <span className="inline-flex flex-wrap items-center justify-center gap-1 text-[9px] font-black text-white" style={{ textShadow: "1px 1px 0 #000" }}>
            here is <span className="rounded-[3px] px-1 py-px" style={{ background: hl, color: pillText }}>your</span> subtitle
          </span>
        );
      case "rainbow":
        return (
          <span className="inline-flex flex-wrap justify-center gap-1 text-[9.5px] font-black" style={{ textShadow: outlineShadow }}>
            <span style={{ color: "#ff5252" }}>here</span>
            <span style={{ color: "#ffa528" }}>is</span>
            <span style={{ color: "#fadc32" }}>your</span>
            <span style={{ color: "#46c8ff" }}>subtitle</span>
          </span>
        );
      default: // minimal
        return <span className="text-[9px] font-semibold text-zinc-200/90">here is your subtitle</span>;
    }
  })();

  const posCls = !s.id ? "top-1/2 -translate-y-1/2" : s.family === "pop" ? "top-[44%]" : s.family === "minimal" ? "bottom-4" : "bottom-7";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group shrink-0 cursor-pointer text-center"
    >
      <div className={cn(
        "relative h-[200px] w-[118px] overflow-hidden rounded-[14px] border-2 bg-gradient-to-b transition",
        TEMPLATE_BG[s.id ?? "auto"] ?? "from-zinc-700 to-zinc-900",
        selected ? "border-[#ff3d6a] shadow-[0_0_0_3px_rgba(255,61,106,.25)]" : "border-c-border group-hover:border-c-border-hover"
      )}>
        {/* top mock title */}
        {s.id && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2">
            <span className="rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[7px] font-bold text-white whitespace-nowrap">Your video title</span>
          </div>
        )}
        {/* selected check */}
        {selected && (
          <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[#ff3d6a] text-white shadow">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>
          </span>
        )}
        {/* sample caption at the style's real burn-in position */}
        <div className={cn("absolute left-0 right-0 px-1.5 text-center", posCls)}>{sample}</div>
      </div>
      <p className={cn("mt-2 text-[12px] font-bold", selected ? "text-[#ff7a9a]" : "text-c-text-muted")}>{s.label}</p>
    </button>
  );
}

function FeatureCheck({ label, checked, onChange, badge }: { label: string; checked: boolean; onChange: () => void; badge?: boolean }) {
  return (
    <button type="button" onClick={onChange} className="flex cursor-pointer items-center gap-2 text-left">
      <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition", checked ? "border-[#ff3d6a] bg-[#ff3d6a]" : "border-c-border bg-surface-2")}>
        {checked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>}
      </span>
      <span className="text-[13px] font-semibold text-c-text">{label}</span>
      {badge && <span className="text-[11px]">💎</span>}
      <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-c-border text-[8px] font-bold text-c-text-muted">i</span>
    </button>
  );
}

export function YoutubeImportModal({ onClose, initialUrl = "", prefetched = null }: YoutubeModalProps) {
  const [urlVal, setUrlVal]       = useState(initialUrl);
  const [urlReady, setUrlReady]   = useState(Boolean(prefetched));
  const [ytMeta, setYtMeta]       = useState<YtMeta | null>(prefetched);
  // When metadata is prefetched on the homepage, the modal opens already populated.
  const [ytMetaLoading, setYtMetaLoading] = useState(Boolean(initialUrl.trim()) && !prefetched);
  // URL whose metadata we already hold — skip the effect's refetch for it.
  const fetchedUrlRef = useRef(prefetched ? initialUrl.trim() : "");
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState("");

  // config state
  const [ratio, setRatio]         = useState<string>("9:16");
  const [clipLen, setClipLen]     = useState<string>("any");
  const [clipCount, setClipCount] = useState<string>("auto");
  const [tab, setTab]             = useState<typeof TEMPLATE_TABS[number]>("9:16 template");
  const [template, setTemplate]   = useState<string>("tiktok");
  const [feat, setFeat]           = useState({ emoji: true, highlight: true, silences: false, brolls: false });
  const [findMoment, setFindMoment] = useState("");
  const [autoSchedule, setAutoSchedule] = useState(false);

  const carouselRef = useRef<HTMLDivElement>(null);

  // validate + fetch metadata
  useEffect(() => {
    if (!urlVal.trim()) { setUrlReady(false); setYtMeta(null); setYtMetaLoading(false); setError(""); return; }
    // Already have this URL's metadata (prefetched on the homepage) — don't refetch.
    if (urlVal.trim() === fetchedUrlRef.current) return;
    let alive = true;
    const t = setTimeout(async () => {
      const v = urlVal.trim();
      const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/.test(v);
      setUrlReady(valid);
      if (!valid) { setError("Enter a valid YouTube URL"); setYtMeta(null); setYtMetaLoading(false); return; }
      setError("");
      setYtMeta(null);
      setYtMetaLoading(true);
      const vidId = v.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1] ?? "";
      const thumbnail = vidId ? `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg` : "";
      try {
        const m = await videoApi.youtubeInspect(v);
        if (!alive) return;
        fetchedUrlRef.current = v;
        setYtMeta({ title: m.title || "", thumbnail: m.thumbnail_url || thumbnail, duration: m.duration_sec ?? null, quality: "1080p" });
      } catch {
        try {
          const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(v)}&format=json`);
          const d = r.ok ? await r.json() : {};
          if (!alive) return;
          setYtMeta({ title: d.title || "", thumbnail: thumbnail || d.thumbnail_url || "", duration: null, quality: "1080p" });
        } catch {
          if (alive) setError("Could not load video details");
        }
      } finally {
        if (alive) setYtMetaLoading(false);
      }
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [urlVal]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleImport = useCallback(async () => {
    if (!urlVal.trim() || !urlReady) return;
    setUploading(true);
    setError("");
    try {
      const tpl = CAPTION_STYLES.find((s) => (s.id ?? "auto") === template);
      const len = CLIP_LENGTHS.find((c) => c.id === clipLen);
      const cnt = CLIP_COUNTS.find((c) => c.id === clipCount);
      const cfg: ClipConfig = {
        ...DEFAULT_CONFIG,
        output_quality: "source",
        aspect_ratio: ratio,
        add_captions: true,
        caption_style: tpl?.id ?? null,
        ...(len?.min != null ? { duration_min: len.min, duration_max: len.max } : {}),
        ...(cnt?.value != null ? { max_clips: cnt.value } : {}),
        ...(findMoment.trim() ? { topic_focus: findMoment.trim() } : {}),
      };
      const video = await videoApi.youtube(urlVal.trim(), undefined, cfg);
      navigate(`/projects/${video.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setUploading(false);
    }
  }, [urlVal, urlReady, ratio, clipLen, clipCount, template, findMoment]);

  const selectClass = "flex h-[50px] items-center gap-2 rounded-[12px] border border-c-border bg-surface-2 px-3.5 transition focus-within:border-[#ff3d6a]/50";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative flex max-h-[92vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[20px] border border-c-border bg-surface-0 shadow-[0_40px_120px_rgba(0,0,0,.7)]">

        {/* URL input — only when no video and not loading */}
        {!ytMeta && !ytMetaLoading && (
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-[11px] border border-red-400/25 bg-red-400/[.10]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#f87171"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-[15px] font-bold text-c-text">Import from YouTube</h2>
                <p className="text-[11.5px] text-c-text-muted">Paste a link to preview the video.</p>
              </div>
              <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-[9px] border border-c-border bg-surface-2 text-c-text-muted transition hover:bg-surface-3 hover:text-c-text">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <input
              autoFocus
              value={urlVal}
              onChange={(e) => setUrlVal(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              aria-label="YouTube video URL"
              className="h-[46px] w-full rounded-[12px] border border-c-border bg-surface-1 px-3.5 text-[13.5px] font-medium text-c-text outline-none transition placeholder:text-c-text-muted focus:border-[#ff3d6a]/60 focus:ring-4 focus:ring-[#ff3d6a]/15"
            />
            {error && <p className="mt-2 text-[11.5px] font-medium text-red-400">{error}</p>}
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {ytMetaLoading && (
          <div className="animate-pulse p-5">
            <div className="mb-4 h-[64px] rounded-[14px] border border-c-border bg-surface-1" />
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="h-[50px] rounded-[12px] border border-c-border bg-surface-2" />
              <div className="h-[50px] rounded-[12px] border border-c-border bg-surface-2" />
            </div>
            <div className="flex gap-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[200px] w-[118px] shrink-0 rounded-[14px] bg-surface-2" />)}
            </div>
          </div>
        )}

        {ytMeta && !ytMetaLoading && (
          <>
            {/* scroll body */}
            <div className="min-h-0 flex-1 overflow-y-auto p-5">

              {/* ── Upload-success header ── */}
              <div className="mb-4 flex items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 p-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] bg-surface-2">
                  <img
                    src={ytMeta.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => { const i = e.currentTarget; if (i.src.includes("maxresdefault")) i.src = i.src.replace("maxresdefault", "hqdefault"); }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13.5px] font-bold text-c-text">{ytMeta.title || "YouTube video"}</p>
                    <span className="ml-auto shrink-0 rounded-[6px] bg-surface-2 px-2 py-0.5 text-[10.5px] font-bold text-c-text-muted">{ytMeta.quality}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full w-full rounded-full bg-emerald-500" />
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-c-text-muted">Ready ({fmtClock(ytMeta.duration)})</p>
                </div>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3}><path d="M20 6L9 17l-5-5"/></svg>
                </span>
                <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-c-text-muted transition hover:bg-surface-2 hover:text-c-text">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>

              {/* ── Ratio + Clip length + Number of clips ── */}
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <label className={selectClass}>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Ratio</span>
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="flex-1 cursor-pointer appearance-none bg-transparent text-right text-[13px] font-bold text-c-text outline-none [&>option]:bg-surface-0">
                    {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth={2.2}><path d="M6 9l6 6 6-6"/></svg>
                </label>
                <label className={selectClass}>
                  <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Length</span>
                  <select value={clipLen} onChange={(e) => setClipLen(e.target.value)} className="flex-1 cursor-pointer appearance-none bg-transparent text-right text-[13px] font-bold text-c-text outline-none [&>option]:bg-surface-0">
                    {CLIP_LENGTHS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth={2.2}><path d="M6 9l6 6 6-6"/></svg>
                </label>
                <label className={selectClass}>
                  <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Clips</span>
                  <select value={clipCount} onChange={(e) => setClipCount(e.target.value)} className="flex-1 cursor-pointer appearance-none bg-transparent text-right text-[13px] font-bold text-c-text outline-none [&>option]:bg-surface-0">
                    {CLIP_COUNTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth={2.2}><path d="M6 9l6 6 6-6"/></svg>
                </label>
              </div>

              {/* ── Template tabs ── */}
              <div className="mb-3 flex items-center gap-1 border-b border-c-border">
                {TEMPLATE_TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "relative flex items-center gap-1 px-3 py-2 text-[12.5px] font-bold transition",
                      tab === t ? "text-c-text" : "text-c-text-muted hover:text-c-text-secondary"
                    )}
                  >
                    {t}{t === "Brand template" && <span className="text-[11px]">💎</span>}
                    {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#ff3d6a]" />}
                  </button>
                ))}
              </div>

              {/* ── Caption template carousel ── */}
              {tab === "9:16 template" ? (
                <div className="relative">
                  <div ref={carouselRef} className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {CAPTION_STYLES.map((s) => (
                      <CaptionCard key={String(s.id)} s={s} selected={template === (s.id ?? "auto")} onSelect={() => setTemplate(s.id ?? "auto")} />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => carouselRef.current?.scrollBy({ left: 280, behavior: "smooth" })}
                    className="absolute right-1 top-[92px] grid h-8 w-8 place-items-center rounded-full border border-c-border bg-surface-0 text-c-text shadow-lg transition hover:bg-surface-3"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                </div>
              ) : (
                <div className="grid place-items-center rounded-[14px] border border-dashed border-c-border bg-surface-1 py-12 text-center">
                  <p className="text-[12.5px] font-semibold text-c-text-muted">{tab === "My template" ? "No saved templates yet" : "Brand templates are a premium feature"}</p>
                </div>
              )}

              {/* ── Feature toggles ── */}
              <div className="mt-4 rounded-[14px] border border-c-border bg-surface-1 p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <FeatureCheck label="Add emoji"         checked={feat.emoji}     onChange={() => setFeat((f) => ({ ...f, emoji: !f.emoji }))} />
                  <FeatureCheck label="Highlight keywords" checked={feat.highlight} onChange={() => setFeat((f) => ({ ...f, highlight: !f.highlight }))} />
                  <FeatureCheck label="Remove silences"    checked={feat.silences}  onChange={() => setFeat((f) => ({ ...f, silences: !f.silences }))} />
                  <FeatureCheck label="Add B-rolls"        checked={feat.brolls}    onChange={() => setFeat((f) => ({ ...f, brolls: !f.brolls }))} badge />
                </div>
                <div className="mt-4 mb-1.5 flex items-center justify-between">
                  <p className="text-[12px] font-bold text-c-text-secondary">Find clip moment <span className="font-medium text-c-text-muted">(optional)</span></p>
                  <span className="text-[10.5px] font-semibold text-c-text-muted">Powered by Spark</span>
                </div>
                <input
                  value={findMoment}
                  onChange={(e) => setFindMoment(e.target.value)}
                  placeholder="Only want specific parts? e.g. when they talk about the chorus."
                  className="h-[44px] w-full rounded-[10px] border border-c-border bg-surface-1 px-3.5 text-[12.5px] text-c-text outline-none transition placeholder:text-c-text-muted focus:border-[#ff3d6a]/50"
                />
              </div>

              {/* ── Auto schedule ── */}
              <div className="mt-3 flex h-[52px] items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 px-4">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={1.8}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                <span className="flex-1 text-[13px] font-semibold text-c-text">Auto schedule and post to social account</span>
                <button
                  type="button"
                  onClick={() => setAutoSchedule((v) => !v)}
                  className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors", autoSchedule ? "bg-[#ff3d6a]" : "bg-surface-3")}
                >
                  <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", autoSchedule ? "left-[calc(100%-22px)]" : "left-0.5")} />
                </button>
              </div>

              {error && <p className="mt-3 text-center text-[11.5px] font-medium text-red-400">{error}</p>}
            </div>

            {/* ── Sticky footer: Get AI clips ── */}
            <div className="shrink-0 border-t border-c-border bg-surface-0 p-4">
              <Button
                disabled={uploading}
                onClick={handleImport}
                className="h-[52px] w-full rounded-[13px] bg-gradient-to-r from-[#ff3d6a] via-[#ff5f86] to-[#ff7a3d] text-[14.5px] font-bold text-white shadow-[0_14px_34px_rgba(255,61,106,.30)] disabled:opacity-50"
              >
                {uploading ? <><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent align-[-2px]" />Generating…</> : "✦ Get AI clips"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Studio Page ───────────────────────────────────────────────────────────────

const YT_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/;
const RETENTION_DAYS = 7;

function gradFromId(id: string) {
  const grads = [
    "from-[#FF3D6A] to-[#FF7A3D]",
    "from-[#3DAAFF] to-[#7B66FF]",
    "from-[#22C55E] to-[#3DAAFF]",
    "from-[#A855F7] to-[#EC4899]",
    "from-[#F59E0B] to-[#EF4444]",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return grads[Math.abs(hash) % grads.length];
}

function formatDuration(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatFullDate(date: string) {
  return new Date(date).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Soft retention hint — videos are cleared from storage after RETENTION_DAYS.
function expiryInfo(created_at: string): { label: string; expired: boolean } {
  const created = new Date(created_at).getTime();
  const expiresAt = created + RETENTION_DAYS * 86_400_000;
  const daysLeft = Math.ceil((expiresAt - Date.now()) / 86_400_000);
  if (daysLeft <= 0) return { label: "Expired", expired: true };
  return { label: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`, expired: false };
}

function initials(title: string | null) {
  if (!title) return "•";
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function sourceLabel(source: string) {
  return source === "youtube" || source === "youtube_url" ? "YOUTUBE"
    : source === "ai" || source === "ai_generate" ? "AI"
    : "UPLOAD";
}

function RecentTile({ video }: { video: VideoResponse }) {
  const exp = expiryInfo(video.created_at);
  return (
    <button
      type="button"
      onClick={() => navigate(`/projects/${video.id}`)}
      className="group flex w-full flex-col text-left transition"
    >
      <div className={cn("relative aspect-video w-full overflow-hidden rounded-[12px] border border-c-border bg-gradient-to-br shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)] transition group-hover:border-[#ff3d6a]/40", gradFromId(video.id))}>
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <span className="font-display text-3xl font-black tracking-tight text-white/85">{initials(video.title)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/15 transition group-hover:from-black/35" />
        <span className="absolute left-2 top-2 rounded-[6px] bg-black/55 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-c-text backdrop-blur-md">
          {sourceLabel(video.source_type)}
        </span>
        {exp.expired ? (
          <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-c-text-secondary backdrop-blur-md">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            Expired
          </span>
        ) : (
          <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-md">
            {formatDuration(video.duration_sec)}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-[12.5px] font-bold text-c-text transition group-hover:text-c-text">{video.title || "Untitled"}</p>
      <p className="mt-0.5 text-[11px] text-c-text-muted">{formatFullDate(video.created_at)}</p>
      {!exp.expired && <p className="mt-0.5 text-[11px] font-semibold text-amber-400/90">{exp.label}</p>}
    </button>
  );
}

export function StudioPage() {
  const [ytModalOpen, setYtModalOpen] = useState(false);
  const [ytInitialUrl, setYtInitialUrl] = useState("");
  const [ytPrefetch, setYtPrefetch] = useState<YtMeta | null>(null);
  const [ytFetching, setYtFetching] = useState(false);

  const [url, setUrl]             = useState("");
  const [drag, setDrag]           = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [recents, setRecents]     = useState<VideoResponse[]>([]);
  const [recentsLoading, setRecentsLoading] = useState(true);

  // Open modal on ?type=youtube[&url=...]
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("type") === "youtube") {
      setYtInitialUrl(params.get("url") || "");
      setYtModalOpen(true);
    }
  }, []);

  // Load recent projects
  useEffect(() => {
    let alive = true;
    videoApi.list(1, 10)
      .then((res) => { if (alive) setRecents(res.items); })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (alive) setRecentsLoading(false); });
    return () => { alive = false; };
  }, []);

  const openYtModal = (prefill = "") => { setYtPrefetch(null); setYtInitialUrl(prefill); setYtModalOpen(true); };
  const closeYtModal = () => { setYtModalOpen(false); setYtPrefetch(null); };

  // Prefetch metadata HERE, then open the dialog already populated.
  const openYtModalPrefetched = useCallback(async (v: string) => {
    setYtFetching(true);
    const vidId = v.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1] ?? "";
    const fallbackThumb = vidId ? `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg` : "";
    try {
      const m = await videoApi.youtubeInspect(v);
      setYtPrefetch({ title: m.title || "", thumbnail: m.thumbnail_url || fallbackThumb, duration: m.duration_sec ?? null, quality: "1080p" });
    } catch {
      setYtPrefetch(null); // modal will fetch/fallback itself
    } finally {
      setYtFetching(false);
      setYtInitialUrl(v);
      setYtModalOpen(true);
    }
  }, []);

  const handleFile = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.upload(file, file.name.replace(/\.[^.]+$/, ""), DEFAULT_CONFIG);
      navigate(`/projects/${video.id}`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }, []);

  const pickFile = () => { if (!uploading) fileInputRef.current?.click(); };

  // GET CLIPS: a YouTube URL opens the import modal; anything else opens the file picker.
  const handleGetClips = () => {
    const v = url.trim();
    if (YT_URL_RE.test(v)) openYtModalPrefetched(v);
    else pickFile();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) handleFile(e.dataTransfer.files);
  };
  const dragProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop,
  };

  return (
    <>
      {ytModalOpen && (
        <YoutubeImportModal initialUrl={ytInitialUrl} prefetched={ytPrefetch} onClose={closeYtModal} />
      )}

      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />

      <div
        {...dragProps}
        className="flex min-h-full flex-1 flex-col bg-surface-0"
      >
        {/* ── Hero ── */}
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,61,106,.16),transparent_45%)]" />
          <div className="relative mx-auto flex w-full max-w-[860px] flex-col items-center px-4 pb-7 pt-8 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[.22em] text-[#ff6f92]">Video Studio</p>
            <h1 className="mt-3 font-display text-[34px] font-black leading-[1.08] tracking-[-.02em] text-c-text sm:text-[42px]">
              Turn your long video into <span className="text-[#ff3d6a]">Viral Clips</span>
            </h1>
            <p className="mt-2.5 text-[13.5px] text-c-text-muted">Import · Extract viral moments · Export short-form</p>

            {/* Search / drop bar */}
            <div className={cn(
              "relative mt-7 flex w-full max-w-[620px] items-center rounded-full border bg-surface-1 pl-5 pr-1.5 py-1.5 transition",
              drag ? "border-[#ff3d6a]/60 shadow-[0_0_0_4px_rgba(255,61,106,.12)]" : "border-c-border shadow-[inset_0_1px_0_rgba(255,255,255,.04)]"
            )}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth={2} className="mr-2.5 shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGetClips()}
                placeholder={drag ? "Drop your video to upload" : "Paste YouTube link or drag your video here"}
                aria-label="YouTube link"
                className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-c-text outline-none placeholder:text-c-text-muted"
              />
              <button
                type="button"
                onClick={handleGetClips}
                disabled={uploading || ytFetching}
                className="ml-2 flex shrink-0 items-center gap-2 rounded-full bg-[#ff3d6a] px-5 py-2.5 text-[12.5px] font-bold text-white shadow-[0_10px_26px_rgba(255,61,106,.30)] transition hover:bg-[#ff537b] disabled:opacity-50"
              >
                {ytFetching && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />}
                {uploading ? "Uploading…" : ytFetching ? "Fetching…" : "GET CLIPS"}
              </button>
            </div>

            {/* Quick action pills */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              <button type="button" onClick={pickFile} className="flex cursor-pointer items-center gap-2 rounded-full border border-c-border bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-c-text transition hover:bg-surface-3">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload local file
              </button>
              <button type="button" className="flex cursor-default items-center gap-2 rounded-full border border-c-border bg-surface-2/90 px-4 py-2 text-[12.5px] font-bold text-c-text-secondary">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                AI Generate
              </button>
              <button type="button" onClick={() => openYtModal()} className="flex cursor-pointer items-center gap-2 rounded-full border border-c-border bg-surface-2 px-4 py-2 text-[12.5px] font-bold text-c-text transition hover:bg-surface-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff0000"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
                YouTube
              </button>
            </div>
          </div>
        </div>

        {/* ── Choose source ── */}
        <div className="mx-auto w-full max-w-[1180px] border-t border-c-border px-5 py-6 sm:px-8">
          <div className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-c-text-muted">Choose source</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {/* AI Generate — disabled, no-op (does nothing on click) */}
            <div className="flex flex-col rounded-[16px] border border-c-border bg-surface-1 p-5 opacity-60">
              <div className="grid h-11 w-11 place-items-center rounded-[13px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.08]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff7a9a" strokeWidth={1.8}><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z"/></svg>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h3 className="font-display text-[15px] font-bold text-c-text">AI Generate</h3>
                <span className="rounded-full border border-c-border bg-surface-2 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-c-text-muted">Soon</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-c-text-muted">Describe a topic or paste a script. AI writes, voices, and assembles clips for you.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Script gen", "Voiceover", "Auto-edit"].map((t) => (
                  <span key={t} className="rounded-full border border-[#ff3d6a]/15 bg-[#ff3d6a]/[.06] px-2 py-0.5 text-[10px] font-semibold text-[#ff7a9a]/70">{t}</span>
                ))}
              </div>
            </div>

            {/* Upload Video */}
            <button
              type="button"
              onClick={pickFile}
              {...dragProps}
              className={cn(
                "flex cursor-pointer flex-col rounded-[16px] border p-5 text-left transition",
                drag ? "border-[#ff3d6a]/55 bg-[#ff3d6a]/[.06]" : "border-c-border bg-surface-1 hover:border-[#ff3d6a]/35 hover:bg-surface-2"
              )}
            >
              <div className="grid h-11 w-11 place-items-center rounded-[13px] border border-amber-400/20 bg-amber-400/[.08]">
                {uploading
                  ? <span className="block h-5 w-5 animate-spin rounded-full border-2 border-amber-300/40 border-t-amber-300" />
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth={1.8}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
              </div>
              <h3 className="mt-3 font-display text-[15px] font-bold text-c-text">Upload Video</h3>
              <p className="mt-1.5 text-[12px] leading-5 text-c-text-muted">Drop any MP4, MOV or WebM — podcast, webinar, tutorial — and clip it into viral shorts.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["MP4 · MOV", "Smart cuts", "Captions"].map((t) => (
                  <span key={t} className="rounded-full border border-amber-400/15 bg-amber-400/[.06] px-2 py-0.5 text-[10px] font-semibold text-amber-300/80">{t}</span>
                ))}
              </div>
            </button>

            {/* YouTube Import */}
            <button
              type="button"
              onClick={() => openYtModal()}
              className="flex cursor-pointer flex-col rounded-[16px] border border-c-border bg-surface-1 p-5 text-left transition hover:border-red-400/35 hover:bg-red-400/[.05]"
            >
              <div className="grid h-11 w-11 place-items-center rounded-[13px] border border-red-400/20 bg-red-400/[.08]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#f87171"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
              </div>
              <h3 className="mt-3 font-display text-[15px] font-bold text-c-text">YouTube Import</h3>
              <p className="mt-1.5 text-[12px] leading-5 text-c-text-muted">Paste any YouTube URL. Preview metadata, choose format, clip with your active recipe.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["URL paste", "Preview meta", "Auto-clip"].map((t) => (
                  <span key={t} className="rounded-full border border-red-400/15 bg-red-400/[.06] px-2 py-0.5 text-[10px] font-semibold text-red-300/80">{t}</span>
                ))}
              </div>
            </button>
          </div>

          {uploadError && (
            <div className="mt-5 flex items-center gap-2.5 rounded-[12px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {uploadError}
            </div>
          )}
        </div>

        {/* ── Recent projects ── */}
        <div className="mx-auto w-full max-w-[1180px] border-t border-c-border px-5 py-6 sm:px-8">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-c-text-muted">Recent projects</p>
            <button type="button" onClick={() => navigate("/projects")} className="cursor-pointer text-[12px] font-semibold text-[#ff7a9a] transition hover:text-[#ff3d6a]">View all →</button>
          </div>

          {recentsLoading ? null : recents.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-c-border bg-surface-1 px-5 py-10 text-center">
              <p className="text-[13px] font-semibold text-c-text-muted">No projects yet</p>
              <p className="mt-1 text-[12px] text-c-text-muted">Upload a video or import from YouTube to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {recents.slice(0, 5).map((v) => <RecentTile key={v.id} video={v} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
