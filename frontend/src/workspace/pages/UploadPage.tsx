import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Shell } from "../Shell";
import { videoApi, type VideoResponse, type ClipApiResponse } from "@/lib/api";

/* ─── Types ─── */
type Source = "file" | "yt";
type View = "upload" | "processing" | "results";

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

/* ─── Pipeline step label mapping ─── */
const PROC_STEPS = [
  { keys: ["upload","uploading"],   emoji:"⬆",  label:"Uploading file",      sub:"Transferring to secure storage" },
  { keys: ["extract","audio"],      emoji:"🎵", label:"Extracting audio",     sub:"Isolating speech track" },
  { keys: ["transcribe","speech"],  emoji:"📝", label:"Transcribing speech",  sub:"AI speech-to-text in progress" },
  { keys: ["analyze","analysis"],   emoji:"🔍", label:"Analyzing content",    sub:"Scoring moments by virality" },
  { keys: ["scenes","scene"],        emoji:"🎞", label:"Detecting scenes",     sub:"Breaking video into segments" },
  { keys: ["select","clip"],        emoji:"✂",  label:"Selecting best clips", sub:"Picking top moments" },
  { keys: ["render","encode"],      emoji:"🎬", label:"Rendering clips",      sub:"Encoding final videos" },
];

function pipelineStepIdx(step: string | null): number {
  if (!step) return 0;
  const s = step.toLowerCase();
  const idx = PROC_STEPS.findIndex((p) => p.keys.some((k) => s.includes(k)));
  return idx >= 0 ? idx : 0;
}

/* ─── Processing view (real polling) ─── */
function ProcessingView({
  video,
  onDone,
}: {
  video: VideoResponse;
  onDone: (updated: VideoResponse) => void;
}) {
  const [current, setCurrent] = useState(video);
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    const isTerminal = (v: VideoResponse) =>
      v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

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
    }, 2000);
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
                {state === "active" && current.pipeline_step && (
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
function ClipCard({ clip, idx }: { clip: ClipApiResponse; idx: number }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const durMs = clip.duration_ms ?? ((clip.end_ms ?? 0) - (clip.start_ms ?? 0));
  const durSec = durMs / 1000;
  const startSec = (clip.start_ms ?? 0) / 1000;
  const endSec = (clip.end_ms ?? durMs) / 1000;
  const grad = gradFromId(clip.id);
  const plats = clip.platform ? [clip.platform] : [];
  const hasVideo = Boolean(clip.storage_url);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true); }
    else { videoRef.current.pause(); setPlaying(false); }
  };

  return (
    <div className="overflow-hidden rounded-[13px] border border-white/[.07] bg-[#0e1420] transition hover:border-white/[.12]"
      style={{ animation: `fadeUp .3s ${idx * 60}ms cubic-bezier(.22,.8,.4,1) both` }}>

      {/* Thumbnail / video player */}
      <div
        className={cn(
          "relative aspect-[9/12] cursor-pointer overflow-hidden",
          !hasVideo && !clip.thumbnail_url ? `bg-gradient-to-br ${grad}` : "bg-black"
        )}
        onClick={hasVideo ? togglePlay : undefined}
      >
        {hasVideo ? (
          <video
            ref={videoRef}
            src={clip.storage_url!}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            preload="metadata"
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />
        ) : clip.thumbnail_url ? (
          <img src={clip.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}

        {/* Overlay — hide when playing */}
        {!playing && (
          <div className="absolute inset-0 bg-black/20" />
        )}

        {plats.length > 0 && (
          <div className="absolute left-2 top-2 flex gap-1">
            {plats.map((p) => <PlatPill key={p} p={p} />)}
          </div>
        )}

        {clip.score != null && (
          <div className="absolute right-2 top-2">
            <VirChip score={clip.score} />
          </div>
        )}

        {/* Play/pause overlay button */}
        {hasVideo && !playing && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70">
              ▶
            </div>
          </div>
        )}

        {durSec > 0 && (
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
            {fmtSec(durSec)}
          </div>
        )}
        {clip.start_ms != null && clip.end_ms != null && !playing && (
          <div className="absolute left-2 bottom-2 text-[10px] font-mono text-white/70">
            {fmtSec(startSec)} → {fmtSec(endSec)}
          </div>
        )}
      </div>

      <div className="p-3.5">
        <div className="mb-2 text-[13px] font-semibold leading-snug">{clip.title ?? "Clip"}</div>
        <div className="mb-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
          {plats.length > 0 && <span className="flex gap-1">{plats.map((p) => <PlatPill key={p} p={p} />)}</span>}
          {plats.length > 0 && <span>·</span>}
          {durSec > 0 && <span>{fmtSec(durSec)} clip</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hasVideo && (
            <button onClick={togglePlay}
              className="flex items-center gap-1.5 rounded-[7px] border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white">
              {playing ? "⏸ Pause" : "▶ Preview"}
            </button>
          )}
          <button className="flex items-center gap-1.5 rounded-[7px] border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white">
            ✂ Edit
          </button>
          {clip.storage_url && (
            <a href={clip.storage_url} download
              className="flex items-center gap-1.5 rounded-[7px] border border-white/[.08] bg-white/[.03] px-2 py-1.5 text-[11.5px] font-medium text-zinc-400 transition hover:text-white">
              ↓
            </a>
          )}
          <button className="ml-auto flex items-center gap-1.5 rounded-[7px] bg-[#ff3d6a] px-2.5 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_2px_10px_rgba(255,61,106,.25)] transition hover:shadow-[0_4px_16px_rgba(255,61,106,.4)]">
            ↗ Publish
          </button>
        </div>
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
          <button className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:text-white">
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
      {clips.length > 0
        ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{clips.map((c, i) => <ClipCard key={c.id} clip={c} idx={i} />)}</div>
        : <div className="py-16 text-center text-zinc-500">No clips generated yet.</div>}
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
      const video = await videoApi.upload(file, file.name.replace(/\.[^.]+$/, ""));
      setHistory((h) => [video, ...h]);
      setActiveVideo(video);
      setView("processing");
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleUrlFetch = useCallback(async () => {
    if (!urlVal.trim()) return;
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.youtube(urlVal.trim());
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
  }, [urlVal]);

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
