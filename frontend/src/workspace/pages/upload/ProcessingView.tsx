import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";
import { videoApi, platformApi, token as authToken, API_BASES, type VideoResponse, type SocialAccount } from "@/lib/api";
import { PROC_STEPS, STEP_ICONS, STEP_COLORS, SOCIAL_PLATFORMS, pipelineStepIdx, formatElapsedSince } from "./constants";
import { fmtDur, gradFromId } from "./helpers";

const VIDEO_SSE_BASE = API_BASES.video;

const RANKING_STEPS = [
  { keys: ["queued"], label: "Queued", sub: "Waiting for a ranking worker" },
  { keys: ["starting", "download"], label: "Preparing sources", sub: "Loading each ranked video" },
  { keys: ["render"], label: "Rendering segments", sub: "Applying ranking layout and labels" },
  { keys: ["concatenat"], label: "Joining video", sub: "Combining rendered segments" },
  { keys: ["upload"], label: "Uploading video", sub: "Saving the final ranking video" },
  { keys: ["caption"], label: "Generating captions", sub: "Preparing platform captions" },
  { keys: ["complete"], label: "Done", sub: "Ranking video ready" },
];

/* ─── Social connect banner shown during processing ─── */
function SocialConnectBanner({ isRanking = false }: { isRanking?: boolean }) {
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
      <div className="rounded-[13px] border border-emerald-300/25 bg-emerald-50 p-4 dark:border-emerald-300/15 dark:bg-emerald-400/[.04]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-emerald-300/30 bg-emerald-100 text-emerald-600 text-sm dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-300">✓</div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-300">All platforms connected</div>
            <div className="text-[11.5px] text-c-text-muted">{isRanking ? "Ranking video" : "Clips"} will be ready to publish when processing completes.</div>
          </div>
          <a href="/integrations" className="shrink-0 self-start text-[11.5px] font-semibold text-c-text-muted transition hover:text-c-text sm:ml-auto sm:self-center">Manage →</a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {accounts.filter((a) => a.is_active).map((a) => {
            const plat = SOCIAL_PLATFORMS.find((p) => p.id === a.platform);
            return (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-c-text-secondary">
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
    <div className="rounded-[13px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.05] p-4 dark:border-[#ff3d6a]/15 dark:bg-[#ff3d6a]/[.04]" style={{ animation: "fadeUp .3s .4s cubic-bezier(.22,.8,.4,1) both" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a] text-sm">↗</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-c-text">Connect social accounts while you wait</div>
          <div className="mt-0.5 text-[11.5px] text-c-text-muted">
            {connectedIds.size > 0
              ? `${connectedIds.size} connected · connect more to publish ${isRanking ? "your ranking video" : "clips"} instantly`
              : `Your ${isRanking ? "ranking video" : "clips"} will be ready soon — connect accounts to publish with one click`}
          </div>
        </div>
        <a href="/integrations"
          className="shrink-0 self-start rounded-[8px] border border-[#ff3d6a]/30 bg-[#ff3d6a]/10 px-3 py-1.5 text-[12px] font-semibold text-[#ff3d6a] transition hover:bg-[#ff3d6a]/20 sm:ml-auto sm:self-center">
          Connect →
        </a>
      </div>

      {connectedIds.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {accounts.filter((a) => a.is_active).map((a) => {
            const plat = SOCIAL_PLATFORMS.find((p) => p.id === a.platform);
            return (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-300">
                <span className={cn("inline-grid h-3.5 w-3.5 place-items-center rounded-[2px] text-[7px] font-black text-white", plat?.color ?? "bg-zinc-700")}>{plat?.icon}</span>
                {a.platform_username ?? a.platform}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {unconnected.map((p) => (
          <a key={p.id} href="/integrations"
            className="inline-flex items-center gap-1.5 rounded-full border border-c-border bg-surface-1 px-2.5 py-1 text-[11px] font-semibold text-c-text-muted transition hover:border-c-border-hover hover:text-c-text">
            <span className={cn("inline-grid h-3.5 w-3.5 place-items-center rounded-[2px] text-[7px] font-black", p.color, p.id === "twitter" ? "" : "text-white")}>{p.icon}</span>
            + {p.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─── Processing view (SSE + polling fallback) ─── */
type LiveEvent = {
  id: string;
  kind: "clip_ready" | "clip_uploading" | "clips_ready" | "info";
  label: string;
  sub?: string;
  pct?: number;
  step?: string;
  thumbnail?: string;
  ts: number;
};

export function ProcessingView({
  video,
  onDone,
  onCancel,
  onNewUpload,
}: {
  video: VideoResponse;
  onDone: (updated: VideoResponse) => void;
  onCancel?: () => void;
  onNewUpload?: () => void;
}) {
  const [current, setCurrent] = useState(video);
  const [liveMsg, setLiveMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>(video.error_message ?? "");
  const [now, setNow] = useState(Date.now());
  const [retrying, setRetrying] = useState(false);

  const sanitize = (s: string) => {
    if (!s) return s;
    return s.replace(/\/tmp\/viralo-video\/[a-f0-9-]+\//gi, "[internal-path]/")
            .replace(/\/app\/[^\s)]+/gi, "[app-path]");
  };

  const STORAGE_KEY = `viralo_live_${video.celery_task_id ?? video.id}`;
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as LiveEvent[]) : [];
    } catch { return []; }
  });

  const doneRef = useRef(false);
  const sseActiveRef = useRef(false);
  const clipCountRef = useRef(0);

  const isTerminal = (v: VideoResponse) =>
    v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

  const lastStepRef = useRef<string>("");
  const pushEvent = (ev: Omit<LiveEvent, "id" | "ts">) =>
    setLiveEvents((prev) => {
      const sanitizedEv = { ...ev, label: sanitize(ev.label), sub: ev.sub ? sanitize(ev.sub) : undefined };
      const next = [{ ...sanitizedEv, id: Math.random().toString(36).slice(2), ts: Date.now() }, ...prev].slice(0, 30);
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });

  useEffect(() => {
    setCurrent(video);
    setErrorMsg(sanitize(video.error_message ?? ""));
    doneRef.current = false;
  }, [video.id, video.status, video.pipeline_step, video.pipeline_pct, video.error_message]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  // SSE — primary real-time progress channel with exponential backoff reconnect
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!current.celery_task_id || doneRef.current) return;
    const jobId = current.celery_task_id;

    const isRanking = current.source_type === "ranking";

    const clippingStepLabels: Record<string, string> = {
      download: "Downloading video…", upload: "Uploading to storage…",
      metadata: "Probing video metadata…", diarization: "Speaker diarization…",
      topic_segmentation: "Segmenting topics…", scene_extraction: "Extracting scenes…",
      transcribe: "Transcribing speech…", scoring: "Finding viral moments…",
      ai_content: "Generating titles & hashtags…", export: "Rendering clips…",
      captions: "Burning captions…", saving: "Saving clips…", complete: "All done!",
      template: "Applying template…", render: "Rendering with effects…",
      voiceover: "Generating AI voiceover…", audio_mix: "Mixing audio tracks…",
      enhance: "Enhancing quality…", cancelled: "Processing cancelled.",
    };
    const rankingStepLabels: Record<string, string> = {
      starting: "Preparing ranking video…",
      downloading: "Resolving & downloading sources…",
      rendering: "Rendering segments…",
      concatenating: "Joining segments into final video…",
      uploading: "Uploading ranking video…",
      captions: "Generating platform captions…",
      complete: "Ranking video ready!",
      cancelled: "Processing cancelled.",
    };
    const stepLabels = isRanking ? rankingStepLabels : clippingStepLabels;

    async function connect() {
      if (doneRef.current) return;
      const t = authToken.get() || "";
      if (!t) return;
      const es = await videoApi.progressStream(jobId);
      esRef.current = es;

      es.onopen = () => { sseActiveRef.current = true; retryRef.current = 0; };

      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "keepalive") return;

          if (d.message) setLiveMsg(sanitize(d.message));
          if (d.pct != null || d.step || d.status) {
            setCurrent((prev) => ({
              ...prev,
              pipeline_pct: d.pct ?? prev.pipeline_pct,
              pipeline_step: d.step ?? prev.pipeline_step,
              status: d.status === "complete" ? "ready" : d.status === "failed" ? "failed" : d.status === "processing" ? "processing" : prev.status,
              error_message: d.status === "failed" ? (d.message ?? prev.error_message) : prev.error_message,
            }));
          }
          if (d.status === "failed" && d.message) setErrorMsg(sanitize(d.message));

          if (!isRanking) {
            if (d.event === "clip_upload_complete") {
              clipCountRef.current += 1;
              pushEvent({ kind: "clip_ready", label: `Clip ${clipCountRef.current} ready`, sub: d.title ?? undefined, thumbnail: d.thumbnail_url ?? undefined });
            }
            if (d.event === "clip_upload_failed") {
              pushEvent({ kind: "info", label: `Clip upload failed`, sub: d.clip_id ?? undefined, step: "failed" });
            }
            if (d.event === "clips_ready") {
              const count = typeof d.count === "number" ? d.count : "";
              pushEvent({ kind: "clips_ready", label: `${count} clips found`, sub: "Uploading to cloud…" });
            }
          }

          if (d.message && d.step && d.step !== "keepalive") {
            const isNewStep = d.step !== lastStepRef.current;
            if (isNewStep) lastStepRef.current = d.step;
            const normalizedStep = isRanking && d.step?.startsWith("rendered_") ? "rendering" : d.step;
            pushEvent({ kind: "info", label: d.message, pct: d.pct ?? undefined, step: normalizedStep });
          } else if (d.step && d.step !== "keepalive" && d.step !== lastStepRef.current) {
            lastStepRef.current = d.step;
            const normalizedStep = isRanking && d.step?.startsWith("rendered_") ? "rendering" : d.step;
            const label = stepLabels[normalizedStep] ?? (isRanking && normalizedStep === "rendering" ? `Rendering segment…` : null);
            if (label) pushEvent({ kind: "info", label, step: normalizedStep });
          }

          if (d.status === "complete" || d.status === "failed" || d.status === "cancelled") {
            es.close();
            esRef.current = null;
            sseActiveRef.current = false;
            if (!doneRef.current) {
              doneRef.current = true;
              try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
              videoApi.get(current.id).then(onDone).catch(() => onDone(current));
            }
          }
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        sseActiveRef.current = false;
        es.close();
        esRef.current = null;
        if (doneRef.current) return;
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30_000);
        retryRef.current += 1;
        retryTimerRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
      sseActiveRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [current.celery_task_id]);

  // Polling fallback also catches terminal state when Redis/SSE is unavailable.
  useEffect(() => {
    if (doneRef.current || isTerminal(current)) return;
    const id = window.setInterval(async () => {
      if (doneRef.current) return;
      try {
        const updated = await videoApi.get(current.id);
        const stillQueued = updated.status === "queued" || (!updated.pipeline_step && (updated.pipeline_pct ?? 0) === 0);
        if (stillQueued && updated.created_at && updated.source_type !== "ranking") {
          const queuedMs = Date.now() - new Date(updated.created_at).getTime();
          if (queuedMs > 5 * 60 * 1000) {
            setErrorMsg("No video worker picked up this job within 5 minutes. The worker may be down — please try again or contact support.");
            return;
          }
        }
        setCurrent(updated);
        if (updated.error_message) setErrorMsg(updated.error_message);
        if (isTerminal(updated) && !doneRef.current) {
          doneRef.current = true;
          setTimeout(() => onDone(updated), 400);
        }
      } catch { /* retry next tick */ }
    }, 2500);
    return () => window.clearInterval(id);
  }, [current.id, current.status, current.pipeline_step, current.pipeline_pct, onDone]);

  const overallPct = Math.min(Math.max(current.pipeline_pct ?? 0, 0), 100);
  const grad = gradFromId(current.id);
  const queuedFor = formatElapsedSince(current.created_at, now);
  const isQueued = current.status === "queued" || (!current.pipeline_step && overallPct === 0);
  const isRankingVideo = current.source_type === "ranking";
  const pipelineSteps = isRankingVideo ? RANKING_STEPS : PROC_STEPS;
  const stepIdx = isRankingVideo
    ? Math.max(0, pipelineSteps.findIndex((step) => step.keys.some((key) => (current.pipeline_step ?? "queued").toLowerCase().includes(key))))
    : pipelineStepIdx(current.pipeline_step);
  const sourceLabel = isRankingVideo ? "Ranking video" : current.source_type === "youtube_url" ? "YouTube" : "Uploaded file";

  const isDone = current.status === "done" || current.status === "ready" || current.pipeline_step === "complete";
  const showCancel = Boolean(onCancel && current.status !== "failed" && !isTerminal(current));
  const showNewUpload = Boolean(onNewUpload);
  const useActionGrid = showCancel && showNewUpload;

  // suppress unused warning
  void liveMsg;

  return (
    <div data-testid="processing-view" className="flex w-full min-w-0 max-w-full flex-col gap-4 overflow-x-hidden">
      {/* ── HEADER ───────────────────────────────── */}
      <div className="min-w-0 overflow-hidden rounded-[16px] border border-c-border bg-surface-1 p-4 sm:p-5">
          {/* Top row */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 items-start gap-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ff3d6a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-bold leading-tight tracking-[-0.4px] text-c-text sm:text-[22px]">Processing…</h1>
              <p className="mt-0.5 text-[13px] text-c-text-muted">
                {isRankingVideo ? "Rendering your ranked countdown video." : "AI is analyzing your video and generating clips."}
              </p>
            </div>
            </div>
            <div
              data-testid="processing-actions"
              className={cn(
                "w-full gap-2 sm:ml-auto sm:flex sm:w-auto sm:shrink-0 sm:justify-end",
                useActionGrid ? "grid grid-cols-2 sm:flex" : "flex flex-wrap",
              )}
            >
              <button onClick={() => navigate("/projects")}
                className="inline-flex w-full items-center justify-center rounded-[10px] border border-c-border bg-surface-2 px-3 py-2 text-[13px] font-medium text-c-text-secondary transition hover:bg-surface-3 sm:w-auto sm:px-3.5">
                Projects
              </button>
              {showCancel && (
                <button
                  onClick={() => { if (window.confirm("Cancel processing? This cannot be undone.")) onCancel!(); }}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-red-400/30 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-500 transition hover:bg-red-100 dark:border-red-400/[.28] dark:bg-red-400/[.07] dark:text-red-400 dark:hover:bg-red-400/[.14] sm:w-auto sm:px-3.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Cancel
                </button>
              )}
              {showNewUpload && (
                <button onClick={() => isRankingVideo ? navigate("/ranking") : onNewUpload!()}
                  className={cn(
                    "inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#ff3d6a] px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-85 sm:w-auto sm:px-3.5",
                    useActionGrid && "col-span-2 sm:col-span-1",
                  )}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {isRankingVideo ? "New ranking" : "New upload"}
                </button>
              )}
            </div>
          </div>

          {/* Video strip */}
          <div data-testid="processing-video-strip" className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-[12px] border border-c-border bg-surface-2 p-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 items-center gap-4">
            <div className={cn("grid h-12 w-14 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br", grad)}>
              <span className="text-xl">{isRankingVideo ? "🏆" : "🎬"}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-c-text">{current.title ?? "Untitled"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-c-text-muted">
                <span>{sourceLabel}</span>
                {current.duration_sec && <><span className="text-c-text-muted">·</span><span>{fmtDur(current.duration_sec)}</span></>}
                <span className="text-c-text-muted">·</span>
                {current.status === "failed"
                  ? <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/10 px-2 py-0.5 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed</span>
                  : <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />{isQueued ? "Queued" : "Processing"}</span>
                }
              </div>
            </div>
            </div>
            <div className="w-full min-w-0 sm:w-auto sm:min-w-[130px] sm:shrink-0 sm:text-right">
              {current.created_at && <div className="mb-1.5 text-[11px] text-c-text-muted">Elapsed: {formatElapsedSince(current.created_at, now)}</div>}
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#F59E0B] transition-[width_.3s_linear]" style={{ width: `${overallPct}%` }} />
              </div>
              <div className="mt-1.5 font-mono text-[12px] font-semibold text-c-text">{overallPct}%</div>
            </div>
          </div>
      </div>

      {/* ── LEAVE PAGE NOTICE ────────────────────── */}
      <div className="flex min-w-0 items-start gap-2.5 overflow-hidden rounded-[10px] border border-c-border bg-surface-1 px-4 py-2.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-c-text-muted">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
        </svg>
        <p className="min-w-0 flex-1 text-[12px] text-c-text-muted">
          You can leave this page — processing continues in the background. You'll be emailed and notified when your {isRankingVideo ? "ranking video is" : "clips are"} ready.
        </p>
      </div>

      {/* ── QUEUED BANNER ─────────────────────────── */}
      {isQueued && current.status !== "failed" && (
        <div className="rounded-[12px] border border-yellow-300/20 bg-yellow-50 p-3.5 dark:border-yellow-300/15 dark:bg-yellow-400/[.045]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[12.5px] font-semibold text-yellow-700 dark:text-yellow-200">{isRankingVideo ? "Waiting for a ranking worker" : "Waiting for a video worker"}</div>
              <div className="mt-0.5 text-[11.5px] text-c-text-muted">
                Queued for <span className="font-mono text-c-text-secondary">{queuedFor}</span>.
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10.5px] font-mono text-c-text-muted">
              <span className="rounded-[7px] border border-c-border bg-surface-1 px-2 py-1">video {current.id.slice(0, 8)}</span>
              {current.celery_task_id && <span className="rounded-[7px] border border-c-border bg-surface-1 px-2 py-1">task {current.celery_task_id.slice(0, 8)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── ERROR ─────────────────────────────────── */}
      {(current.status === "failed" || errorMsg) && errorMsg && (
        <div className="break-all rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 font-mono text-[11.5px] leading-snug text-red-500 dark:border-red-500/20 dark:bg-red-500/[.07] dark:text-red-400">
          <div className="flex items-start justify-between gap-3">
            <span>{errorMsg}</span>
            <button type="button" disabled={retrying}
              onClick={async () => {
                if (isRankingVideo) {
                  navigate("/ranking");
                  return;
                }
                setRetrying(true);
                try { const updated = await videoApi.retry(current.id); setErrorMsg(""); setCurrent(updated); }
                catch { /* keep error visible */ } finally { setRetrying(false); }
              }}
              className="shrink-0 cursor-pointer rounded-[7px] border border-red-300 bg-red-100 px-2.5 py-1 text-[10.5px] font-semibold text-red-500 transition hover:bg-red-200 disabled:opacity-50 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300 dark:hover:bg-red-400/20">
              {isRankingVideo ? "New ranking" : retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        </div>
      )}

      {/* ── TWO-COLUMN MAIN ───────────────────────── */}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[260px_1fr]">

        {/* LEFT: VERTICAL STEPPER */}
        <div className="min-w-0 overflow-hidden rounded-[18px] border border-c-border bg-surface-1 p-4 sm:p-5">
          <div className="mb-5 text-[10px] font-bold uppercase tracking-[1.2px] text-c-text-muted">Pipeline</div>
          <div className="flex flex-col">
            {pipelineSteps.filter((_, i) => i < pipelineSteps.length - 1).map((step, i) => {
              const done = isDone || i < stepIdx;
              const active = !isDone && i === stepIdx;
              return (
                <div key={step.label} className="relative flex gap-3.5">
                  {i < pipelineSteps.length - 2 && (
                    <div className="absolute bottom-0 left-[15px] top-8 z-0 w-[2px]"
                      style={{
                        background: done
                          ? "linear-gradient(180deg, rgba(34,197,94,0.5) 0%, rgba(34,197,94,0.12) 100%)"
                          : active
                          ? "linear-gradient(180deg, rgba(245,158,11,0.4) 0%, rgba(245,158,11,0.05) 100%)"
                          : "var(--c-border)",
                      }}
                    />
                  )}
                  <div className="relative z-10 shrink-0">
                    <div className={cn(
                      "grid h-8 w-8 place-items-center rounded-full border-2 text-[11px] font-bold transition",
                      done ? "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                      : active ? "border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400"
                      : "border-c-border bg-surface-2 text-c-text-muted"
                    )} style={active ? { boxShadow: "0 0 0 4px rgba(245,158,11,0.1)" } : {}}>
                      {done
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        : active
                        ? <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                        : <span>{i + 1}</span>
                      }
                    </div>
                  </div>
                  <div className="min-w-0 pb-4 pt-0.5">
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-c-text-muted">Step {i + 1}</div>
                    <div className={cn("mt-0.5 text-[13px] font-semibold leading-snug",
                      done ? "text-c-text-secondary" : active ? "text-c-text" : "text-c-text-muted"
                    )}>{step.label}</div>
                    <div className={cn(
                      "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                      done ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400"
                      : active ? "bg-amber-100 text-amber-600 dark:bg-amber-400/[.12] dark:text-amber-400"
                      : "bg-surface-2 text-c-text-muted"
                    )}>
                      {done ? "Done" : active ? "In Progress" : "Pending"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex min-w-0 flex-col gap-4">
          <SocialConnectBanner isRanking={isRankingVideo} />

          {liveEvents.length > 0 && (
            <div className="overflow-hidden rounded-[16px] border border-c-border bg-surface-1">
              <div className="flex items-center justify-between border-b border-c-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff3d6a] opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff3d6a]" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[.08em] text-c-text-muted">Terminal</span>
                </div>
              </div>
              <div className="max-h-[320px] divide-y divide-c-border overflow-y-auto">
                {liveEvents.map((ev) => {
                  const stepColor = ev.kind === "clip_ready" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                    : ev.kind === "clips_ready" ? "border-[#ff3d6a]/20 bg-[#ff3d6a]/10 text-[#ff3d6a]"
                    : ev.step ? (STEP_COLORS[ev.step] ?? "border-c-border bg-surface-2 text-c-text-muted")
                    : "border-c-border bg-surface-2 text-c-text-muted";
                  const icon = ev.kind === "clip_ready" ? "✓" : ev.kind === "clips_ready" ? "✦" : ev.step ? (STEP_ICONS[ev.step] ?? "›") : "›";
                  const elapsed = Math.round((Date.now() - ev.ts) / 1000);
                  return (
                    <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5" style={{ animation: "fadeUp .2s ease" }}>
                      {ev.thumbnail
                        ? <img src={ev.thumbnail} alt="" className="h-7 w-[42px] shrink-0 rounded-[5px] object-cover" />
                        : <div className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border text-[10px]", stepColor)}>{icon}</div>
                      }
                      <div className="min-w-0 flex-1">
                        <div className={cn("font-mono text-[12px] leading-snug",
                          ev.kind === "clip_ready" ? "text-emerald-600 dark:text-emerald-300"
                          : ev.kind === "clips_ready" ? "font-semibold text-c-text"
                          : "text-c-text-secondary"
                        )}>{ev.label}</div>
                        {ev.sub && <div className="mt-0.5 text-[10.5px] text-c-text-muted">{ev.sub}</div>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {ev.pct != null && <span className="rounded-[4px] bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-c-text-muted">{ev.pct}%</span>}
                        <span className="font-mono text-[9.5px] text-c-text-muted">{elapsed < 5 ? "just now" : `${elapsed}s ago`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
