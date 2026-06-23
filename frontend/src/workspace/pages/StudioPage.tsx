import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { platforms } from "../data";
import { ChipRow, Panel, Phone, Ring, SelectLike } from "../components";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { navigate } from "@/lib/router";
import { videoApi, type ClipConfig, type VideoResponse, type OutputQuality, type YouTubeFormatsResponse } from "@/lib/api";
import { ClipConfigPanel, DEFAULT_CONFIG, PLATFORM_OPTIONS, ASPECT_OPTIONS, LANG_OPTIONS, CAPTION_STYLES } from "./UploadPage";

type StudioTab = "ai" | "upload";
type YtStep = 0 | 1 | 2;
type UploadStep = "source" | "destinations" | "clips" | "style" | "review";

const YT_STEPS = ["Source", "Clips", "Style"] as const;

// ── Template definitions ──────────────────────────────────────────────────────

const TEMPLATE_DEFS = [
  { id: null,            label: "Auto",     icon: "✦", desc: "Matched to content",   preview: "Adapts style\nto content type",      bg: "from-zinc-800 to-zinc-900",    accent: "#a1a1aa", captionStyle: "clean",    captionColor: "#fff",     captionBg: "rgba(0,0,0,.5)" },
  { id: "sports-hype",  label: "Hype",     icon: "⚡", desc: "Bold text, blur bg",   preview: "Blurred BG\nBold white captions",   bg: "from-orange-950 to-zinc-900",  accent: "#fb923c", captionStyle: "bold",     captionColor: "#fff",     captionBg: "rgba(0,0,0,.0)" },
  { id: "cinematic",    label: "Cinematic",icon: "🎬", desc: "Dramatic dark overlay", preview: "Dark overlay\nElegant thin text",   bg: "from-slate-950 to-zinc-900",   accent: "#94a3b8", captionStyle: "italic",   captionColor: "#e2e8f0",  captionBg: "rgba(0,0,0,.7)" },
  { id: "gaming-clutch",label: "Clutch",   icon: "🎮", desc: "Neon gaming captions",  preview: "Neon outlines\nGaming font style",  bg: "from-violet-950 to-zinc-950",  accent: "#a855f7", captionStyle: "neon",     captionColor: "#e879f9",  captionBg: "rgba(0,0,0,.0)" },
  { id: "talking-head", label: "Talk",     icon: "🎙", desc: "Clean, chill music",   preview: "Clean framing\nSubtle captions",    bg: "from-sky-950 to-zinc-900",     accent: "#38bdf8", captionStyle: "clean",    captionColor: "#bae6fd",  captionBg: "rgba(0,0,0,.4)" },
  { id: "generic",      label: "Minimal",  icon: "◻", desc: "No extras, clean cut",  preview: "No music\nNo effects, pure cut",   bg: "from-zinc-900 to-black",       accent: "#71717a", captionStyle: "minimal",  captionColor: "#d4d4d8",  captionBg: "rgba(0,0,0,.6)" },
] as const;

type TemplateDef = typeof TEMPLATE_DEFS[number];

function TemplatePreview({ templateId, thumbnail }: { templateId: string | null; thumbnail?: string }) {
  const def: TemplateDef = (TEMPLATE_DEFS.find((t) => (t.id ?? null) === (templateId ?? null)) ?? TEMPLATE_DEFS[0]) as TemplateDef;

  return (
    <div className="relative mx-auto h-[260px] w-[130px] overflow-hidden rounded-[18px] border-[2.5px] border-white/[.12] bg-black shadow-[0_20px_60px_rgba(0,0,0,.6)]">
      {/* Notch */}
      <div className="absolute left-1/2 top-2 z-10 h-2.5 w-12 -translate-x-1/2 rounded-full bg-black/70" />

      {/* Background */}
      {thumbnail ? (
        <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" style={{ filter: def.id === "sports-hype" ? "blur(4px) saturate(1.8)" : def.id === "cinematic" ? "brightness(.55) contrast(1.1)" : "brightness(.7)" }} />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-b ${def.bg}`} />
      )}

      {/* Overlay tint */}
      <div className="absolute inset-0"
        style={{ background: def.id === "cinematic" ? "rgba(0,0,0,.45)" : def.id === "sports-hype" ? "linear-gradient(to top, rgba(0,0,0,.8) 40%, transparent)" : "linear-gradient(to top, rgba(0,0,0,.7) 50%, transparent)" }}
      />

      {/* Accent bar — hype/clutch get a colored stripe */}
      {(def.id === "sports-hype" || def.id === "gaming-clutch") && (
        <div className="absolute left-0 top-0 h-full w-1" style={{ background: def.accent }} />
      )}

      {/* Mock caption */}
      <div className="absolute bottom-10 left-0 right-0 px-3 text-center">
        {def.captionStyle === "neon" ? (
          <p className="text-[10px] font-black uppercase leading-tight"
            style={{ color: def.captionColor, textShadow: `0 0 8px ${def.accent}, 0 0 20px ${def.accent}` }}>
            THIS IS THE<br />CLUTCH MOMENT
          </p>
        ) : def.captionStyle === "bold" ? (
          <p className="rounded-sm px-1 py-0.5 text-[11px] font-black uppercase leading-tight tracking-wide"
            style={{ color: def.captionColor, WebkitTextStroke: "0.5px rgba(0,0,0,.4)" }}>
            BIGGEST PLAY<br />OF THE NIGHT
          </p>
        ) : def.captionStyle === "italic" ? (
          <p className="text-[9.5px] font-light italic leading-relaxed tracking-widest"
            style={{ color: def.captionColor, textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>
            "The moment<br />everything changed"
          </p>
        ) : def.captionStyle === "minimal" ? (
          <p className="rounded px-1.5 py-0.5 text-[9.5px] font-medium leading-tight"
            style={{ color: def.captionColor, background: def.captionBg }}>
            No edits, pure content
          </p>
        ) : (
          <p className="rounded-md px-2 py-1 text-[9.5px] font-semibold leading-snug"
            style={{ color: def.captionColor, background: def.captionBg }}>
            Word by word<br />captions here
          </p>
        )}
      </div>

      {/* Bottom pill — simulates progress bar */}
      <div className="absolute bottom-3 left-1/2 h-1 w-16 -translate-x-1/2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-2/3 rounded-full" style={{ background: def.accent }} />
      </div>
    </div>
  );
}

// ── YouTube Import Modal ──────────────────────────────────────────────────────

interface YoutubeModalProps {
  onClose: () => void;
  initialUrl?: string;
}

function YoutubeImportModal({ onClose, initialUrl = "" }: YoutubeModalProps) {
  const [step, setStep]           = useState<YtStep>(0);
  const [urlVal, setUrlVal]       = useState(initialUrl);
  const [urlReady, setUrlReady]   = useState(false);
  const [ytMeta, setYtMeta]       = useState<{ title: string; thumbnail: string } | null>(null);
  const [ytMetaLoading, setYtMetaLoading] = useState(false);
  const [precisionMode, setPrecisionMode] = useState(false);
  const [clipConfig, setClipConfig] = useState<ClipConfig>(DEFAULT_CONFIG);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState("");
  // Full clip spec probed from the backend for this URL. null = not yet probed /
  // probe failed. Import is blocked until this is populated.
  const [formatsData, setFormatsData] = useState<YouTubeFormatsResponse | null>(null);
  const [formatsLoading, setFormatsLoading] = useState(false);
  const [formatsError, setFormatsError] = useState("");
  const availQualities = formatsData?.qualities ?? null;

  // validate + fetch metadata
  useEffect(() => {
    if (!urlVal.trim()) { setUrlReady(false); setYtMeta(null); setError(""); return; }
    const t = setTimeout(async () => {
      const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/.test(urlVal.trim());
      setUrlReady(valid);
      if (!valid) {
        setError("Enter a valid YouTube URL");
        setYtMeta(null); setFormatsData(null); setFormatsError("");
        return;
      }
      setError("");

      // Probe the full clip spec from the backend (authoritative). Clamp the current
      // quality if it isn't offered. On failure, Import stays disabled.
      setFormatsLoading(true);
      setFormatsData(null);
      setFormatsError("");
      videoApi.youtubeFormats(urlVal.trim())
        .then((f) => {
          setFormatsData(f);
          setClipConfig((c) =>
            f.qualities.includes((c.output_quality ?? "source") as OutputQuality)
              ? c : { ...c, output_quality: f.qualities[0] });
        })
        .catch((err) =>
          setFormatsError(err instanceof Error ? err.message : "Could not read video formats"))
        .finally(() => setFormatsLoading(false));

      setYtMetaLoading(true);
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(urlVal.trim())}&format=json`);
        if (r.ok) {
          const d = await r.json();
          const vidId = urlVal.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1] ?? "";
          setYtMeta({
            title: d.title || "",
            thumbnail: vidId ? `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg` : (d.thumbnail_url || ""),
          });
        }
      } catch { /* non-fatal */ }
      finally { setYtMetaLoading(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [urlVal]);

  // If opened with a prefilled URL, skip to step 1 once validated
  useEffect(() => {
    if (initialUrl && urlReady && step === 0) setStep(1);
  }, [urlReady]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleImport = useCallback(async () => {
    if (!urlVal.trim() || !formatsData) return;  // require a probed spec
    setUploading(true);
    setError("");
    try {
      const cfg: ClipConfig = precisionMode ? { ...clipConfig, precision_mode: true } : clipConfig;
      const video = await videoApi.youtube(urlVal.trim(), undefined, cfg);
      navigate(`/projects/${video.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setUploading(false);
    }
  }, [urlVal, clipConfig, precisionMode, formatsData]);

  const back = () => setStep((s) => Math.max(0, s - 1) as YtStep);

  // ── clip spec formatting helpers ──
  const fmtDuration = (s?: number | null) => {
    if (!s) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
             : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const fmtBytes = (b?: number | null) => {
    if (!b) return null;
    const u = ["B", "KB", "MB", "GB"]; let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };
  const specTop = formatsData?.formats?.[0];  // largest height

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="relative flex h-[760px] w-full max-w-[600px] flex-col overflow-hidden rounded-[24px] border border-white/[.09] bg-[#0b1018] shadow-[0_40px_120px_rgba(0,0,0,.7)]">

        {/* Header */}
        <div className="relative flex items-center gap-3 border-b border-white/[.07] bg-[radial-gradient(circle_at_8%_0%,rgba(248,113,113,.14),transparent_40%)] px-5 py-4">
          {step > 0 && (
            <button
              onClick={back}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] border border-white/[.08] bg-white/[.04] text-zinc-400 transition hover:bg-white/[.08] hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}

          {/* Step indicators */}
          <div className="flex flex-1 items-center gap-0">
            {YT_STEPS.map((label, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div key={label} className="flex min-w-0 flex-1 items-center">
                  <div className="flex shrink-0 items-center gap-1.5">
                    <div className={cn(
                      "grid h-[22px] w-[22px] place-items-center rounded-full text-[10px] font-bold transition-all duration-200",
                      done    ? "bg-[#ff3d6a] text-white shadow-[0_0_10px_rgba(255,61,106,.4)]"
                      : active ? "border-2 border-[#ff3d6a] text-[#ff7a9a]"
                      : "border border-white/[.12] text-zinc-600"
                    )}>
                      {done
                        ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>
                        : i + 1}
                    </div>
                    <span className={cn(
                      "text-[11.5px] font-semibold transition",
                      active ? "text-white" : done ? "text-zinc-500" : "text-zinc-600"
                    )}>{label}</span>
                  </div>
                  {i < YT_STEPS.length - 1 && (
                    <div className={cn(
                      "mx-2.5 h-px flex-1 transition-all duration-300",
                      done ? "bg-[#ff3d6a]/40" : "bg-white/[.06]"
                    )} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="ml-2 grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-white/[.08] bg-white/[.04] text-zinc-400 transition hover:bg-white/[.08] hover:text-white"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Step 0: Source + Confirm ── */}
        {step === 0 && (
          <div className="flex-1 p-7">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-red-400/25 bg-red-400/[.10]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#f87171"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
              </div>
              <div>
                <h2 className="font-display text-[18px] font-bold text-white">Import from YouTube</h2>
                <p className="text-[12px] text-zinc-500">Paste URL, confirm video, choose clip mode</p>
              </div>
            </div>

            {/* URL input */}
            <div className="relative mb-3">
              <Input
                autoFocus
                value={urlVal}
                onChange={(e) => setUrlVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && urlReady && setStep(1)}
                placeholder="https://youtube.com/watch?v=…"
                aria-label="YouTube video URL"
                className="h-[52px] rounded-[13px] border-white/[.09] bg-[#060b12] pr-28 text-[14px] font-medium placeholder:text-zinc-600 focus:border-[#ff3d6a]/50 focus:ring-4 focus:ring-[#ff3d6a]/10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full border border-white/[.07] bg-white/[.04] px-2.5 py-1 text-[10px] font-bold text-zinc-600 sm:block">YouTube</span>
            </div>

            {/* Video preview */}
            {urlVal.trim() && (
              <div className="mb-4">
                {ytMetaLoading ? (
                  <Card className="flex items-center gap-3 rounded-[14px] border-white/[.07] bg-white/[.03] p-3">
                    <Skeleton className="h-14 w-24 flex-shrink-0 rounded-[8px] bg-zinc-800/80" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4 rounded-full bg-zinc-800/80" />
                      <Skeleton className="h-2.5 w-1/2 rounded-full bg-zinc-800/60" />
                    </div>
                  </Card>
                ) : ytMeta ? (
                  <div className="flex items-center gap-3 overflow-hidden rounded-[14px] border border-emerald-500/[.15] bg-[#081210] p-3">
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-[8px] bg-zinc-800">
                      <img src={ytMeta.thumbnail} alt={ytMeta.title} className="h-full w-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600/90">
                          <svg viewBox="0 0 24 24" fill="white" className="ml-0.5 h-3 w-3"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-white">{ytMeta.title}</p>
                      <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-400">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>
                        Verified
                      </span>
                    </div>
                  </div>
                ) : error ? (
                  <div className="flex items-center gap-2 rounded-[12px] border border-red-400/20 bg-red-400/[.07] px-3.5 py-2.5 text-[12px] font-medium text-red-400">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {error}
                  </div>
                ) : null}
              </div>
            )}

            {/* Clip mode */}
            <div className="mb-5 grid grid-cols-2 gap-2">
              {([
                [false, "Multi Clip",      "Extract multiple viral moments"],
                [true,  "Best Viral Clip", "Single clip · 9.5+ virality score"],
              ] as [boolean, string, string][]).map(([isPrecision, label, desc]) => (
                <button key={label} onClick={() => setPrecisionMode(isPrecision)}
                  className={cn(
                    "cursor-pointer rounded-[13px] border p-3.5 text-left transition",
                    precisionMode === isPrecision
                      ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.09] shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
                      : "border-white/[.07] bg-white/[.02] hover:border-white/[.12] hover:bg-white/[.035]"
                  )}>
                  <p className={cn("text-[13px] font-bold", precisionMode === isPrecision ? "text-white" : "text-zinc-300")}>{label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{desc}</p>
                </button>
              ))}
            </div>

            {/* Platforms */}
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Destinations</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {PLATFORM_OPTIONS.map((p) => {
                const active = (clipConfig.platforms ?? []).includes(p.id);
                return (
                  <button key={p.id} type="button"
                    onClick={() => {
                      const cur = clipConfig.platforms ?? [];
                      setClipConfig({ ...clipConfig, platforms: active ? cur.filter((x) => x !== p.id) : [...cur, p.id] });
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-1.5 rounded-[11px] border py-2.5 text-[12px] font-semibold transition",
                      active ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.09] text-[#ff5f86]" : "border-white/[.07] bg-white/[.025] text-zinc-400 hover:border-white/[.13] hover:text-zinc-200"
                    )}>
                    <span className="text-[13px]">{p.ltr}</span>{p.label}
                  </button>
                );
              })}
            </div>

            {/* Aspect ratio + Language */}
            <div className="mb-5 grid grid-cols-2 gap-2">
              <div className="rounded-[12px] border border-white/[.07] bg-white/[.025] p-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Aspect ratio</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {ASPECT_OPTIONS.map((r) => (
                    <button key={r} type="button" onClick={() => setClipConfig({ ...clipConfig, aspect_ratio: r })}
                      className={cn(
                        "cursor-pointer rounded-[8px] border py-1.5 text-center text-[12px] font-semibold transition",
                        clipConfig.aspect_ratio === r ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.09] text-[#ff5f86]" : "border-white/[.07] bg-white/[.02] text-zinc-400 hover:border-white/[.13]"
                      )}>{r}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-[12px] border border-white/[.07] bg-white/[.025] p-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Language</p>
                <select value={clipConfig.language ?? "en"} onChange={(e) => setClipConfig({ ...clipConfig, language: e.target.value })}
                  className="w-full rounded-[9px] border border-white/[.08] bg-[#060b12] px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-[#ff3d6a]/50">
                  {LANG_OPTIONS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                </select>
              </div>
            </div>

            <Button disabled={!urlReady} onClick={() => setStep(1)} className="h-[52px] w-full rounded-[13px] text-[14px] font-bold">
              Continue to Clip settings
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="ml-1"><path d="M9 18l6-6-6-6"/></svg>
            </Button>
          </div>
        )}

        {/* ── Step 1: Clips ── */}
        {step === 1 && (
          <div className="flex-1 p-7">
            <div className="mb-5">
              <h2 className="font-display text-[18px] font-bold text-white">Clip settings</h2>
              <p className="text-[12px] text-zinc-500">Control quantity, quality threshold, and focus.</p>
            </div>

            {/* Target length */}
            <div className="mb-4 rounded-[13px] border border-white/[.07] bg-white/[.025] p-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Target length (seconds)</p>
              <div className="grid grid-cols-[1fr_28px_1fr] items-center gap-2">
                <input type="number" min={5} max={clipConfig.duration_max} value={clipConfig.duration_min}
                  onChange={(e) => setClipConfig({ ...clipConfig, duration_min: Number(e.target.value) })}
                  className="w-full rounded-[10px] border border-white/[.08] bg-[#060b12] px-3 py-2.5 text-center text-[14px] font-bold text-zinc-100 outline-none focus:border-[#ff3d6a]/50" />
                <span className="text-center text-[11px] text-zinc-600">to</span>
                <input type="number" min={clipConfig.duration_min} max={300} value={clipConfig.duration_max}
                  onChange={(e) => setClipConfig({ ...clipConfig, duration_max: Number(e.target.value) })}
                  className="w-full rounded-[10px] border border-white/[.08] bg-[#060b12] px-3 py-2.5 text-center text-[14px] font-bold text-zinc-100 outline-none focus:border-[#ff3d6a]/50" />
              </div>
            </div>

            {/* Max clips */}
            <div className="mb-4 rounded-[13px] border border-white/[.07] bg-white/[.025] p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Max clips</p>
                <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-0.5 text-[12px] font-bold text-[#ff5f86]">{clipConfig.max_clips}</span>
              </div>
              <input type="range" min={1} max={20} value={clipConfig.max_clips}
                onChange={(e) => setClipConfig({ ...clipConfig, max_clips: Number(e.target.value) })}
                className="w-full accent-[#ff3d6a]" />
              <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>1 focused</span><span>20 batch</span></div>
            </div>

            {/* Viral score */}
            <div className="mb-4 rounded-[13px] border border-white/[.07] bg-white/[.025] p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Min virality score</p>
                <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-0.5 text-[12px] font-bold text-[#ff5f86]">{Math.round((clipConfig.min_score ?? 0.5) * 10)}/10</span>
              </div>
              <input type="range" min={0} max={10} step={1} value={Math.round((clipConfig.min_score ?? 0.5) * 10)}
                onChange={(e) => setClipConfig({ ...clipConfig, min_score: Number(e.target.value) / 10 })}
                className="w-full accent-[#ff3d6a]" />
              <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>Any usable</span><span>Balanced</span><span>Viral only</span></div>
            </div>

            {/* Topic focus */}
            <div className="mb-5 rounded-[13px] border border-white/[.07] bg-white/[.025] p-4">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Topic focus <span className="normal-case tracking-normal text-zinc-600">optional</span></p>
              <input type="text"
                placeholder="e.g. controversial moment, product demo…"
                value={clipConfig.topic_focus ?? ""}
                onChange={(e) => setClipConfig({ ...clipConfig, topic_focus: e.target.value || null })}
                className="w-full rounded-[10px] border border-white/[.08] bg-[#060b12] px-3 py-2.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[#ff3d6a]/50" />
            </div>

            <Button onClick={() => setStep(2)} className="h-[52px] w-full rounded-[13px] text-[14px] font-bold">
              Next — Style & export
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="ml-1"><path d="M9 18l6-6-6-6"/></svg>
            </Button>
            <button
              type="button"
              disabled={uploading}
              onClick={handleImport}
              className="mt-2.5 w-full cursor-pointer rounded-[13px] border border-white/[.07] bg-transparent py-3 text-[12.5px] font-semibold text-zinc-500 transition hover:border-white/[.13] hover:text-zinc-300 disabled:opacity-40"
            >
              Skip style — import with defaults
            </button>
          </div>
        )}

        {/* ── Step 2: Style ── */}
        {step === 2 && (
          <div className="flex flex-1 gap-0">
            {/* Left: controls */}
            <div className="flex flex-1 flex-col p-6">
              <div className="mb-4">
                <h2 className="font-display text-[18px] font-bold text-white">Style & export</h2>
                <p className="text-[12px] text-zinc-500">Pick a template — preview updates live.</p>
              </div>

              {/* Template picker */}
              <div className="mb-4">
                <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Template</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATE_DEFS.map((t) => (
                    <button key={String(t.id)} type="button"
                      onClick={() => setClipConfig({ ...clipConfig, template_id: t.id })}
                      className={cn(
                        "cursor-pointer rounded-[11px] border p-2.5 text-left transition",
                        (clipConfig.template_id ?? null) === t.id
                          ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.09]"
                          : "border-white/[.07] bg-white/[.02] hover:border-white/[.13]"
                      )}>
                      <div className="flex items-center gap-2">
                        <span className="text-[16px]">{t.icon}</span>
                        <div>
                          <p className={cn("text-[12px] font-bold", (clipConfig.template_id ?? null) === t.id ? "text-[#ff5f86]" : "text-zinc-200")}>{t.label}</p>
                          <p className="text-[10px] leading-3 text-zinc-600">{t.desc}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Content type */}
              <div className="mb-4">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Content type</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: null, label: "Auto" }, { id: "podcast", label: "Podcast" }, { id: "gaming", label: "Gaming" },
                    { id: "football", label: "Football" }, { id: "concert", label: "Concert" }, { id: "general", label: "Other" },
                  ].map((o) => (
                    <button key={String(o.id)} type="button"
                      onClick={() => setClipConfig({ ...clipConfig, occasion: o.id })}
                      className={cn(
                        "cursor-pointer rounded-[9px] border px-2 py-1.5 text-center text-[11px] font-semibold transition",
                        (clipConfig.occasion ?? null) === o.id ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.09] text-[#ff5f86]" : "border-white/[.07] bg-white/[.025] text-zinc-400 hover:border-white/[.13]"
                      )}>{o.label}</button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="mb-4 grid grid-cols-3 gap-2">
                {([
                  ["add_captions", "Captions",  "Subtitles"],
                  ["music",        "Music",     "BG track"],
                  ["voiceover",    "Voiceover", "AI narrator"],
                ] as [keyof ClipConfig, string, string][]).map(([key, label, desc]) => {
                  const val = key === "music" ? (clipConfig[key] ?? true) : !!(clipConfig[key] as boolean);
                  return (
                    <button key={key} type="button"
                      onClick={() => setClipConfig({ ...clipConfig, [key]: !val })}
                      className={cn(
                        "cursor-pointer rounded-[10px] border p-2.5 text-left transition",
                        val ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/[.07]" : "border-white/[.07] bg-white/[.025] hover:border-white/[.12]"
                      )}>
                      <div className={cn("relative mb-1.5 h-4 w-7 rounded-full transition-colors", val ? "bg-[#ff3d6a]" : "bg-white/[.12]")}>
                        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]", val ? "left-[calc(100%-14px)]" : "left-0.5")} />
                      </div>
                      <p className={cn("text-[11px] font-bold", val ? "text-white" : "text-zinc-400")}>{label}</p>
                      <p className="text-[9.5px] text-zinc-600">{desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Quality — dynamic: only qualities the backend confirms downloadable */}
              {(() => {
                const qualities = availQualities ?? (["source", "1080p", "720p", "480p"] as OutputQuality[]);
                return (
                  <div className="mb-auto">
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Output quality</p>
                      {formatsLoading && <span className="text-[9px] text-zinc-600">checking…</span>}
                    </div>
                    <div
                      className="grid gap-1.5"
                      style={{ gridTemplateColumns: `repeat(${Math.max(qualities.length, 1)}, minmax(0,1fr))` }}
                    >
                      {qualities.map((q) => (
                        <button key={q} type="button"
                          disabled={formatsLoading}
                          onClick={() => setClipConfig({ ...clipConfig, output_quality: q })}
                          className={cn(
                            "cursor-pointer rounded-[8px] border py-1.5 text-center text-[11px] font-bold transition disabled:cursor-default disabled:opacity-50",
                            clipConfig.output_quality === q ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.09] text-[#ff5f86]" : "border-white/[.06] text-zinc-500 hover:border-white/[.12]"
                          )}>{q === "source" ? "Full" : q}</button>
                      ))}
                    </div>
                    {availQualities && (
                      <p className="mt-1.5 text-[9px] text-zinc-600">Detected from this video</p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Right: live template preview */}
            <div className="flex w-[200px] shrink-0 flex-col items-center justify-center border-l border-white/[.06] bg-[#070b12] px-4 py-6">
              <TemplatePreview templateId={clipConfig.template_id ?? null} thumbnail={ytMeta?.thumbnail} />
              <p className="mt-3 text-center text-[10.5px] font-semibold text-zinc-500">
                {TEMPLATE_DEFS.find((t) => (t.id ?? null) === (clipConfig.template_id ?? null))?.label ?? "Auto"}
              </p>
              <p className="mt-0.5 text-center text-[9.5px] leading-4 text-zinc-700">
                {TEMPLATE_DEFS.find((t) => (t.id ?? null) === (clipConfig.template_id ?? null))?.preview ?? ""}
              </p>
            </div>
          </div>
        )}

        {/* ── Step 2 Import footer ── */}
        {step === 2 && (
          <div className="border-t border-white/[.07] bg-[#070b12] px-6 py-3.5">
            {/* Clip spec — fetched from the YouTube URL */}
            {formatsLoading && (
              <div className="mb-3 flex items-center gap-2 text-[11.5px] text-zinc-500">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />
                Reading video specs…
              </div>
            )}
            {!formatsLoading && formatsError && (
              <div className="mb-3 rounded-[10px] border border-red-500/25 bg-red-500/[.06] px-3 py-2 text-[11.5px] font-medium text-red-300">
                Couldn’t read this video’s formats — {formatsError}. Import is disabled.
              </div>
            )}
            {!formatsLoading && formatsData && (
              <div className="mb-3 rounded-[10px] border border-white/[.07] bg-white/[.025] px-3 py-2.5">
                <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[.14em] text-zinc-500">Clip spec</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px]">
                  {[
                    ["Max resolution", specTop ? `${specTop.height}p${specTop.fps ? ` ${Math.round(specTop.fps)}fps` : ""}` : `${formatsData.max_height}p`],
                    ["Duration", fmtDuration(formatsData.duration)],
                    ["Qualities", formatsData.qualities.map((q) => (q === "source" ? "Full" : q)).join(" · ")],
                    ["Largest size", specTop && fmtBytes(specTop.filesize) ? fmtBytes(specTop.filesize)! : "—"],
                    ["Formats", String(formatsData.formats.length)],
                  ].map(([k, v]) => (
                    <span key={k} className="flex items-baseline gap-1.5">
                      <span className="text-zinc-600">{k}</span>
                      <span className="font-semibold text-zinc-300">{v}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              {ytMeta && (
                <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-white/[.07] bg-white/[.025] px-3 py-2">
                  <div className="relative h-7 w-11 flex-shrink-0 overflow-hidden rounded-[5px] bg-zinc-800">
                    <img src={ytMeta.thumbnail} alt="" className="h-full w-full object-cover" />
                  </div>
                  <p className="truncate text-[11.5px] font-semibold text-zinc-300">{ytMeta.title}</p>
                </div>
              )}
              <Button
                disabled={uploading || formatsLoading || !formatsData}
                title={!formatsData ? "Video formats unavailable — cannot import" : undefined}
                onClick={handleImport}
                className="h-10 shrink-0 rounded-[11px] px-6 text-[13px] font-bold disabled:opacity-50"
              >
                {uploading ? <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />Processing…</>
                  : formatsLoading ? "Checking…" : "Import & Clip"}
              </Button>
            </div>
            {error && <p className="mt-2 text-[11.5px] font-medium text-red-400">{error}</p>}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Studio Page ───────────────────────────────────────────────────────────────

export function StudioPage() {
  const [tab, setTab]             = useState<StudioTab>("upload");
  const [uploadStep, setUploadStep] = useState<UploadStep>("source");
  const [ytModalOpen, setYtModalOpen] = useState(false);
  const [ytInitialUrl, setYtInitialUrl] = useState("");
  const [tone, setTone]           = useState("Strong hook");
  const [prompt, setPrompt]       = useState("Create a high-retention TikTok about 5 morning habits that changed my life.");
  const [clipConfig, setClipConfig] = useState<ClipConfig>(DEFAULT_CONFIG);

  const [drag, setDrag]           = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Open modal on ?type=youtube[&url=...]
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("type") === "youtube") {
      setYtInitialUrl(params.get("url") || "");
      setYtModalOpen(true);
    }
  }, []);

  const openYtModal = () => { setYtInitialUrl(""); setYtModalOpen(true); };
  const closeYtModal = () => setYtModalOpen(false);

  const startProcessing = (video: VideoResponse) => navigate(`/projects/${video.id}`);

  const handleFile = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.upload(file, file.name.replace(/\.[^.]+$/, ""), clipConfig);
      startProcessing(video);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }, [clipConfig]);

  return (
    <>
      {ytModalOpen && (
        <YoutubeImportModal
          initialUrl={ytInitialUrl}
          onClose={closeYtModal}
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0e1420] shadow-[0_28px_90px_rgba(0,0,0,.28)]">

        {/* ── Header ── */}
        <div className="relative overflow-hidden border-b border-white/[.07] px-4 py-3.5 sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,61,106,.18),transparent_31%),radial-gradient(circle_at_88%_0%,rgba(59,130,246,.10),transparent_28%)]" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff7a9a" strokeWidth={1.8}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              </div>
              <div>
                <h1 className="font-display text-[17px] font-bold tracking-[-.01em] text-white">Video Studio</h1>
                <p className="text-[11.5px] text-zinc-500">Import · extract viral moments · export short-form</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Main tab switcher */}
              <div className="grid grid-cols-2 gap-1 rounded-[13px] border border-white/[.08] bg-[#090e17]/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
                {([["upload", "↑ Upload"], ["ai", "✦ AI Generate"]] as [StudioTab, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => { setTab(id); setUploadError(""); }}
                    className={cn(
                      "cursor-pointer rounded-[10px] px-4 py-2 text-xs font-bold transition",
                      tab === id ? "bg-[#ff3d6a] text-white shadow-[0_8px_20px_rgba(255,61,106,.32)]" : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* YouTube button — opens modal */}
              <button
                onClick={openYtModal}
                className="flex cursor-pointer items-center gap-2 rounded-[11px] border border-red-400/25 bg-red-400/[.08] px-4 py-2 text-xs font-bold text-red-300 transition hover:bg-red-400/[.14] hover:text-red-200"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
                YouTube
              </button>
            </div>
          </div>
        </div>

        {/* ── AI Generate ── */}
        {tab === "ai" && (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_400px]">
            <div className="overflow-y-auto border-b border-white/[.07] p-4 sm:p-6 lg:border-b-0 lg:border-r">
              <div className="space-y-5">
                <div>
                  <label className="text-[12px] font-semibold text-zinc-400">What's your video about?</label>
                  <textarea
                    value={prompt} onChange={(e) => setPrompt(e.target.value)}
                    className="mt-2 min-h-[120px] w-full resize-y rounded-[12px] border border-white/[.07] bg-[#1b2233] p-4 text-[13px] leading-7 text-zinc-100 outline-none transition focus:border-[#ff3d6a]/50 focus:ring-4 focus:ring-[#ff3d6a]/10"
                    placeholder="e.g. 5 morning habits that completely changed my productivity…"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Panel title="Platforms"><ChipRow items={platforms.map((p) => p[1])} active={["TikTok", "Reels"]} /></Panel>
                  <Panel title="Duration"><ChipRow items={["30s", "60s", "90s"]} active={["60s"]} /></Panel>
                  <Panel title="Voice"><SelectLike value="Alex (energetic)" /></Panel>
                  <Panel title="Captions"><ChipRow items={["Word", "Line", "None"]} active={["Word"]} /></Panel>
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-zinc-400">Content style</label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {["⚡ Strong hook", "📖 Storytelling", "🎓 Educational", "🔥 Controversial", "😂 Humorous", "✨ Inspiring"].map((x) => {
                      const clean = x.replace(/^.. /, "");
                      return (
                        <button key={x} onClick={() => setTone(clean)}
                          className={cn(
                            "cursor-pointer rounded-[10px] border p-3 text-left text-[12.5px] font-semibold transition",
                            tone === clean ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-white" : "border-white/[.07] bg-[#141926] text-zinc-400 hover:border-white/[.13]"
                          )}>
                          {x}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button className="h-11 w-full rounded-[12px]" size="default">✦ Generate Video</Button>
              </div>
            </div>
            <div className="flex flex-col bg-[#0b101a]">
              <div className="flex h-[48px] items-center gap-2 border-b border-white/[.07] px-5">
                <span className="font-display text-[13px] font-bold">Preview</span>
                <span className="text-[11.5px] text-zinc-500">{prompt.trim() ? "— estimated" : "— enter a prompt"}</span>
                <a href="/clips" className="ml-auto cursor-pointer rounded-lg border border-white/[.07] px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-white/[.04]">▣ All clips</a>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
                <Phone label={prompt.trim() ? tone : "Enter a topic"} />
                {prompt.trim() ? (
                  <>
                    <div className="grid w-full grid-cols-[56px_1fr] items-center gap-3 rounded-[12px] border border-white/[.07] bg-[#141926] p-3">
                      <Ring value={prompt.length > 30 ? 62 : 41} />
                      <div>
                        <h4 className="text-[13px] font-semibold">Estimated virality</h4>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{prompt.length > 30 ? "Good topic. Try a stronger hook for +10 pts." : "Add more detail for a better estimate."}</p>
                      </div>
                    </div>
                    <div className="w-full">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">Script preview</div>
                      <div className="rounded-[12px] border border-white/[.07] bg-[#141926] p-3">
                        {["[HOOK] 5 morning habits that changed...", "[BUILD] Here's exactly what changed when I started doing this every morning.", "[CTA] Save this. Your future self will thank you."].map((line, i) => (
                          <p key={line} className={cn("text-xs leading-5", i === 0 ? "text-zinc-100" : "text-zinc-400")}>{line}</p>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="max-w-[210px] text-center text-[12.5px] leading-6 text-zinc-500">Enter a topic on the left and your video preview will appear here.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Upload ── */}
        {tab === "upload" && (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]" style={{overflow:"hidden"}}>
            <div className="overflow-y-auto border-b border-white/[.07] bg-[#0b101a] p-4 sm:p-5 lg:border-b-0 lg:border-r">
              <div className="mb-5">
                <p className="text-[10.5px] font-bold uppercase tracking-[.18em] text-[#ff6f92]">Upload workflow</p>
                <h2 className="mt-1 font-display text-[18px] font-bold tracking-[-.02em] text-white">New source</h2>
              </div>

              <div className="space-y-1.5">
                {([
                  ["source",       "1", "Source",       "Upload file or YouTube"],
                  ["destinations", "2", "Destinations", "Platforms & format"],
                  ["clips",        "3", "Clips",        "Length, count, score"],
                  ["style",        "4", "Style",        "AI, captions, quality"],
                  ["review",       "5", "Review",       "Confirm & start"],
                ] as [UploadStep, string, string, string][]).map(([id, number, label, hint]) => {
                  const ORDER: UploadStep[] = ["source","destinations","clips","style","review"];
                  const done   = ORDER.indexOf(id) < ORDER.indexOf(uploadStep);
                  const active = uploadStep === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setUploadStep(id)}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-3 rounded-[13px] border p-3 text-left transition",
                        active
                          ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-white shadow-[0_14px_34px_rgba(255,61,106,.10)]"
                          : "border-white/[.07] bg-white/[.025] text-zinc-400 hover:border-white/[.13] hover:bg-white/[.04] hover:text-zinc-200"
                      )}
                    >
                      <span className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-all",
                        active ? "bg-[#ff3d6a] text-white shadow-[0_0_8px_rgba(255,61,106,.4)]"
                        : done  ? "bg-[#ff3d6a]/70 text-white"
                        : "bg-white/[.06] text-zinc-500"
                      )}>
                        {done
                          ? <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>
                          : number}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-bold">{label}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 rounded-[14px] border border-white/[.07] bg-white/[.025] p-3 text-[11.5px] leading-5 text-zinc-500">
                Settings are saved with the project when the source is uploaded.
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />

              {uploadStep === "source" && (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-display text-2xl font-bold tracking-[-.02em] text-white">Choose the source</h2>
                    <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-zinc-500">Drop a long-form video or import from YouTube. Viralo opens the project as soon as the source is ready.</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                    <div
                      onClick={() => !uploading && fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                      onDragLeave={() => setDrag(false)}
                      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files); }}
                      className={cn(
                        "group relative flex min-h-[360px] cursor-pointer flex-col justify-between overflow-hidden rounded-[18px] border p-5 transition sm:p-7",
                        uploading ? "cursor-default border-[#ff3d6a]/40 bg-[#ff3d6a]/[.04]"
                        : drag    ? "scale-[1.01] border-[#ff3d6a]/60 bg-[#ff3d6a]/[.07] shadow-[0_24px_70px_rgba(255,61,106,.16)]"
                        : "border-white/[.09] bg-[linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018))] hover:border-[#ff3d6a]/35 hover:bg-white/[.04]"
                      )}
                    >
                      <div className="pointer-events-none absolute inset-5 rounded-[14px] border border-dashed border-white/[.11] transition group-hover:border-[#ff3d6a]/35" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div className="grid h-[52px] w-[52px] place-items-center rounded-[15px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/[.10]">
                          {uploading ? (
                            <span className="block h-6 w-6 animate-spin rounded-full border-[2px] border-[#ff3d6a]/30 border-t-[#ff3d6a]" />
                          ) : (
                            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#ff7a9a" strokeWidth={1.8}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          )}
                        </div>
                        <span className="rounded-full border border-white/[.08] bg-black/20 px-3 py-1.5 text-[11px] font-bold text-zinc-400">MP4 / MOV / WebM</span>
                      </div>

                      <div className="relative max-w-xl py-8 text-center sm:mx-auto">
                        <h3 className="font-display text-3xl font-bold tracking-[-.03em] text-white sm:text-4xl">
                          {uploading ? "Uploading your video..." : drag ? "Release to upload" : "Drop your video here"}
                        </h3>
                        <p className="mx-auto mt-3 max-w-md text-[13.5px] leading-6 text-zinc-500">
                          {uploading ? "Keep this tab open. We will send you to the project when the source is ready." : "Use a clean long-form source: podcasts, webinars, tutorials, interviews, or raw camera clips."}
                        </p>
                        {!uploading && (
                          <button type="button" className="mt-6 cursor-pointer rounded-[11px] bg-[#ff3d6a] px-6 py-3 text-[13px] font-bold text-white shadow-[0_14px_34px_rgba(255,61,106,.30)] transition hover:bg-[#ff537b]">
                            Browse files
                          </button>
                        )}
                      </div>

                      <div className="relative flex flex-wrap gap-2 text-[11.5px] font-semibold text-zinc-500">
                        {["Auto captions", "Smart cuts", "Project review"].map((item) => (
                          <span key={item} className="rounded-full border border-white/[.07] bg-black/15 px-3 py-1.5">{item}</span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={openYtModal}
                        className="group flex min-h-[178px] w-full cursor-pointer flex-col justify-between rounded-[16px] border border-red-400/20 bg-red-400/[.06] p-4 text-left transition hover:border-red-300/35 hover:bg-red-400/[.10]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-red-400/[.12] text-red-300">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
                          </span>
                          <span className="text-[11px] font-bold text-red-200/70 transition group-hover:text-red-200">Open</span>
                        </div>
                        <div>
                          <h3 className="font-display text-[16px] font-bold text-white">Import from YouTube</h3>
                          <p className="mt-1 text-[12px] leading-5 text-zinc-500">Paste a link, preview metadata, then clip it with the active recipe.</p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUploadStep("destinations")}
                        className="w-full cursor-pointer rounded-[12px] border border-white/[.08] bg-white/[.04] px-4 py-3 text-left text-[12.5px] font-bold text-zinc-200 transition hover:bg-white/[.07]"
                      >
                        Tune recipe before upload
                        <span className="mt-1 block text-[11.5px] font-medium text-zinc-500">Format, duration, captions, and platform targets.</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {(uploadStep === "destinations" || uploadStep === "clips" || uploadStep === "style") && (() => {
                const RECIPE_META: Record<string, { title: string; desc: string; panelStep: 1|2|3; prev: UploadStep; next: UploadStep; nextLabel: string }> = {
                  destinations: { title: "Destinations",  desc: "Pick platforms, aspect ratio, and language for this session.", panelStep: 1, prev: "source",       next: "clips",  nextLabel: "Next — Clips" },
                  clips:        { title: "Clips",          desc: "Set clip count, target length, and minimum viral score.",       panelStep: 2, prev: "destinations", next: "style",  nextLabel: "Next — Style" },
                  style:        { title: "Style & quality",desc: "Choose AI enhancements, captions, and output quality.",         panelStep: 3, prev: "clips",        next: "review", nextLabel: "Review settings" },
                };
                const meta = RECIPE_META[uploadStep];
                return (
                  <div className="space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h2 className="font-display text-2xl font-bold tracking-[-.02em] text-white">{meta.title}</h2>
                        <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-zinc-500">{meta.desc}</p>
                      </div>
                    </div>

                    <div className="rounded-[18px] border border-white/[.07] bg-[#0b101a] px-5 py-5 sm:px-6">
                      <ClipConfigPanel config={clipConfig} onChange={setClipConfig} step={meta.panelStep} />
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setUploadStep(meta.prev)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-[11px] border border-white/[.08] px-4 py-2.5 text-[12.5px] font-semibold text-zinc-400 transition hover:border-white/[.15] hover:text-zinc-200"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M15 18l-6-6 6-6"/></svg>
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadStep(meta.next)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-[11px] bg-[#ff3d6a] px-5 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-[#ff537b]"
                      >
                        {meta.nextLabel}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {uploadStep === "review" && (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-display text-2xl font-bold tracking-[-.02em] text-white">Review and start</h2>
                    <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-zinc-500">Confirm the recipe, then choose a source. Uploads and imports start from the source step.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Platforms", `${clipConfig.platforms?.length ?? 0} selected`],
                      ["Format", clipConfig.aspect_ratio],
                      ["Length", `${clipConfig.duration_min}-${clipConfig.duration_max}s`],
                      ["Captions", clipConfig.add_captions ? "On" : "Off"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[14px] border border-white/[.08] bg-white/[.035] p-4">
                        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-zinc-600">{label}</p>
                        <p className="mt-1.5 text-[14px] font-bold text-zinc-100">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 rounded-[16px] border border-white/[.08] bg-[#0b101a] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[12.5px] leading-5 text-zinc-500">Ready to create a project? Pick a file or YouTube link on the source step.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setUploadStep("destinations")}
                        className="h-10 cursor-pointer rounded-[11px] border border-white/[.08] px-4 text-[12.5px] font-bold text-zinc-300 transition hover:bg-white/[.05]"
                      >
                        Edit recipe
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadStep("source")}
                        className="h-10 cursor-pointer rounded-[11px] bg-[#ff3d6a] px-4 text-[12.5px] font-bold text-white transition hover:bg-[#ff537b]"
                      >
                        Choose source
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="mt-5 flex items-center gap-2.5 rounded-[12px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {uploadError}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  );
}
