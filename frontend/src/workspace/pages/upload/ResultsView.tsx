import { useState, useEffect, useRef, useMemo } from "react";
import { cn, safeFilename, downloadBlob, downloadUrl, stripSrtTimecodes } from "@/lib/utils";
import { videoApi, platformApi, type VideoResponse, type ClipApiResponse, type ScheduledPost } from "@/lib/api";
import { VirtualizedGrid } from "../../components/VirtualizedCollection";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClipCard, ClipDetailModal } from "./ClipCard";
import { BulkPublishModal } from "./BulkPublishModal";
import { gradFromId } from "./helpers";

type ZipPhase = "zipping" | "done" | "error";

const REGEN_OPTS = [
  { id:"hook",        label:"Optimize hooks"    },
  { id:"top-moments", label:"More top moments"  },
  { id:"captions",    label:"Recaption"          },
  { id:"short",       label:"Shorten to 30s"    },
  { id:"vertical",    label:"Reformat vertical" },
];

export function DeleteModal({
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

export function ZipDownloadModal({ clips, videoTitle, onClose }: {
  clips: ClipApiResponse[];
  videoTitle: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<ZipPhase>("zipping");
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    async function run() {
      const ids = clips.filter((c) => c.storage_url).map((c) => c.id);
      if (!ids.length) { setError("No downloadable clips."); setPhase("error"); return; }

      try {
        const blob = await videoApi.downloadZip(ids, videoTitle);
        if (cancelledRef.current) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeFilename(videoTitle, "zip");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setPhase("done");
        setTimeout(onClose, 1200);
      } catch (e: unknown) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setPhase("error");
      }
    }

    void run();
    return () => { cancelledRef.current = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[340px] rounded-[16px] border border-white/[.10] bg-[#0f1520] p-6 shadow-[0_24px_60px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-white">
            {phase === "zipping" && "Preparing ZIP…"}
            {phase === "done" && "Done!"}
            {phase === "error" && "Error"}
          </span>
          {(phase === "done" || phase === "error") && (
            <button onClick={onClose} className="text-[12px] text-zinc-500 hover:text-zinc-300">Close</button>
          )}
        </div>

        {phase === "zipping" && (
          <div className="flex items-center gap-2.5 text-[12px] text-zinc-400">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            Server is fetching and zipping {clips.filter((c) => c.storage_url).length} clips…
          </div>
        )}

        {phase === "done" && (
          <div className="text-[12px] text-emerald-400">✓ ZIP downloaded successfully</div>
        )}

        {phase === "error" && (
          <div className="text-[12px] text-red-400">{error}</div>
        )}

        {phase === "zipping" && (
          <button onClick={() => { cancelledRef.current = true; onClose(); }}
            className="mt-4 text-[11.5px] text-zinc-600 hover:text-zinc-400">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function DownloadMenu({ clip, onClose }: { clip: ClipApiResponse; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener("click", fn), 50);
    return () => document.removeEventListener("click", fn);
  }, []);

  const title = clip.title ?? "clip";

  const items: { label: string; icon: string; onClick?: () => void; disabled?: boolean }[] = [
    {
      label: "Download MP4", icon: "🎬",
      disabled: !clip.storage_url,
      onClick: () => { void downloadUrl(clip.storage_url!, safeFilename(title, "mp4")); onClose(); },
    },
    {
      label: "Download SRT", icon: "💬",
      disabled: !clip.caption_srt,
      onClick: () => { downloadBlob(clip.caption_srt!, safeFilename(title, "srt"), "text/plain"); onClose(); },
    },
    {
      label: "Download thumbnail", icon: "🖼",
      disabled: !clip.thumbnail_url,
      onClick: () => { void downloadUrl(clip.thumbnail_url!, safeFilename(title, "jpg")); onClose(); },
    },
    {
      label: copied ? "Copied!" : "Copy transcript", icon: "📝",
      disabled: !clip.caption_srt,
      onClick: () => {
        navigator.clipboard.writeText(stripSrtTimecodes(clip.caption_srt!))
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      },
    },
    {
      label: "Share link", icon: "🔗",
      onClick: () => { navigator.clipboard.writeText(window.location.href); onClose(); },
    },
  ];

  return (
    <div ref={ref} className="absolute bottom-[calc(100%+6px)] right-0 z-50 w-48 overflow-hidden rounded-[11px] border border-white/[.10] bg-[#141926] shadow-[0_16px_40px_rgba(0,0,0,.5)]"
      onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        const cls = `flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] transition ${item.disabled ? "cursor-not-allowed opacity-40 text-zinc-500" : "text-zinc-300 hover:bg-white/[.05] hover:text-white"}`;
        return (
          <div key={item.label}>
            {i === 3 && <div className="mx-3 border-t border-white/[.07]" />}
            <button onClick={item.disabled ? undefined : item.onClick} disabled={item.disabled} className={cls}>
              <span>{item.icon}</span>{item.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function RetryVideoButton({ videoId, onRetried }: { videoId: string; onRetried: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try { await videoApi.retry(videoId); onRetried(); }
        catch { setRetrying(false); }
      }}
      className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-300 hover:bg-red-400/20 disabled:opacity-50 transition cursor-pointer"
    >
      {retrying ? "Retrying…" : "↻ Retry"}
    </button>
  );
}

export function FailedErrorCard({ errorMessage, videoId, onRetried }: { errorMessage: string; videoId: string; onRetried: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  type ErrorKind = { label: string; msg: string; hint: string };
  const kind: ErrorKind = (() => {
    if (/429|Too Many Requests/i.test(errorMessage))
      return { label: "Rate limited", msg: "YouTube throttled this request (HTTP 429).", hint: "Wait a few minutes before retrying — YouTube limits how often a server can fetch the same video." };
    if (/403|Forbidden/i.test(errorMessage))
      return { label: "Access denied", msg: "YouTube refused access to this video (HTTP 403).", hint: "The video may be age-restricted, region-locked, or require sign-in. Try a different video." };
    if (/unavailable|removed|private/i.test(errorMessage))
      return { label: "Unavailable", msg: "This video is unavailable or private.", hint: "Check that the link is correct and the video is publicly accessible." };
    const firstLine = errorMessage.split("\n")[0].replace(/^(ERROR|WARNING|CRITICAL):\s*/i, "");
    const msg = firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine;
    return { label: "Processing error", msg, hint: "Expand the details below for the full error log." };
  })();

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await videoApi.retry(videoId);
      onRetried();
    } catch {
      setRetryError("Retry failed — check service logs or try again shortly.");
      setRetrying(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-[540px]" style={{ animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}>
      <div className="overflow-hidden rounded-[18px] border border-red-500/20 bg-[#0e1420]">
        <div className="h-[3px] w-full bg-gradient-to-r from-red-500/80 via-red-400/60 to-transparent" />

        <div className="p-6">
          <div className="mb-5 flex items-start gap-4">
            <div className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-red-500/25 bg-red-500/10">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-bold text-red-300">{kind.label}</span>
                <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 uppercase tracking-wide">Failed</span>
              </div>
              <p className="text-[13px] font-medium text-zinc-200 leading-snug mb-2">{kind.msg}</p>
              <p className="text-[12px] text-zinc-500 leading-relaxed">{kind.hint}</p>
            </div>
          </div>

          {retryError && (
            <div className="mb-4 flex items-center gap-2 rounded-[8px] border border-red-500/20 bg-red-500/[.06] px-3 py-2">
              <svg className="h-3.5 w-3.5 flex-none text-red-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7.25 4.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zm.75 7a1 1 0 110-2 1 1 0 010 2z"/>
              </svg>
              <span className="text-[11.5px] text-red-400">{retryError}</span>
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex cursor-pointer items-center gap-2 rounded-[9px] bg-[#ff3d6a] px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_2px_16px_rgba(255,61,106,.3)] transition-all hover:bg-[#ff3d6a]/85 hover:shadow-[0_4px_20px_rgba(255,61,106,.4)] active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {retrying
                ? <>
                    <span className="block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Retrying…
                  </>
                : <>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13.5 2.5A6.5 6.5 0 012.5 8M2.5 13.5A6.5 6.5 0 0113.5 8"/>
                      <polyline points="2.5,10.5 2.5,13.5 5.5,13.5"/>
                      <polyline points="13.5,2.5 13.5,5.5 10.5,5.5"/>
                    </svg>
                    Retry processing
                  </>
              }
            </button>

            <button
              onClick={() => setExpanded(v => !v)}
              className="flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-white/[.08] bg-white/[.03] px-3.5 py-2.5 text-[12px] text-zinc-400 transition hover:border-white/[.12] hover:bg-white/[.06] hover:text-zinc-200"
            >
              <svg className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-180")} viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 10.94L2.53 5.47a.75.75 0 011.06-1.06L8 8.88l4.41-4.47a.75.75 0 111.06 1.06L8 10.94z"/>
              </svg>
              {expanded ? "Hide details" : "Show details"}
            </button>
          </div>

          {expanded && (
            <div className="mt-4 overflow-hidden rounded-[10px] border border-white/[.07] bg-black/40">
              <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-red-400/70" />
                <span className="h-2 w-2 rounded-full bg-yellow-400/40" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="ml-2 text-[10.5px] font-mono text-zinc-600">error.log</span>
              </div>
              <pre className="max-h-[200px] overflow-auto p-4 text-[10.5px] font-mono leading-relaxed text-zinc-500 whitespace-pre-wrap">
                {errorMessage}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ResultsView({
  video,
  clips,
  onBack,
  onNewUpload,
}: {
  video: VideoResponse;
  clips: ClipApiResponse[];
  onBack: () => void;
  onNewUpload?: () => void;
}) {
  const grad = gradFromId(video.id);
  const [regenModal, setRegenModal] = useState(false);
  const [regenOpts, setRegenOpts] = useState(["hook","top-moments","captions"]);
  const toggleOpt = (id: string) => setRegenOpts((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const [zipModal, setZipModal] = useState(false);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [publishFilter, setPublishFilter] = useState<"all" | "posted" | "queued" | "unposted">("all");
  const [detailClip, setDetailClip] = useState<ClipApiResponse | null>(null);
  const toggleSelect = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const selectAll = () => setSelected(new Set(clips.map((c) => c.id)));
  const clearSel = () => setSelected(new Set());

  useEffect(() => {
    platformApi.listPosts({ per_page: 200 })
      .then((r) => setPosts(Array.isArray(r.items) ? r.items : []))
      .catch(() => {});
  }, []);

  const postedClipIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) { if (p.status === "posted" && p.clip_id) s.add(p.clip_id); }
    return s;
  }, [posts]);

  const scheduledClipIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) {
      if (["scheduled","pending","processing"].includes(p.status) && p.clip_id) s.add(p.clip_id);
    }
    return s;
  }, [posts]);

  const postsByClipId = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const p of posts) {
      if (!p.clip_id) continue;
      const list = map.get(p.clip_id) ?? [];
      list.push(p);
      map.set(p.clip_id, list);
    }
    return map;
  }, [posts]);

  const filteredClips = useMemo(() => {
    if (publishFilter === "all") return clips;
    return clips.filter((c) => {
      const isPosted = postedClipIds.has(c.id);
      const isQueued = scheduledClipIds.has(c.id);
      if (publishFilter === "posted") return isPosted;
      if (publishFilter === "queued") return isQueued;
      if (publishFilter === "unposted") return !isPosted && !isQueued;
      return true;
    });
  }, [clips, publishFilter, postedClipIds, scheduledClipIds]);

  const PUBLISH_FILTERS: { id: typeof publishFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "posted", label: "Posted" },
    { id: "queued", label: "Queued" },
    { id: "unposted", label: "Not posted" },
  ];

  return (
    <div className="mx-auto max-w-[1240px] px-3 sm:px-5">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 rounded-[8px] border border-c-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-c-text-secondary transition hover:bg-surface-3 hover:text-c-text">
          ‹ Projects
        </button>
        <div className={cn("h-7 w-10 flex-none rounded-[6px] bg-gradient-to-br", grad)} />
        <h2 className="font-display text-[18px] font-bold text-c-text">{video.title ?? "Untitled"}</h2>
        <span className="rounded-full border border-c-border bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-c-text-muted">
          {clips.length} clips
        </span>
        {(video.status === "done" || video.status === "ready")
          ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Ready</span>
          : <><span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed</span>
            <RetryVideoButton videoId={video.id} onRetried={onBack} /></>}
        <div className="ml-auto flex shrink-0 gap-2">
          {onNewUpload && (
            <button
              onClick={onNewUpload}
              className="flex items-center gap-1.5 rounded-[8px] border border-c-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-c-text-secondary transition hover:bg-surface-3 hover:text-c-text"
            >
              + New upload
            </button>
          )}
          <button
            onClick={() => { selectAll(); setBulkModal(true); }}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#ff3d6a]/85"
          >
            ↗ Publish all
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 rounded-[8px] border border-c-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-c-text-secondary transition hover:bg-surface-3 hover:text-c-text">
                ···
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {video.source_type !== "ranking" && (
                <DropdownMenuItem onClick={() => setRegenModal(true)}>
                  ✦ Regenerate all
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setZipModal(true)}>
                ↓ Download all
              </DropdownMenuItem>
              {video.source_type !== "ranking" && video.storage_url && (
                <DropdownMenuItem onClick={() => void downloadUrl(video.storage_url!, safeFilename(video.title, "mp4"))}>
                  ↓ Source video
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold text-rose-400">{selected.size} clip{selected.size > 1 ? "s" : ""} selected</span>
          <button onClick={clearSel} className="text-[11.5px] text-c-text-muted hover:text-c-text-secondary">Clear</button>
          <button onClick={selectAll} className="text-[11.5px] text-c-text-muted hover:text-c-text-secondary">Select all</button>
          <button
            onClick={() => setBulkModal(true)}
            className="ml-auto flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            ↗ Schedule {selected.size} clip{selected.size > 1 ? "s" : ""}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PUBLISH_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setPublishFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap",
              publishFilter === f.id
                ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-rose-100"
                : "border-c-border bg-surface-2 text-c-text-muted hover:border-c-border-hover hover:bg-surface-3 hover:text-c-text-secondary"
            )}
          >
            {f.label}
            {f.id === "posted" && postedClipIds.size > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-bold text-amber-400">{postedClipIds.size}</span>
            )}
            {f.id === "queued" && scheduledClipIds.size > 0 && (
              <span className="ml-1.5 rounded-full bg-blue-500/15 px-1.5 py-px text-[10px] font-bold text-blue-400">{scheduledClipIds.size}</span>
            )}
          </button>
        ))}
      </div>

      {filteredClips.length > 0
        ? <VirtualizedGrid
            items={filteredClips}
            keyForItem={(clip) => clip.id}
            estimateRowHeight={390}
            columns={[{ minWidth: 640, columns: 2 }, { minWidth: 1024, columns: 4 }]}
            renderItem={(c, i) => (
              <ClipCard
                clip={c}
                idx={i}
                selected={selected.has(c.id)}
                onToggleSelect={() => toggleSelect(c.id)}
                isPosted={postedClipIds.has(c.id)}
                isScheduled={scheduledClipIds.has(c.id)}
                posts={postsByClipId.get(c.id) ?? []}
                onOpen={() => setDetailClip(c)}
              />
            )}
          />
        : video.status === "failed"
          ? <FailedErrorCard errorMessage={video.error_message ?? "Processing failed. No additional details available."} videoId={video.id} onRetried={() => onBack()} />
          : <div className="py-16 text-center text-zinc-500">No clips generated yet.</div>}

      {bulkModal && (
        <BulkPublishModal
          clips={clips.filter((c) => selected.has(c.id))}
          onClose={() => { setBulkModal(false); clearSel(); }}
        />
      )}

      {zipModal && (
        <ZipDownloadModal
          clips={clips}
          videoTitle={video.title ?? "clips"}
          onClose={() => setZipModal(false)}
        />
      )}

      {regenModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6"
          style={{ background: "rgba(4,7,15,.8)", backdropFilter: "blur(6px)", animation: "fadeUp .15s ease" }}
          onClick={(e) => e.target === e.currentTarget && setRegenModal(false)}>
          <div className="w-full max-w-[460px] overflow-hidden rounded-[18px] border border-white/[.12] bg-[#0e1420] p-4 shadow-[0_40px_100px_rgba(0,0,0,.7)] sm:rounded-[20px] sm:p-6"
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

      {detailClip && (
        <ClipDetailModal
          clip={detailClip}
          isPosted={postedClipIds.has(detailClip.id)}
          isScheduled={scheduledClipIds.has(detailClip.id)}
          posts={postsByClipId.get(detailClip.id) ?? []}
          onClose={() => setDetailClip(null)}
          onPublish={() => setBulkModal(true)}
        />
      )}
    </div>
  );
}
