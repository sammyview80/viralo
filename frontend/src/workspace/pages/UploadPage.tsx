import { useState, useEffect, useRef, useCallback } from "react";
import { navigate } from "@/lib/router";
import { videoApi, token as authToken, API_BASES, type VideoResponse, type ClipApiResponse, type ClipConfig } from "@/lib/api";
import { DEFAULT_CONFIG } from "./upload/constants";
import { ProcessingView } from "./upload/ProcessingView";
import { ResultsView, DeleteModal } from "./upload/ResultsView";

export { DEFAULT_CONFIG } from "./upload/constants";

const VIDEO_SSE_BASE = API_BASES.video;

type Source = "file" | "yt";
type View = "upload" | "processing" | "results";

export function UploadPage() {
  const [source, setSource] = useState<Source>("file");
  const [view, setView] = useState<View>("upload");
  const [uploadStep, setUploadStep] = useState(1);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeVideo, setActiveVideo] = useState<VideoResponse | null>(null);
  const [clips, setClips] = useState<ClipApiResponse[]>([]);
  const [drag, setDrag] = useState(false);
  const [urlVal, setUrlVal] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [history, setHistory] = useState<VideoResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoResponse | null>(null);
  const [clipConfig, setClipConfig] = useState<ClipConfig>(DEFAULT_CONFIG);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTerminalStatus = (v: VideoResponse) =>
    v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

  useEffect(() => {
    videoApi.list().then((res) => {
      setHistory(res.items);
    }).catch(() => {}).finally(() => setHistoryLoading(false));
  }, []);

  const historySseRef = useRef<Map<string, EventSource>>(new Map());
  useEffect(() => {
    const inProgress = history.filter((v) => !isTerminalStatus(v) && v.celery_task_id);
    const activeIds = new Set(inProgress.map((v) => v.celery_task_id!));

    for (const [tid, es] of historySseRef.current) {
      if (!activeIds.has(tid)) { es.close(); historySseRef.current.delete(tid); }
    }

    const t = authToken.get() || "";
    if (!t) return;

    for (const video of inProgress) {
      const tid = video.celery_task_id!;
      if (historySseRef.current.has(tid)) continue;

      void videoApi.progressStream(tid).then((es) => {
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "keepalive") return;
          if (d.pct != null || d.step != null || d.status != null) {
            setHistory((prev) => prev.map((v) =>
              v.id === video.id
                ? { ...v,
                    pipeline_pct: d.pct ?? v.pipeline_pct,
                    pipeline_step: d.step ?? v.pipeline_step,
                    status: d.status === "complete" ? "ready" : d.status === "failed" ? "failed" : v.status,
                  }
                : v
            ));
          }
          if (d.status === "complete" || d.status === "failed") {
            es.close();
            historySseRef.current.delete(tid);
            videoApi.get(video.id).then((updated) =>
              setHistory((prev) => prev.map((v) => v.id === updated.id ? updated : v))
            ).catch(() => {});
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); historySseRef.current.delete(tid); };
      historySseRef.current.set(tid, es);
      }).catch(() => {});
    }

    return () => {/* keep sources open across renders — cleaned up above */};
  }, [history.map((v) => `${v.id}:${v.status}:${v.celery_task_id}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    for (const es of historySseRef.current.values()) es.close();
    historySseRef.current.clear();
  }, []);

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

  const handleFile = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    setPendingFile(files[0]);
    setUploadError("");
    setUploadStep(2);
  }, []);

  const handleUrlReady = useCallback(() => {
    if (!urlReady) return;
    setUploadError("");
    setUploadStep(2);
  }, [urlReady]);

  const handleConfirm = useCallback(async () => {
    setUploading(true);
    setUploadError("");
    try {
      if (source === "file" && pendingFile) {
        const video = await videoApi.upload(pendingFile, pendingFile.name.replace(/\.[^.]+$/, ""), clipConfig);
        setHistory((h) => [video, ...h]);
        setActiveVideo(video);
        setView("processing");
      } else if (source === "yt" && urlVal.trim()) {
        const video = await videoApi.youtube(urlVal.trim(), undefined, clipConfig);
        setHistory((h) => [video, ...h]);
        setActiveVideo(video);
        setUrlVal("");
        setUrlReady(false);
        setView("processing");
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploadStep(5);
    } finally {
      setUploading(false);
    }
  }, [source, pendingFile, urlVal, clipConfig]);

  const handleDone = useCallback(async (updated: VideoResponse) => {
    setHistory((h) => h.map((v) => v.id === updated.id ? updated : v));
    setActiveVideo(updated);
    if (updated.status === "done" || updated.status === "ready") {
      try {
        const clipList = await videoApi.clips(updated.id);
        setClips(clipList.items);
      } catch { setClips([]); }
    }
    setView("results");
  }, []);

  const loadVideo = useCallback(async (vid: VideoResponse) => {
    if (vid.status === "processing" || vid.status === "pending" || vid.status === "queued") {
      setActiveVideo(vid);
      setView("processing");
      return;
    }
    setActiveVideo(vid);
    if (vid.status === "done" || vid.status === "ready") {
      try {
        const clipList = await videoApi.clips(vid.id);
        setClips(clipList.items);
      } catch { setClips([]); }
    }
    setView("results");
  }, []);

  useEffect(() => {
    const pathMatch = window.location.pathname.match(/^\/projects\/([^/]+)$/);
    const videoId = pathMatch?.[1] ?? new URLSearchParams(window.location.search).get("video");
    if (!videoId) return;
    setLoadingVideo(true);
    videoApi.get(videoId)
      .then(loadVideo)
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : "Could not open project");
        setView("upload");
      })
      .finally(() => setLoadingVideo(false));
  }, [loadVideo]);

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
    <>
      {deleteTarget && (
        <DeleteModal
          video={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="flex h-[calc(100vh-116px)] min-w-0 flex-col overflow-hidden bg-surface-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
          {loadingVideo && (
            <div className="flex h-full flex-col overflow-hidden -mx-3 -my-3 sm:-mx-5 sm:-my-5">
              <div className="border-b border-c-border">
                <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3 px-3 py-3 sm:px-5 sm:py-4">
                  <div className="h-7 w-20 animate-pulse rounded-[8px] bg-surface-3" />
                  <div className="h-8 w-8 animate-pulse rounded-[10px] bg-surface-3" />
                  <div className="h-5 w-48 animate-pulse rounded-[6px] bg-surface-3" />
                  <div className="h-6 w-14 animate-pulse rounded-full bg-surface-2" />
                  <div className="h-6 w-16 animate-pulse rounded-full bg-emerald-400/[.12]" />
                  <div className="ml-auto flex gap-2">
                    <div className="h-8 w-28 animate-pulse rounded-[10px] bg-surface-2" />
                    <div className="h-8 w-24 animate-pulse rounded-[10px] bg-[#ff3d6a]/20" />
                  </div>
                </div>
              </div>
              <div className="mx-auto w-full max-w-[1240px] px-3 sm:px-5">
                <div className="flex gap-2 py-3">
                  {["w-10", "w-16", "w-16", "w-20"].map((w, i) => (
                    <div key={i} className={`h-7 ${w} animate-pulse rounded-full bg-surface-2`} style={{ animationDelay: `${i * 40}ms` }} />
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[1240px] px-3 pb-6 sm:px-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="overflow-hidden rounded-[16px] border border-c-border bg-surface-2" style={{ animationDelay: `${i * 80}ms` }}>
                      <div className="relative aspect-video w-full animate-pulse bg-surface-2">
                        <div className="absolute bottom-2 left-2 h-5 w-14 rounded-[6px] bg-surface-3" />
                        <div className="absolute bottom-2 right-2 h-5 w-10 rounded-[6px] bg-surface-3" />
                      </div>
                      <div className="space-y-2.5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-1.5">
                            <div className="h-4 w-full animate-pulse rounded bg-surface-3" />
                            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
                          </div>
                          <div className="h-5 w-10 animate-pulse rounded-full bg-surface-2" />
                        </div>
                        <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
                        <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {["w-14","w-12","w-16","w-12","w-10"].map((w, j) => (
                            <div key={j} className={`h-5 ${w} animate-pulse rounded-full bg-surface-2`} />
                          ))}
                        </div>
                        <div className="flex items-center gap-2 border-t border-c-border pt-2.5">
                          <div className="h-8 flex-1 animate-pulse rounded-[9px] bg-[#ff3d6a]/20" />
                          <div className="h-8 w-8 animate-pulse rounded-[9px] bg-surface-2" />
                          <div className="h-8 w-8 animate-pulse rounded-[9px] bg-surface-2" />
                          <div className="h-8 w-8 animate-pulse rounded-[9px] bg-surface-2" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              </div>
            </div>
          )}

          {view === "processing" && activeVideo && (
            <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto">
              <div data-testid="processing-page-shell" className="mx-auto w-full min-w-0 max-w-[1100px] py-4 pb-[max(env(safe-area-inset-bottom),4rem)] sm:py-6 lg:pb-10">
              <ProcessingView
                video={activeVideo}
                onDone={handleDone}
                onCancel={async () => {
                  try { await videoApi.cancel(activeVideo.id); } catch { /* ignore */ }
                  setView("upload");
                  setActiveVideo(null);
                  setClips([]);
                }}
                onNewUpload={() => {
                  setView("upload");
                  setActiveVideo(null);
                  setClips([]);
                  setUploadError("");
                  setUploadStep(1);
                  setPendingFile(null);
                }}
              />
              </div>
            </div>
          )}

          {view === "results" && activeVideo && (
            <div className="h-full overflow-y-auto">
              <ResultsView
                video={activeVideo}
                clips={clips}
                onBack={() => navigate("/projects")}
                onNewUpload={() => navigate("/studio")}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
