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
type BuilderStep = "sources" | "style" | "review";

const BUILDER_STEPS: Array<{
  id: BuilderStep;
  label: string;
  description: string;
}> = [
  { id: "sources", label: "Sources", description: "Add and trim ranked clips" },
  { id: "style", label: "Style", description: "Choose title, order, and template" },
  { id: "review", label: "Review", description: "Check details and generate" },
];

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
  uploading: boolean;
  uploadError: string | null;
  previewLoading: boolean;
  previewError: string | null;
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
  uploading: false,
  uploadError: null,
  previewLoading: false,
  previewError: null,
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
  "min-w-0 flex-1 rounded-[11px] border border-c-border bg-surface-1 px-4 py-3 text-[13px] font-medium text-c-text placeholder-c-text-muted outline-none transition focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]";

interface TrimPreviewProps {
  src: string;
  startSec: number;
  endSec: number;
  duration: number;
  onDurationLoaded: (d: number) => void;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
}

interface TrimTimeFieldsProps {
  startSec: number;
  endSec: number;
  duration: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
}

function normalizeTrimNumber(value: string) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function TrimTimeFields({ startSec, endSec, duration, onStartChange, onEndChange }: TrimTimeFieldsProps) {
  const durationMax = duration > 0 ? duration : undefined;
  const clipDuration = Math.max(0, endSec - startSec);

  return (
    <div className="mt-3 rounded-[13px] border border-c-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Trim</span>
        <span className="text-[11px] font-semibold text-c-text-muted">{clipDuration.toFixed(1)}s clip</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-c-text-muted">Start clip</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={durationMax}
            step={0.1}
            value={startSec}
            onChange={(e) => {
              const next = normalizeTrimNumber(e.target.value);
              onStartChange(Math.min(next, Math.max(0, endSec - 0.1)));
            }}
            className="rounded-[10px] border border-c-border bg-surface-1 px-3 py-2 text-[13px] font-semibold text-c-text outline-none transition focus:border-[#ff3d6a]/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-c-text-muted">End clip</span>
          <input
            type="number"
            inputMode="decimal"
            min={Math.max(0.1, startSec + 0.1)}
            max={durationMax}
            step={0.1}
            value={endSec}
            onChange={(e) => {
              const next = normalizeTrimNumber(e.target.value);
              onEndChange(durationMax ? Math.min(durationMax, Math.max(startSec + 0.1, next)) : Math.max(startSec + 0.1, next));
            }}
            className="rounded-[10px] border border-c-border bg-surface-1 px-3 py-2 text-[13px] font-semibold text-c-text outline-none transition focus:border-[#ff3d6a]/50"
          />
        </label>
        <div className="rounded-[10px] border border-c-border bg-surface-1 px-3 py-2 text-[11px] font-semibold text-c-text-muted">
          Clip length
        </div>
      </div>
    </div>
  );
}

function VideoTrimPreview({ src, startSec, endSec, duration, onDurationLoaded, onStartChange, onEndChange }: TrimPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="mt-3 overflow-hidden rounded-[14px] border border-c-border bg-black">
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
  const s = map[status] ?? { bg: "bg-surface-2", text: "text-c-text-secondary", label: status };
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
    <div className="group flex flex-col overflow-hidden rounded-[18px] border border-c-border bg-surface-1 transition hover:border-c-border-hover">
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
        <p className="text-[15px] font-bold leading-snug text-c-text line-clamp-2">
          {v.title || "Untitled Ranking"}
        </p>

        {/* Description */}
        {description && (
          <p className="text-[12px] leading-5 text-c-text-muted line-clamp-2">{description}</p>
        )}

        {/* Meta chips row */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <StatusBadge status={v.status} />
          {segCount != null && (
            <span className="rounded-full border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-c-text-muted">
              {segCount} clips
            </span>
          )}
          <span className="rounded-full border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-c-text-muted">
            {createdAt}
          </span>
          <span className="rounded-full border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-c-text-muted">
            9:16
          </span>
        </div>

        {/* Order range */}
        {order && (
          <div className="flex items-center gap-2 text-[11px] text-c-text-muted">
            <span className="font-semibold">{order === "countdown" ? "5→1 countdown" : "1→5 ascending"}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn("h-full rounded-full transition-all duration-500", isReady ? "bg-emerald-500" : isError ? "bg-red-500" : "bg-c-text-muted")}
            style={{ width: isReady ? "100%" : isError ? "30%" : "0%" }}
          />
        </div>

        {/* Hashtags */}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full border border-c-border bg-surface-2 px-2.5 py-0.5 text-[10px] text-c-text-muted">
              {t}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="rounded-full border border-c-border bg-surface-2 px-2.5 py-0.5 text-[10px] text-c-text-muted">
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
          <h1 className="font-display text-2xl font-bold text-c-text">Video Rankings</h1>
          <p className="mt-1 text-[13px] text-c-text-muted">{total} ranking{total !== 1 ? "s" : ""} created</p>
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
            <div key={i} className="overflow-hidden rounded-[18px] border border-c-border bg-surface-1 animate-pulse">
              <div className="aspect-video w-full bg-surface-2" />
              <div className="flex flex-col gap-2.5 p-4">
                <div className="h-4 w-3/4 rounded-md bg-surface-2" />
                <div className="h-3 w-1/2 rounded-md bg-surface-2" />
                <div className="h-1 w-full rounded-full bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-[20px] border border-dashed border-c-border bg-surface-1 py-20 text-center">
          <span className="text-4xl">🏆</span>
          <p className="text-sm font-semibold text-c-text-secondary">No ranking videos yet</p>
          <p className="text-[12px] text-c-text-muted">Create your first ranked countdown video</p>
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
                className="rounded-[9px] border border-c-border px-3 py-1.5 text-[12px] font-semibold text-c-text-muted transition hover:text-c-text disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-[12px] font-semibold text-c-text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => load(page + 1)}
                disabled={page >= totalPages}
                className="rounded-[9px] border border-c-border px-3 py-1.5 text-[12px] font-semibold text-c-text-muted transition hover:text-c-text disabled:opacity-30"
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
              : "border-c-border hover:border-c-border-hover"
          )}
        >
          <MiniPreview config={tpl.config} />
          <div className="text-center">
            <p className="text-[11px] font-bold text-c-text">{tpl.name}</p>
            <p className="text-[9.5px] text-c-text-muted">{tpl.desc}</p>
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
      <span className="text-[11px] text-c-text-muted min-w-0 flex-1">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <div
          className="h-5 w-5 rounded-[4px] border border-c-border cursor-pointer"
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
        <span className="font-mono text-[10px] text-c-text-muted w-14">{value}</span>
      </div>
    </div>
  );

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-c-text-muted">Customize</span>
      {field("Background", "bgColor", config.bgColor)}
      {field("Title", "titleColor", config.titleColor)}
      {field("Accent", "accentColor", config.accentColor)}
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-c-text-muted">Number colors</span>
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          {config.numberColors.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div
                className="h-5 w-5 rounded-full border border-c-border cursor-pointer"
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
              <span className="text-[8px] text-c-text-muted">#{i + 1}</span>
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

function RankingPhonePreview({
  title,
  segments,
  order,
  templateConfig,
}: {
  title: string;
  segments: Segment[];
  order: Order;
  templateConfig: TemplateConfig;
}) {
  return (
    <div
      className="relative flex h-72 w-40 flex-col overflow-hidden rounded-[14px]"
      style={{ background: templateConfig.bgColor, fontFamily: templateConfig.font }}
    >
      <p
        className="px-3 pt-3 text-center text-[11px] font-black leading-tight"
        style={{ color: templateConfig.titleColor }}
      >
        {title || "Your Title"}
      </p>
      <div className="flex flex-1 flex-col gap-2 px-3 pt-3">
        {segments.slice(0, 5).map((s, i) => {
          const rank = order === "countdown" ? segments.length - i : i + 1;
          const color = templateConfig.numberColors[i] ?? templateConfig.numberColors.at(-1)!;
          return (
            <div key={s.id} className="flex items-center gap-1.5">
              <span className="text-[15px] font-black leading-none" style={{ color }}>
                {rank}.
              </span>
              {s.segmentTitle && (
                <span className="truncate text-[9px] text-white/70">{s.segmentTitle}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RankingJobsStrip({
  jobs,
  onDismiss,
}: {
  jobs: RankingJob[];
  onDismiss: (jobId: string) => void;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className="mb-5 rounded-[16px] border border-c-border bg-surface-1 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Ranking Jobs</h2>
        <span className="text-[11px] font-medium text-c-text-muted">{jobs.length} active</span>
      </div>
      <div className="grid gap-2">
        {jobs.map((job) => (
          <div key={job.jobId} className="rounded-[12px] border border-c-border bg-surface-2 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-c-text">{job.label}</p>
                <p className="mt-0.5 text-[11px] text-c-text-muted">
                  {job.failed ? "Failed" : job.done ? "Ready" : job.status}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!job.done && !job.failed && (
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="8" stroke="#ff3d6a" strokeOpacity="0.25" strokeWidth="2.5" />
                    <path d="M10 2a8 8 0 0 1 8 8" stroke="#ff3d6a" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {job.done && !job.failed && (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="9" fill="#34d399" fillOpacity="0.15" />
                    <polyline points="5.5 10.5 8.5 13.5 14.5 7.5" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {job.failed && (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
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
                <button
                  onClick={() => onDismiss(job.jobId)}
                  className="grid h-7 w-7 place-items-center rounded-[8px] text-c-text-muted transition hover:bg-surface-3 hover:text-c-text-secondary"
                  aria-label={`Dismiss ${job.label}`}
                >
                  x
                </button>
              </div>
            </div>
            {!job.done && !job.failed && (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-[#ff3d6a] transition-all duration-500" style={{ width: `${job.progress}%` }} />
                </div>
                <p className="mt-1 text-right text-[10px] font-semibold text-c-text-muted">{job.progress}%</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
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
  const [builderStep, setBuilderStep] = useState<BuilderStep>("sources");
  const [expandedSegmentId, setExpandedSegmentId] = useState<string>(() => segments[0]?.id ?? "");

  const updateJob = (jobId: string, patch: Partial<RankingJob>) =>
    setJobs((prev) => prev.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)));

  const updateSeg = (id: string, patch: Partial<Segment>) =>
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSeg = () => {
    const segment = newSegment();
    setSegments((prev) => [...prev, segment]);
    setExpandedSegmentId(segment.id);
  };
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
  const uploadPromises = useRef<Map<string, Promise<string>>>(new Map());
  const uploadSeq = useRef<Record<string, number>>({});
  useEffect(() => { return () => { previewUrls.current.forEach(URL.revokeObjectURL); }; }, []);

  useEffect(() => {
    if (!segments.some((s) => s.id === expandedSegmentId)) {
      setExpandedSegmentId(segments[0]?.id ?? "");
    }
  }, [segments, expandedSegmentId]);

  const handleUrlBlur = useCallback((id: string, url: string) => {
    const nextUrl = url.trim();
    if (!nextUrl) return;
    const seq = (uploadSeq.current[id] ?? 0) + 1;
    uploadSeq.current[id] = seq;
    updateSeg(id, { previewLoading: true, previewError: null, previewUrl: "" });
    videoApi.createRankingPreview(nextUrl)
      .then((res) => {
        if (uploadSeq.current[id] !== seq) return;
        updateSeg(id, { previewUrl: res.preview_url });
      })
      .catch((e) => {
        if (uploadSeq.current[id] !== seq) return;
        updateSeg(id, { previewError: e instanceof Error ? e.message : "Failed to create preview" });
      })
      .finally(() => {
        if (uploadSeq.current[id] === seq) updateSeg(id, { previewLoading: false });
      });
  }, []);

  function uploadPreviewProxy(segmentId: string, videoId: string, seq: number) {
    return videoApi.previewProxy(videoId)
      .then((video) => {
        if (uploadSeq.current[segmentId] !== seq) return;
        const meta = video.metadata as Record<string, unknown> | null | undefined;
        const previewUrl = typeof meta?.preview_storage_url === "string" ? meta.preview_storage_url : null;
        if (previewUrl) updateSeg(segmentId, { previewUrl });
      })
      .catch(() => {});
  }

  function startFileUpload(segmentId: string, file: File) {
    const seq = (uploadSeq.current[segmentId] ?? 0) + 1;
    uploadSeq.current[segmentId] = seq;
    const objUrl = URL.createObjectURL(file);
    previewUrls.current.add(objUrl);
    updateSeg(segmentId, {
      file,
      previewUrl: objUrl,
      previewLoading: false,
      previewError: null,
      startSec: 0,
      endSec: 15,
      uploading: true,
      uploadError: null,
      videoId: "",
    });

    const promise = (async () => {
      try {
        const up = await videoApi.upload(file, file.name);
        if (uploadSeq.current[segmentId] !== seq) return up.id;
        updateSeg(segmentId, { videoId: up.id });
        void uploadPreviewProxy(segmentId, up.id, seq);
        return up.id;
      } catch (e) {
        if (uploadSeq.current[segmentId] === seq) {
          updateSeg(segmentId, { uploadError: e instanceof Error ? e.message : "Upload failed" });
        }
        throw e;
      } finally {
        if (uploadSeq.current[segmentId] === seq) {
          updateSeg(segmentId, { uploading: false });
        }
        uploadPromises.current.delete(segmentId);
      }
    })();

    uploadPromises.current.set(segmentId, promise);
    return promise;
  }

  const handleFileChange = useCallback((id: string, file: File | null) => {
    if (!file) return;
    void startFileUpload(id, file);
  }, []);

  async function ensureUploadedVideo(s: Segment) {
    if (s.inputType !== "upload") return null;
    if (s.videoId) return s.videoId;
    if (!s.file) return null;
    const pending = uploadPromises.current.get(s.id);
    return pending ?? startFileUpload(s.id, s.file);
  }

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
              const vid = await ensureUploadedVideo(s);
              if (!vid) throw new Error("Upload is still preparing. Try again in a moment.");
              if (!s.videoId) updateSeg(s.id, { videoId: vid });
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
  const currentStepIndex = BUILDER_STEPS.findIndex((step) => step.id === builderStep);
  const canGoBackStep = currentStepIndex > 0;
  const canGoNextStep = currentStepIndex < BUILDER_STEPS.length - 1;
  const goToPreviousStep = () => {
    if (canGoBackStep) setBuilderStep(BUILDER_STEPS[currentStepIndex - 1].id);
  };
  const goToNextStep = () => {
    if (canGoNextStep) setBuilderStep(BUILDER_STEPS[currentStepIndex + 1].id);
  };

  function SegmentEditor({ segment: s, index: idx }: { segment: Segment; index: number }) {
    const rankLabel = order === "countdown" ? segments.length - idx : idx + 1;
    const platform = detectPlatform(s.url);
    const expanded = expandedSegmentId === s.id;

    return (
      <div className={cn(
        "rounded-[16px] border bg-surface-1 transition",
        expanded ? "border-c-border-hover" : "border-c-border"
      )}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setExpandedSegmentId(expanded ? "" : s.id)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: accent }}>
              #{rankLabel}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-c-text">{s.segmentTitle || `Video ${idx + 1}`}</span>
              <span className="mt-0.5 block truncate text-[11px] text-c-text-muted">
                {s.inputType === "upload" ? s.file?.name || "Upload file" : s.url || "URL source"} · {s.startSec}s-{s.endSec}s
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => moveSeg(idx, -1)} disabled={idx === 0}
              className="grid h-7 w-7 place-items-center rounded-lg border border-c-border text-c-text-muted transition hover:text-c-text disabled:opacity-30">↑</button>
            <button onClick={() => moveSeg(idx, 1)} disabled={idx === segments.length - 1}
              className="grid h-7 w-7 place-items-center rounded-lg border border-c-border text-c-text-muted transition hover:text-c-text disabled:opacity-30">↓</button>
            {segments.length > 2 && (
              <button onClick={() => removeSeg(s.id)}
                className="grid h-7 w-7 place-items-center rounded-lg border border-red-400/20 text-red-400 transition hover:bg-red-400/[.08]">x</button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-c-border px-4 pb-4 pt-3">
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-[12px] border border-c-border bg-surface-2 p-1">
              {(["url", "upload"] as InputType[]).map((t) => (
                <button key={t} onClick={() => updateSeg(s.id, { inputType: t })}
                  className={cn("rounded-[9px] py-2 text-xs font-bold capitalize transition",
                    s.inputType === t ? "bg-[#ff3d6a] text-white" : "text-c-text-muted hover:text-c-text")}>
                  {t === "url" ? "URL" : "Upload file"}
                </button>
              ))}
            </div>

            {s.inputType === "url" ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input value={s.url}
                    onChange={(e) => updateSeg(s.id, { url: e.target.value, previewUrl: "", previewError: null })}
                    onBlur={(e) => handleUrlBlur(s.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleUrlBlur(s.id, s.url); }}
                    placeholder="https://youtube.com/watch?v=... or TikTok URL"
                    className={inputCls} />
                  {platform && (
                    <span className="shrink-0 rounded-lg border border-c-border bg-surface-2 px-2.5 py-2 text-[11px] font-semibold text-c-text-secondary">
                      {platform}
                    </span>
                  )}
                </div>
                {s.url.trim() && (
                  <TrimTimeFields
                    startSec={s.startSec}
                    endSec={s.endSec}
                    duration={s.duration}
                    onStartChange={(v) => updateSeg(s.id, { startSec: v })}
                    onEndChange={(v) => updateSeg(s.id, { endSec: v })}
                  />
                )}
                {s.previewLoading && (
                  <div className="mt-3 rounded-[13px] border border-c-border bg-surface-2 px-3 py-3 text-[12px] font-semibold text-c-text-secondary">
                    Preparing low-res video preview...
                  </div>
                )}
                {s.previewError && (
                  <p className="mt-2 text-[11px] text-red-400">{s.previewError}</p>
                )}
                {s.previewUrl && (
                  <VideoTrimPreview src={s.previewUrl} startSec={s.startSec} endSec={s.endSec} duration={s.duration}
                    onDurationLoaded={(d) => handleDuration(s.id, d, s.endSec)}
                    onStartChange={(v) => updateSeg(s.id, { startSec: v })}
                    onEndChange={(v) => updateSeg(s.id, { endSec: v })} />
                )}
              </>
            ) : (
              <>
                <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed p-6 text-center transition",
                  s.file ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.04]" : "border-c-border bg-surface-2 hover:border-c-border-hover")}>
                  <input type="file" accept="video/*" className="hidden"
                    onChange={(e) => handleFileChange(s.id, e.target.files?.[0] ?? null)} />
                  <span className="text-[13px] font-semibold text-c-text-secondary">
                    {s.file ? s.file.name : "Drop or browse a video"}
                  </span>
                </label>
                {s.uploading && (
                  <p className="mt-2 text-[11px] text-c-text-muted">Preparing low-res preview...</p>
                )}
                {s.uploadError && (
                  <p className="mt-2 text-[11px] text-red-400">{s.uploadError}</p>
                )}
                {s.previewUrl && (
                  <VideoTrimPreview src={s.previewUrl} startSec={s.startSec} endSec={s.endSec} duration={s.duration}
                    onDurationLoaded={(d) => handleDuration(s.id, d, s.endSec)}
                    onStartChange={(v) => updateSeg(s.id, { startSec: v })}
                    onEndChange={(v) => updateSeg(s.id, { endSec: v })} />
                )}
                <TrimTimeFields
                  startSec={s.startSec}
                  endSec={s.endSec}
                  duration={s.duration}
                  onStartChange={(v) => updateSeg(s.id, { startSec: v })}
                  onEndChange={(v) => updateSeg(s.id, { endSec: v })}
                />
              </>
            )}

            <div className="mt-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-c-text-muted">Clip label (shown next to number)</span>
                <input value={s.segmentTitle}
                  onChange={(e) => updateSeg(s.id, { segmentTitle: e.target.value })}
                  placeholder={`e.g. "absolutely insane"`}
                  className={inputCls} />
              </label>
            </div>

          </div>
        )}
      </div>
    );
  }

  function SourcesStep() {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-c-text">Source clips</h2>
            <p className="mt-1 text-[13px] text-c-text-muted">Add clips in the order they should appear in the ranking.</p>
          </div>
          <button
            onClick={addSeg}
            className="rounded-[11px] border border-c-border bg-surface-1 px-3 py-2 text-[12px] font-bold text-c-text transition hover:bg-surface-2"
          >
            + Add Video ({segments.length} total)
          </button>
        </div>

        <div className="space-y-3">
          {segments.map((s, idx) => (
            <SegmentEditor key={s.id} segment={s} index={idx} />
          ))}
        </div>
      </div>
    );
  }

  function StyleStep() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-c-text">Style ranking</h2>
          <p className="mt-1 text-[13px] text-c-text-muted">Set the title, visual template, colors, and ranking order.</p>
        </div>

        <div className="rounded-[16px] border border-c-border bg-surface-1 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Title</span>
          <div className="mt-2 flex items-center gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Top 5 ..." className={inputCls} />
            <button onClick={handleSuggest} disabled={suggestLoading}
              className="shrink-0 rounded-[11px] border border-c-border bg-surface-2 px-3 py-3 text-[13px] font-bold text-c-text transition hover:bg-surface-3 disabled:opacity-40">
              {suggestLoading ? "..." : "AI"}
            </button>
          </div>
        </div>

        <div className="rounded-[16px] border border-c-border bg-surface-1 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Template</span>
          <div className="mt-3">
            <TemplatePicker
              selected={templateId}
              onSelect={(id, config) => { setTemplateId(id); setTemplateConfig(config); }}
            />
          </div>
          <ColorCustomizer config={templateConfig} onChange={setTemplateConfig} />
        </div>

        <div className="rounded-[16px] border border-c-border bg-surface-1 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Order</span>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={() => setOrder("countdown")}
              className={cn("rounded-[10px] border py-2 text-xs font-bold transition",
                order === "countdown" ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-c-text" : "border-c-border text-c-text-muted hover:text-c-text")}>
              5 to 1 Countdown
            </button>
            <button onClick={() => setOrder("ascending")}
              className={cn("rounded-[10px] border py-2 text-xs font-bold transition",
                order === "ascending" ? "border-[#ff3d6a] bg-[#ff3d6a]/[.12] text-c-text" : "border-c-border text-c-text-muted hover:text-c-text")}>
              1 to 5 Ascending
            </button>
          </div>
        </div>
      </div>
    );
  }

  function ReviewStep() {
    const selectedTemplate = TEMPLATES.find((tpl) => tpl.id === templateId);

    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-c-text">Review ranking</h2>
          <p className="mt-1 text-[13px] text-c-text-muted">Check the final setup before generating the ranking video.</p>
        </div>

        <div className="rounded-[16px] border border-c-border bg-surface-1 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Title</span>
              <p className="mt-1 text-sm font-bold text-c-text">{title || "Top Ranking"}</p>
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Style</span>
              <p className="mt-1 text-sm font-bold text-c-text">{selectedTemplate?.name ?? templateId} · {order === "countdown" ? "Countdown" : "Ascending"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-[16px] border border-c-border bg-surface-1 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Clips</span>
          <div className="mt-3 grid gap-2">
            {segments.map((s, idx) => {
              const rankLabel = order === "countdown" ? segments.length - idx : idx + 1;
              return (
                <button
                  key={s.id}
                  onClick={() => { setBuilderStep("sources"); setExpandedSegmentId(s.id); }}
                  className="flex items-center justify-between gap-3 rounded-[11px] border border-c-border bg-surface-2 px-3 py-2.5 text-left transition hover:border-c-border-hover"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: accent }}>
                      #{rankLabel}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-c-text">{s.segmentTitle || `Video ${idx + 1}`}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-c-text-muted">
                        {s.inputType === "upload" ? s.file?.name || "Upload file" : s.url || "Missing URL"} · {s.startSec}s-{s.endSec}s
                      </span>
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold text-c-text-muted">Edit</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function BuilderRail() {
    return (
      <div className="rounded-[16px] border border-c-border bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-c-text-muted">Preview</span>
          <span className="rounded-full border border-c-border bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-c-text-muted">9:16</span>
        </div>
        <div className="mt-4 flex justify-center">
          <RankingPhonePreview title={title} segments={segments} order={order} templateConfig={templateConfig} />
        </div>

        {error && (
          <div className="mt-4 rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-3 py-2 text-[12px] font-medium text-red-400">
            {error}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={goToPreviousStep}
            disabled={!canGoBackStep}
            className="rounded-[10px] border border-c-border px-3 py-2 text-[12px] font-bold text-c-text-secondary transition hover:bg-surface-2 disabled:opacity-35"
          >
            Back
          </button>
          {builderStep !== "review" ? (
            <button
              onClick={goToNextStep}
              className="rounded-[10px] bg-[#ff3d6a] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#e8304f]"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-[10px] bg-[#ff3d6a] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#e8304f] disabled:opacity-60"
            >
              {generating ? "Submitting..." : "Generate"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6">
      <RankingJobsStrip
        jobs={jobs}
        onDismiss={(jobId) => setJobs((prev) => prev.filter((j) => j.jobId !== jobId))}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-[9px] border border-c-border text-c-text-muted transition hover:bg-surface-2 hover:text-c-text"
            aria-label="Back to rankings"
          >
            ←
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold text-c-text">New Video Ranking</h1>
            <p className="mt-0.5 text-[13px] text-c-text-muted">Create a ranked countdown video from 2 or more clips</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)_300px]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="grid gap-2 rounded-[16px] border border-c-border bg-surface-1 p-2">
            {BUILDER_STEPS.map((step, index) => {
              const active = step.id === builderStep;
              const complete = index < currentStepIndex;
              return (
                <button
                  key={step.id}
                  onClick={() => setBuilderStep(step.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-[11px] px-3 py-3 text-left transition",
                    active ? "bg-[#ff3d6a]/12 text-[#ff5f86] ring-1 ring-[#ff3d6a]/25" : "text-c-text-muted hover:bg-surface-2 hover:text-c-text-secondary"
                  )}
                >
                  <span className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                    active || complete ? "bg-[#ff3d6a] text-white" : "bg-surface-2 text-c-text-muted"
                  )}>
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold">{step.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-c-text-muted">{step.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0">
          {builderStep === "sources" && <SourcesStep />}
          {builderStep === "style" && <StyleStep />}
          {builderStep === "review" && <ReviewStep />}
        </main>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <BuilderRail />
        </aside>
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
