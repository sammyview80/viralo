import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { videoApi, token as authToken, API_BASES } from "@/lib/api";
import type { VideoResponse, ClipApiResponse } from "@/lib/api";
import { TrimBar } from "../components/editor/TrimBar";

const VIDEO_SSE_BASE = API_BASES.video;

type View = "list" | "create";
type InputType = "url" | "upload";
type TemplateId = "viral" | "classic" | "neon" | "minimal";
type Order = "countdown" | "ascending";

interface TemplateConfig {
  bgColor: string;
  titleColor: string;
  accentColor: string;
  numberColors: string[]; // index 0 = rank-1 color
  font: string;
}

const TEMPLATES: { id: TemplateId; name: string; desc: string; config: TemplateConfig }[] = [
  {
    id: "viral",
    name: "Viral",
    desc: "Bold numbers, pure black",
    config: {
      bgColor: "#000000",
      titleColor: "#ffffff",
      accentColor: "#e53e3e",
      numberColors: ["#ffd700", "#9ca3af", "#f97316", "#ffffff", "#ffffff"],
      font: "Impact, Arial Black, sans-serif",
    },
  },
  {
    id: "classic",
    name: "Classic",
    desc: "Brand pink on dark",
    config: {
      bgColor: "#0a0d14",
      titleColor: "#ff3d6a",
      accentColor: "#ff3d6a",
      numberColors: ["#ff3d6a", "#ff3d6a", "#ff3d6a", "#ff3d6a", "#ff3d6a"],
      font: "Inter, sans-serif",
    },
  },
  {
    id: "neon",
    name: "Neon",
    desc: "Glowing cyan on dark",
    config: {
      bgColor: "#050d1a",
      titleColor: "#22d3ee",
      accentColor: "#a78bfa",
      numberColors: ["#22d3ee", "#a78bfa", "#22d3ee", "#a78bfa", "#22d3ee"],
      font: "Inter, sans-serif",
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "Clean white on black",
    config: {
      bgColor: "#000000",
      titleColor: "#ffffff",
      accentColor: "#d4d4d4",
      numberColors: ["#ffffff", "#d4d4d4", "#a3a3a3", "#737373", "#525252"],
      font: "Inter, sans-serif",
    },
  },
];

interface RankingJob {
  jobId: string;
  videoId: string;
  label: string;
  progress: number;
  status: string;
  done: boolean;
  failed: boolean;
  clipUrl: string;
}

interface Segment {
  id: string;
  inputType: InputType;
  url: string;
  file: File | null;
  videoId: string;
  startSec: number;
  endSec: number;
  segmentTitle: string;
  previewUrl: string;
  duration: number;
}

const newSegment = (): Segment => ({
  id: Math.random().toString(36).slice(2),
  inputType: "url",
  url: "",
  file: null,
  videoId: "",
  startSec: 0,
  endSec: 15,
  segmentTitle: "",
  previewUrl: "",
  duration: 0,
});

function detectPlatform(url: string): string | null {
  if (/youtu\.?be/i.test(url)) return "YouTube";
  if (/tiktok/i.test(url)) return "TikTok";
  return null;
}

const inputCls =
  "min-w-0 flex-1 rounded-[11px] border border-white/[.08] bg-white/[.04] px-4 py-3 text-[13px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]";

interface TrimPreviewProps {
  src: string;
  startSec: number;
  endSec: number;
  duration: number;
  onDurationLoaded: (d: number) => void;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
}

function VideoTrimPreview({ src, startSec, endSec, duration, onDurationLoaded, onStartChange, onEndChange }: TrimPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="mt-3 overflow-hidden rounded-[14px] border border-white/[.08] bg-black">
      <video
        ref={videoRef}
        src={src}
        className="w-full max-h-48 object-contain bg-black"
        onLoadedMetadata={() => {
          const d = videoRef.current?.duration ?? 0;
          if (d && isFinite(d)) onDurationLoaded(d);
        }}
        controls
        preload="metadata"
      />
      {duration > 0 && (
        <div className="px-4 pb-4 pt-3">
          <TrimBar
            duration={duration}
            startSec={startSec}
            endSec={endSec}
            onChange={(s, e) => {
              onStartChange(s);
              onEndChange(e);
              if (videoRef.current) videoRef.current.currentTime = s;
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ── Status badge ── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    ready:      { bg: "bg-emerald-500/[.12]", text: "text-emerald-400", label: "Ready" },
    processing: { bg: "bg-yellow-500/[.12]",  text: "text-yellow-400",  label: "Processing" },
    queued:     { bg: "bg-blue-500/[.12]",    text: "text-blue-400",    label: "Queued" },
    failed:     { bg: "bg-red-500/[.12]",     text: "text-red-400",     label: "Failed" },
    error:      { bg: "bg-red-500/[.12]",     text: "text-red-400",     label: "Error" },
  };
  const s = map[status] ?? { bg: "bg-white/[.06]", text: "text-zinc-400", label: status };
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.bg, s.text)}>
      {s.label}
    </span>
  );
}

/* ── Ranking Card ── */
function formatDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function RankingCard({ v }: { v: VideoResponse }) {
  const meta = v.metadata as Record<string, unknown> | null | undefined;
  const segCount = typeof meta?.segment_count === "number" ? meta.segment_count : null;
  const theme = typeof meta?.theme === "string" ? meta.theme : null;
  const order = typeof meta?.order === "string" ? meta.order : null;
  const thumbUrl = typeof meta?.thumbnail_url === "string" ? meta.thumbnail_url : null;
  const createdAt = new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const isReady = v.status === "ready";
  const isError = v.status === "error" || v.status === "failed";

  const [clip, setClip] = useState<ClipApiResponse | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!isReady) return;
    videoApi.clips(v.id).then((r) => {
      const c = r.items.find((c) => c.storage_url) ?? null;
      setClip(c);
    }).catch(() => {});
  }, [v.id, isReady]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };

  // Build description from metadata
  const parts: string[] = [];
  if (v.title) parts.push(v.title);
  if (segCount != null) parts.push(`Segments: ${segCount}`);
  if (theme) parts.push(`Theme: ${theme}`);
  const description = parts.length > 1 ? parts.slice(1).join(". ") + "." : null;

  // Hashtags
  const tags = ["#ranking"];
  if (theme) tags.push(`#${theme}`);
  if (order) tags.push(order === "countdown" ? "#countdown" : "#ascending");
  if (segCount != null) tags.push("#segments");

  return (
    <div className="group flex flex-col overflow-hidden rounded-[18px] border border-white/[.08] bg-[#0e0f11] transition hover:border-white/[.16]">
      {/* Thumbnail / player */}
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
        {clip?.storage_url ? (
          <>
            <video
              ref={videoRef}
              src={clip.storage_url}
              poster={clip.thumbnail_url ?? undefined}
              preload="metadata"
              playsInline
              className="h-full w-full object-cover"
              onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? null)}
              onEnded={() => setPlaying(false)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
            <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center">
              {!playing && (
                <div className="grid h-12 w-12 place-items-center rounded-full bg-black/50 backdrop-blur-sm transition group-hover:scale-110">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="white"><path d="M6 4l9 5-9 5V4z" /></svg>
                </div>
              )}
            </button>
            {!playing && (
              <a
                href={clip.storage_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-[8px] bg-[#ff3d6a] text-white transition hover:bg-[#e8304f]"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 1h4v4M11 1L6 6M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" />
                </svg>
              </a>
            )}
          </>
        ) : thumbUrl ? (
          <>
            <img src={thumbUrl} alt={v.title ?? ""} className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-black/50 backdrop-blur-sm">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="white"><path d="M6 4l9 5-9 5V4z" /></svg>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-zinc-800/60 to-zinc-900">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-black/30">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="white" opacity="0.4"><path d="M6 4l9 5-9 5V4z" /></svg>
              </div>
            </div>
          </div>
        )}
        {/* Bottom badges — always show */}
        {!playing && (
          <>
            <span className="absolute bottom-2 left-2 rounded-[7px] bg-black/75 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              Ranking
            </span>
            <span className="absolute bottom-2 right-2 rounded-[7px] bg-black/75 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              {duration != null ? formatDur(duration) : segCount != null ? `${segCount} clips` : "—"}
            </span>
          </>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* Title */}
        <p className="text-[15px] font-bold leading-snug text-white line-clamp-2">
          {v.title || "Untitled Ranking"}
        </p>

        {/* Description */}
        {description && (
          <p className="text-[12px] leading-5 text-zinc-500 line-clamp-2">{description}</p>
        )}

        {/* Meta chips row */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <StatusBadge status={v.status} />
          {segCount != null && (
            <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-medium text-zinc-400">
              {segCount} clips
            </span>
          )}
          <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-medium text-zinc-400">
            {createdAt}
          </span>
          <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-medium text-zinc-400">
            9:16
          </span>
        </div>

        {/* Order range */}
        {order && (
          <div className="flex items-center gap-2 text-[11px] text-zinc-600">
            <span className="font-semibold">{order === "countdown" ? "5→1 countdown" : "1→5 ascending"}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[.06]">
          <div
            className={cn("h-full rounded-full transition-all duration-500", isReady ? "bg-emerald-500" : isError ? "bg-red-500" : "bg-zinc-600")}
            style={{ width: isReady ? "100%" : isError ? "30%" : "0%" }}
          />
        </div>

        {/* Hashtags */}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-0.5 text-[10px] text-zinc-500">
              {t}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-0.5 text-[10px] text-zinc-500">
              +{tags.length - 3}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Ranking List ── */
interface RankingListProps {
  onNew: () => void;
}

function RankingList({ onNew }: RankingListProps) {
  const [items, setItems] = useState<VideoResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const PER_PAGE = 12;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await videoApi.listRanking(p, PER_PAGE);
      setItems(res.items);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Video Rankings</h1>
          <p className="mt-1 text-[13px] text-zinc-500">{total} ranking{total !== 1 ? "s" : ""} created</p>
        </div>
        <button
          onClick={onNew}
          className="rounded-[12px] bg-[#ff3d6a] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_6px_20px_rgba(255,61,106,.25)] transition hover:bg-[#e8304f]"
        >
          + New Ranking
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-[18px] border border-white/[.06] bg-[#111113] animate-pulse">
              <div className="aspect-video w-full bg-white/[.04]" />
              <div className="flex flex-col gap-2.5 p-4">
                <div className="h-4 w-3/4 rounded-md bg-white/[.05]" />
                <div className="h-3 w-1/2 rounded-md bg-white/[.03]" />
                <div className="h-1 w-full rounded-full bg-white/[.04]" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-[20px] border border-dashed border-white/[.1] bg-white/[.01] py-20 text-center">
          <span className="text-4xl">🏆</span>
          <p className="text-sm font-semibold text-zinc-400">No ranking videos yet</p>
          <p className="text-[12px] text-zinc-600">Create your first ranked countdown video</p>
          <button
            onClick={onNew}
            className="mt-2 rounded-[11px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-[#e8304f]"
          >
            + New Ranking
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((v) => <RankingCard key={v.id} v={v} />)}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <button
                onClick={() => load(page - 1)}
                disabled={page <= 1}
                className="rounded-[9px] border border-white/[.08] px-3 py-1.5 text-[12px] font-semibold text-zinc-400 transition hover:text-white disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-[12px] font-semibold text-zinc-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => load(page + 1)}
                disabled={page >= totalPages}
                className="rounded-[9px] border border-white/[.08] px-3 py-1.5 text-[12px] font-semibold text-zinc-400 transition hover:text-white disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ViewClipButton({ videoId }: { videoId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    videoApi.clips(videoId).then((r) => {
      const u = r.items.find((c) => c.storage_url)?.storage_url ?? null;
      setUrl(u);
    }).catch(() => {});
  }, [videoId]);

  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="rounded-[9px] bg-[#ff3d6a] px-3 py-1 text-[11px] font-bold text-white transition hover:bg-[#e8304f]"
    >
      View
    </a>
  );
}

/* ── Template picker components ── */
function MiniPreview({ config, title }: { config: TemplateConfig; title?: string }) {
  const nums = [1, 2, 3, 4, 5];
  return (
    <div
      className="relative h-24 w-14 overflow-hidden rounded-[8px] flex flex-col"
      style={{ background: config.bgColor, fontFamily: config.font }}
    >
      {/* Title */}
      <p
        className="px-1.5 pt-1.5 text-[6px] font-black leading-tight line-clamp-2"
        style={{ color: config.titleColor }}
      >
        {title || "Your Title"}
      </p>
      {/* Numbered list */}
      <div className="flex flex-col gap-[2px] px-1.5 pt-1 flex-1">
        {nums.map((n, i) => (
          <div key={n} className="flex items-center gap-0.5">
            <span
              className="text-[7px] font-black leading-none"
              style={{ color: config.numberColors[i] ?? config.numberColors.at(-1) }}
            >
              {n}.
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplatePicker({
  selected,
  onSelect,
}: {
  selected: TemplateId;
  onSelect: (id: TemplateId, config: TemplateConfig) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {TEMPLATES.map((tpl) => (
        <button
          key={tpl.id}
          onClick={() => onSelect(tpl.id, tpl.config)}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-[12px] border p-2.5 transition",
            selected === tpl.id
              ? "border-[#ff3d6a] bg-[#ff3d6a]/[.08]"
              : "border-white/[.08] hover:border-white/20"
          )}
        >
          <MiniPreview config={tpl.config} />
          <div className="text-center">
            <p className="text-[11px] font-bold text-zinc-200">{tpl.name}</p>
            <p className="text-[9.5px] text-zinc-500">{tpl.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function ColorCustomizer({
  config,
  onChange,
}: {
  config: TemplateConfig;
  onChange: (c: TemplateConfig) => void;
}) {
  const field = (label: string, key: keyof TemplateConfig, value: string) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-zinc-500 min-w-0 flex-1">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <div
          className="h-5 w-5 rounded-[4px] border border-white/[.1] cursor-pointer"
          style={{ background: value }}
          onClick={() => {
            const el = document.getElementById(`color-${key}`);
            if (el) (el as HTMLInputElement).click();
          }}
        />
        <input
          id={`color-${key}`}
          type="color"
          value={value}
          className="sr-only"
          onChange={(e) => onChange({ ...config, [key]: e.target.value })}
        />
        <span className="font-mono text-[10px] text-zinc-500 w-14">{value}</span>
      </div>
    </div>
  );

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Customize</span>
      {field("Background", "bgColor", config.bgColor)}
      {field("Title", "titleColor", config.titleColor)}
      {field("Accent", "accentColor", config.accentColor)}
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Number colors</span>
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          {config.numberColors.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div
                className="h-5 w-5 rounded-full border border-white/[.1] cursor-pointer"
                style={{ background: c }}
                onClick={() => {
                  const el = document.getElementById(`color-num-${i}`);
                  if (el) (el as HTMLInputElement).click();
                }}
              />
              <input
                id={`color-num-${i}`}
                type="color"
                value={c}
                className="sr-only"
                onChange={(e) => {
                  const next = [...config.numberColors];
                  next[i] = e.target.value;
                  onChange({ ...config, numberColors: next });
                }}
              />
              <span className="text-[8px] text-zinc-600">#{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Create view ── */
interface CreateViewProps {
  onBack: () => void;
  onJobCreated: () => void;
}

function CreateView({ onBack, onJobCreated }: CreateViewProps) {
  const [segments, setSegments] = useState<Segment[]>(() => [newSegment(), newSegment()]);
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("viral");
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(TEMPLATES[0].config);
  const [order, setOrder] = useState<Order>("countdown");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<RankingJob[]>([]);

  const updateJob = (jobId: string, patch: Partial<RankingJob>) =>
    setJobs((prev) => prev.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)));

  const updateSeg = (id: string, patch: Partial<Segment>) =>
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSeg = () => setSegments((prev) => [...prev, newSegment()]);
  const removeSeg = (id: string) =>
    setSegments((prev) => (prev.length <= 2 ? prev : prev.filter((s) => s.id !== id)));
  const moveSeg = (idx: number, dir: -1 | 1) =>
    setSegments((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const previewUrls = useRef<Set<string>>(new Set());
  useEffect(() => { return () => { previewUrls.current.forEach(URL.revokeObjectURL); }; }, []);

  const handleUrlBlur = useCallback((id: string, url: string) => {
    if (!url.trim()) return;
    updateSeg(id, { previewUrl: url.trim() });
  }, []);

  const handleFileChange = useCallback((id: string, file: File | null) => {
    if (!file) return;
    const objUrl = URL.createObjectURL(file);
    previewUrls.current.add(objUrl);
    updateSeg(id, { file, previewUrl: objUrl, startSec: 0, endSec: 15 });
  }, []);

  const handleDuration = useCallback((id: string, duration: number, currentEnd: number) => {
    updateSeg(id, { duration, endSec: Math.min(currentEnd || 15, duration) });
  }, []);

  const handleSuggest = async () => {
    setSuggestLoading(true);
    setError("");
    try {
      const res = await videoApi.suggestRankingTitle(title || "ranking video", segments.length);
      setTitle(res.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to suggest title");
    } finally {
      setSuggestLoading(false);
    }
  };

  const handleGenerate = async () => {
    setError("");
    if (segments.length < 2) return setError("Add at least 2 videos");
    for (const s of segments) {
      if (s.inputType === "url" && !s.url.trim()) return setError("Each video needs a URL or upload");
      if (s.inputType === "upload" && !s.file && !s.videoId) return setError("Each upload needs a file");
      if (s.endSec <= s.startSec) return setError("End time must be after start time");
    }

    setGenerating(true);
    try {
      const payload = {
        title: title || "Top Ranking",
        theme: templateId,
        template: templateId,
        template_config: templateConfig,
        order,
        segments: await Promise.all(
          segments.map(async (s) => {
            if (s.inputType === "upload") {
              let vid = s.videoId;
              if (!vid && s.file) {
                const up = await videoApi.upload(s.file, s.file.name);
                vid = up.id;
                updateSeg(s.id, { videoId: vid });
              }
              return { source_type: "upload", video_id: vid, start_sec: s.startSec, end_sec: s.endSec, segment_title: s.segmentTitle };
            }
            return { source_type: "url", url: s.url.trim(), start_sec: s.startSec, end_sec: s.endSec, segment_title: s.segmentTitle };
          })
        ),
      };
      const res = await videoApi.createRanking(payload);
      const newJob: RankingJob = {
        jobId: res.job_id,
        videoId: res.video_id,
        label: title || "Top Ranking",
        progress: 0,
        status: "Starting…",
        done: false,
        failed: false,
        clipUrl: "",
      };
      setJobs((prev) => [newJob, ...prev]);
      onJobCreated();
      setGenerating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate ranking");
      setGenerating(false);
    }
  };

  // SSE subscriptions
  useEffect(() => {
    const t = authToken.get() || "";
    if (!t) return;
    const activeJobs = jobs.filter((j) => !j.done && !j.failed);
    if (activeJobs.length === 0) return;

    const cleanups = activeJobs.map((job) => {
      const es = new EventSource(
        `${VIDEO_SSE_BASE}/progress/${job.jobId}?token=${encodeURIComponent(t)}`
      );
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "keepalive") return;
          const patch: Partial<RankingJob> = {};
          if (d.message) patch.status = d.message;
          if (d.pct != null) patch.progress = d.pct;
          const finished = d.status === "complete" || d.step === "done" || d.pct === 100;
          if (finished) {
            patch.progress = 100;
            es.close();
            videoApi.clips(job.videoId)
              .then((r) => {
                const url = r.items.find((c) => c.storage_url)?.storage_url ?? "";
                updateJob(job.jobId, { done: true, clipUrl: url, progress: 100 });
              })
              .catch(() => updateJob(job.jobId, { done: true }));
          }
          if (d.status === "failed") {
            patch.failed = true;
            patch.status = d.message || "Failed";
            es.close();
          }
          if (Object.keys(patch).length) updateJob(job.jobId, patch);
        } catch { /* ignore */ }
      };
      es.onerror = () => es.close();
      return () => es.close();
    });

    return () => cleanups.forEach((fn) => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => j.jobId).join(",")]);

  const accent = templateConfig.accentColor;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6">
      {/* Jobs panel */}
      {jobs.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Ranking Jobs</h2>
          {jobs.map((job) => (
            <div key={job.jobId} className="rounded-[16px] border border-white/[.08] bg-white/[.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{job.label}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {job.failed ? "Failed" : job.done ? "Ready" : job.status}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!job.done && !job.failed && (
                    <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="8" stroke="#ff3d6a" strokeOpacity="0.25" strokeWidth="2.5" />
                      <path d="M10 2a8 8 0 0 1 8 8" stroke="#ff3d6a" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                  {job.done && !job.failed && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="9" fill="#34d399" fillOpacity="0.15" />
                      <polyline points="5.5 10.5 8.5 13.5 14.5 7.5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {job.failed && (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="9" fill="#f87171" fillOpacity="0.15" />
                      <path d="M7 7l6 6M13 7l-6 6" stroke="#f87171" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  {job.done && job.clipUrl && (
                    <a href={job.clipUrl} target="_blank" rel="noreferrer"
                      className="rounded-[9px] bg-[#ff3d6a] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#e8304f]">
                      View
                    </a>
                  )}
                  <button onClick={() => setJobs((prev) => prev.filter((j) => j.jobId !== job.jobId))}
                    className="text-[11px] text-zinc-600 hover:text-zinc-300 transition">
                    ×
                  </button>
                </div>
              </div>
              {!job.done && !job.failed && (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.06]">
                    <div className="h-full rounded-full bg-[#ff3d6a] transition-all duration-500" style={{ width: `${job.progress}%` }} />
                  </div>
                  <p className="mt-1 text-right text-[10px] font-semibold text-zinc-500">{job.progress}%</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-[9px] border border-white/[.08] text-zinc-400 transition hover:text-white"
        >
          ←
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold text-white">New Video Ranking</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">Create a ranked countdown video from 2 or more clips</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT: input cards */}
        <div className="flex flex-col gap-4">
          {segments.map((s, idx) => {
            const rankLabel = order === "countdown" ? segments.length - idx : idx + 1;
            const platform = detectPlatform(s.url);
            return (
              <div key={s.id} className="rounded-[18px] border border-white/[.08] bg-white/[.02] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: accent }}>
                      #{rankLabel}
                    </span>
                    <span className="text-sm font-bold text-white">Video {idx + 1}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveSeg(idx, -1)} disabled={idx === 0}
                      className="grid h-7 w-7 place-items-center rounded-lg border border-white/[.08] text-zinc-400 transition hover:text-white disabled:opacity-30">↑</button>
                    <button onClick={() => moveSeg(idx, 1)} disabled={idx === segments.length - 1}
                      className="grid h-7 w-7 place-items-center rounded-lg border border-white/[.08] text-zinc-400 transition hover:text-white disabled:opacity-30">↓</button>
                    {segments.length > 2 && (
                      <button onClick={() => removeSeg(s.id)}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-red-400/20 text-red-400 transition hover:bg-red-400/[.08]">×</button>
                    )}
                  </div>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-1 rounded-[12px] border border-white/[.07] bg-white/[.02] p-1">
                  {(["url", "upload"] as InputType[]).map((t) => (
                    <button key={t} onClick={() => updateSeg(s.id, { inputType: t })}
                      className={cn("rounded-[9px] py-2 text-xs font-bold capitalize transition",
                        s.inputType === t ? "bg-[#ff3d6a] text-white" : "text-zinc-400 hover:text-zinc-200")}>
                      {t === "url" ? "URL" : "Upload file"}
                    </button>
                  ))}
                </div>

                {s.inputType === "url" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <input value={s.url}
                        onChange={(e) => updateSeg(s.id, { url: e.target.value, previewUrl: "" })}
                        onBlur={(e) => handleUrlBlur(s.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleUrlBlur(s.id, s.url); }}
                        placeholder="https://youtube.com/watch?v=… or TikTok URL"
                        className={inputCls} />
                      {platform && (
                        <span className="shrink-0 rounded-lg border border-white/[.08] bg-white/[.04] px-2.5 py-2 text-[11px] font-semibold text-zinc-300">
                          {platform}
                        </span>
                      )}
                    </div>
                    {s.previewUrl && (platform ? (
                      <p className="mt-2 text-[11px] text-zinc-500">
                        {platform} videos can't be previewed here — trim times apply during generation.
                      </p>
                    ) : (
                      <VideoTrimPreview src={s.previewUrl} startSec={s.startSec} endSec={s.endSec} duration={s.duration}
                        onDurationLoaded={(d) => handleDuration(s.id, d, s.endSec)}
                        onStartChange={(v) => updateSeg(s.id, { startSec: v })}
                        onEndChange={(v) => updateSeg(s.id, { endSec: v })} />
                    ))}
                  </>
                ) : (
                  <>
                    <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed p-6 text-center transition",
                      s.file ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.04]" : "border-white/[.09] bg-white/[.015] hover:border-white/20")}>
                      <input type="file" accept="video/*" className="hidden"
                        onChange={(e) => handleFileChange(s.id, e.target.files?.[0] ?? null)} />
                      <span className="text-[13px] font-semibold text-zinc-300">
                        {s.file ? s.file.name : "Drop or browse a video"}
                      </span>
                    </label>
                    {s.previewUrl && (
                      <VideoTrimPreview src={s.previewUrl} startSec={s.startSec} endSec={s.endSec} duration={s.duration}
                        onDurationLoaded={(d) => handleDuration(s.id, d, s.endSec)}
                        onStartChange={(v) => updateSeg(s.id, { startSec: v })}
                        onEndChange={(v) => updateSeg(s.id, { endSec: v })} />
                    )}
                  </>
                )}

                <div className="mt-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-zinc-500">Clip label (shown next to number)</span>
                    <input value={s.segmentTitle}
                      onChange={(e) => updateSeg(s.id, { segmentTitle: e.target.value })}
                      placeholder={`e.g. "absolutely insane"`}
                      className={inputCls} />
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-zinc-500">Start (s)</span>
                    <input type="number" min={0} max={s.duration || undefined} value={s.startSec}
                      onChange={(e) => updateSeg(s.id, { startSec: Math.max(0, Number(e.target.value)) })}
                      className={inputCls} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-zinc-500">End (s)</span>
                    <input type="number" min={0} max={s.duration || undefined} value={s.endSec}
                      onChange={(e) => updateSeg(s.id, { endSec: Math.max(0, Number(e.target.value)) })}
                      className={inputCls} />
                  </label>
                </div>
              </div>
            );
          })}

          <button onClick={addSeg}
            className="rounded-[14px] border border-dashed border-white/[.12] bg-white/[.015] py-4 text-[13px] font-bold text-zinc-400 transition hover:border-white/25 hover:text-white">
            + Add Video ({segments.length} total)
          </button>
        </div>

        {/* RIGHT: settings */}
        <div className="flex flex-col gap-5">
          <div className="rounded-[18px] border border-white/[.08] bg-white/[.02] p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Title</span>
            <div className="mt-2 flex items-center gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Top 5 …" className={inputCls} />
              <button onClick={handleSuggest} disabled={suggestLoading}
                className="shrink-0 rounded-[11px] border border-white/[.1] bg-white/[.06] px-3 py-3 text-[13px] font-bold text-zinc-200 transition hover:bg-white/[.10] disabled:opacity-40">
                {suggestLoading ? "…" : "AI ✨"}
              </button>
            </div>

            <span className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Template</span>
            <div className="mt-2">
              <TemplatePicker
                selected={templateId}
                onSelect={(id, config) => { setTemplateId(id); setTemplateConfig(config); }}
              />
            </div>
            <ColorCustomizer
              config={templateConfig}
              onChange={setTemplateConfig}
            />

            <span className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Order</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => setOrder("countdown")}
                className={cn("rounded-[10px] border py-2 text-xs font-bold transition",
                  order === "countdown" ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-white" : "border-white/[.08] text-zinc-400 hover:text-zinc-200")}>
                5→1 Countdown
              </button>
              <button onClick={() => setOrder("ascending")}
                className={cn("rounded-[10px] border py-2 text-xs font-bold transition",
                  order === "ascending" ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-white" : "border-white/[.08] text-zinc-400 hover:text-zinc-200")}>
                1→5 Ascending
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="flex flex-col items-center gap-3 rounded-[18px] border border-white/[.08] bg-white/[.02] p-5">
            <span className="self-start text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Preview</span>
            <div
              className="relative h-72 w-40 overflow-hidden rounded-[14px] flex flex-col"
              style={{ background: templateConfig.bgColor, fontFamily: templateConfig.font }}
            >
              {/* Title */}
              <p
                className="px-3 pt-3 text-[11px] font-black leading-tight text-center"
                style={{ color: templateConfig.titleColor }}
              >
                {title || "Your Title"}
              </p>
              {/* Numbered list */}
              <div className="flex flex-col gap-2 px-3 pt-3 flex-1">
                {segments.slice(0, 5).map((s, i) => {
                  const rank = order === "countdown" ? segments.length - i : i + 1;
                  const color = templateConfig.numberColors[i] ?? templateConfig.numberColors.at(-1)!;
                  return (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <span className="text-[15px] font-black leading-none" style={{ color }}>
                        {rank}.
                      </span>
                      {s.segmentTitle && (
                        <span className="text-[9px] text-white/70 truncate">{s.segmentTitle}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
              {error}
            </div>
          )}

          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center justify-center gap-2 rounded-[12px] bg-[#ff3d6a] py-3.5 text-sm font-bold text-white shadow-[0_8px_24px_rgba(255,61,106,.25)] transition hover:bg-[#e8304f] disabled:opacity-60">
            {generating ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="white" strokeOpacity="0.3" strokeWidth="2" />
                  <path d="M8 2a6 6 0 0 1 6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Submitting…
              </>
            ) : "Generate Video Ranking"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Root ── */
export function RankingPage() {
  const [view, setView] = useState<View>("list");

  return view === "list" ? (
    <RankingList onNew={() => setView("create")} />
  ) : (
    <CreateView
      onBack={() => setView("list")}
      onJobCreated={() => setView("list")}
    />
  );
}

export default RankingPage;
