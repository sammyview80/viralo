import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { navigate, useSearchParams } from "@/lib/router";
import { videoApi, token as authToken, API_BASES, type VideoResponse } from "@/lib/api";
import { Pagination } from "../components/Pagination";
import { VirtualizedGrid, VirtualizedList } from "../components/VirtualizedCollection";

const VIDEO_SSE_BASE = API_BASES.video;

/* ─── helpers ─── */

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

function formatMs(ms: number | null) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function formatShortDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isTerminalStatus(v: VideoResponse) {
  return v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";
}

function statusLabel(v: VideoResponse) {
  if (v.status === "failed") return "Failed";
  if (isTerminalStatus(v)) return "Ready";
  return v.pipeline_step ? v.pipeline_step.replace(/_/g, " ") : "Processing";
}

function progressFor(video: VideoResponse) {
  if (video.status === "failed") return 100;
  if (isTerminalStatus(video)) return 100;
  const raw = Number(video.pipeline_pct ?? 0);
  if (!Number.isFinite(raw)) return 8;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(8, Math.min(96, Math.round(pct)));
}

/* ─── components ─── */

function DeleteModal({ video, onConfirm, onCancel }: { video: VideoResponse; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[20px] border border-white/[.09] bg-[#111724] p-6 shadow-[0_28px_90px_rgba(0,0,0,.45)]">
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-[14px] border border-red-400/20 bg-red-400/10 text-red-300">⌫</div>
        <h3 className="font-display text-xl font-bold text-white">Delete project?</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          This removes "{video.title || "Untitled"}" from project history. Generated clips for this video may no longer be accessible.
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 rounded-[11px] border border-white/[.08] bg-white/[.03] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/[.06] hover:text-white">Cancel</button>
          <button onClick={onConfirm} className="flex-1 rounded-[11px] bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-400">Delete</button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ video }: { video: VideoResponse }) {
  const ready = isTerminalStatus(video) && video.status !== "failed";
  const failed = video.status === "failed";
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize",
      ready ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-300"
      : failed ? "border-red-300/20 bg-red-400/10 text-red-300"
      : "border-amber-300/20 bg-amber-400/10 text-amber-200"
    )}>
      {statusLabel(video)}
    </span>
  );
}

function SourcePill({ source }: { source: string }) {
  const isYoutube = source === "youtube" || source === "youtube_url";
  const isRanking = source === "ranking";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
      isYoutube ? "border-red-400/25 bg-red-500/10 text-red-300"
      : isRanking ? "border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a]"
      : "border-sky-300/20 bg-sky-400/10 text-sky-200"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", isYoutube ? "bg-red-400" : isRanking ? "bg-[#ff3d6a]" : "bg-sky-300")} />
      {isYoutube ? "YouTube" : isRanking ? "Ranking" : "Upload"}
    </span>
  );
}

function ProjectThumb({ video, className = "" }: { video: VideoResponse; className?: string }) {
  const processing = !isTerminalStatus(video);
  return (
    <div className={cn("relative overflow-hidden rounded-[16px] border border-white/[.08] bg-gradient-to-br shadow-[inset_0_0_0_1px_rgba(255,255,255,.05)]", gradFromId(video.id), className)}>
      {video.thumbnail_url ? (
        <img src={video.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[.08] via-transparent to-black/25" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
      <div className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-[11px] bg-black/45 text-white shadow-lg backdrop-blur-md">
        {processing ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent" /> : "▶"}
      </div>
      <div className="absolute bottom-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
        {formatDuration(video.duration_sec)}
      </div>
    </div>
  );
}

function RowMenu({ onShowDetails, onDelete }: { onShowDetails: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((v) => !v);
  }

  return (
    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="grid h-8 w-8 place-items-center rounded-[8px] text-zinc-600 transition hover:bg-white/[.06] hover:text-zinc-300"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
          className="min-w-[160px] overflow-hidden rounded-[12px] border border-white/[.08] bg-[#111724] py-1 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
        >
          <button
            onClick={() => { setOpen(false); onShowDetails(); }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-zinc-300 transition hover:bg-white/[.05] hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Show details
          </button>
          <div className="mx-3 my-1 h-px bg-white/[.06]" />
          <button
            onClick={() => { setOpen(false); onDelete(); }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-red-400 transition hover:bg-red-400/10 hover:text-red-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ─── Main page ─── */

type SortMode = "newest" | "oldest" | "title" | "status";
type ViewMode = "grid" | "list";

export function ProjectsPage() {
  const [history, setHistory] = useState<VideoResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParam] = useSearchParams();
  const tabQuery = searchParams.get("tab");
  const tab = tabQuery === "ranking" ? "ranking" : "clipping";

  const setTab = (t: "clipping" | "ranking") => {
    setSearchParam("tab", t);
    setSearch("");
    setSelectedId(null);
    setPage(1);
  };
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "processing" | "failed">("all");
  const [page, setPage] = useState(1);
  const [totalProjects, setTotalProjects] = useState(0);
  const perPage = 5;

  const loadHistory = useCallback(() => {
    setLoading(true);
    setError("");
    const apiFn = tab === "ranking" ? videoApi.listRanking : videoApi.listClipping;
    apiFn(page, perPage)
      .then((res) => {
        setHistory(res.items);
        setTotalProjects(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load projects"))
      .finally(() => setLoading(false));
  }, [page, tab]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  /* SSE subscriptions for in-progress videos — replaces 3s polling */
  const sseRef = useRef<Map<string, EventSource>>(new Map());
  useEffect(() => {
    const inProgress = history.filter((v) => !isTerminalStatus(v) && v.celery_task_id);
    const activeIds = new Set(inProgress.map((v) => v.celery_task_id!));

    for (const [tid, es] of sseRef.current) {
      if (!activeIds.has(tid)) { es.close(); sseRef.current.delete(tid); }
    }

    const t = authToken.get() || "";
    if (!t) return;

    for (const video of inProgress) {
      const tid = video.celery_task_id!;
      if (sseRef.current.has(tid)) continue;
      const es = new EventSource(`${VIDEO_SSE_BASE}/progress/${tid}?token=${encodeURIComponent(t)}`);
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "keepalive") return;
          if (d.pct != null || d.step != null || d.status != null) {
            setHistory((prev) => prev.map((v) =>
              v.id === video.id
                ? { ...v, pipeline_pct: d.pct ?? v.pipeline_pct, pipeline_step: d.step ?? v.pipeline_step,
                    status: d.status === "complete" ? "ready" : d.status === "failed" ? "failed" : v.status }
                : v
            ));
          }
          if (d.status === "complete" || d.status === "failed") {
            es.close(); sseRef.current.delete(tid);
            videoApi.get(video.id).then((u) =>
              setHistory((prev) => prev.map((v) => v.id === u.id ? u : v))
            ).catch(() => {});
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); sseRef.current.delete(tid); };
      sseRef.current.set(tid, es);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useMemo(() => history.map((v) => `${v.id}:${v.status}:${v.celery_task_id}`).join(","), [history])]);

  useEffect(() => () => { for (const es of sseRef.current.values()) es.close(); sseRef.current.clear(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return history.filter((video) => {
      if (!term) return true;
      const haystack = [video.title ?? "Untitled", video.source_type, statusLabel(video), video.pipeline_step ?? ""].join(" ").toLowerCase();
      return haystack.includes(term);
    }).sort((a, b) => {
      if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === "title") return (a.title ?? "Untitled").localeCompare(b.title ?? "Untitled");
      if (sort === "status") return statusLabel(a).localeCompare(statusLabel(b));
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [history, search, sort, tab]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return filtered.find((v) => v.id === selectedId) ?? history.find((v) => v.id === selectedId) ?? null;
  }, [filtered, history, selectedId]);

  const readyCount = filtered.filter((v) => isTerminalStatus(v) && v.status !== "failed").length;
  const processingCount = filtered.filter((v) => !isTerminalStatus(v)).length;
  const failedCount = filtered.filter((v) => v.status === "failed").length;
  const total = filtered.length;

  const displayFiltered = useMemo(() => {
    if (statusFilter === "ready") return filtered.filter((v) => isTerminalStatus(v) && v.status !== "failed");
    if (statusFilter === "processing") return filtered.filter((v) => !isTerminalStatus(v));
    if (statusFilter === "failed") return filtered.filter((v) => v.status === "failed");
    return filtered;
  }, [filtered, statusFilter]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const video = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(video.id);
    try {
      await videoApi.delete(video.id);
      setHistory((prev) => prev.filter((v) => v.id !== video.id));
      setSelectedId((current) => current === video.id ? null : current);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete project");
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget]);

  return (
    <>
      {deleteTarget && <DeleteModal video={deleteTarget} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />}

      <div className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden bg-[#080b12]">
        {/* Header */}
        <div className="flex flex-col border-b border-white/[.05]">
          {/* Tabs + Filtering + New upload */}
          <div className="">
            <div className="mx-auto flex w-full max-w-[1240px] flex-col items-stretch justify-between gap-4 px-3 sm:px-4 py-1 lg:flex-row lg:items-center xl:px-5">
              {/* Noticeable tabs */}
              <div className="flex gap-8">
                {(["clipping", "ranking"] as const).map((t) => {
                  const active = tab === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "relative py-3.5 text-[14px] font-bold tracking-tight transition-all focus:outline-none flex items-center gap-2",
                        active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      {t === "clipping" ? (
                        <>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
                          </svg>
                          <span>Clips</span>
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 21h18M5 17V9M10 17V5M15 17v-7M20 17v-5" />
                          </svg>
                          <span>Video Ranking</span>
                        </>
                      )}
                      {active && (
                        <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-t-full bg-[#ff3d6a] shadow-[0_-2px_10px_rgba(255,61,106,0.6)]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Filtering / Search panel */}
              <div className="flex flex-wrap items-center gap-3 pb-3 lg:pb-0">
                <div className="relative min-w-0 flex-1 sm:max-w-[320px] lg:w-[240px]">
                  <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input className="h-9 w-full rounded-[9px] border border-white/[.07] bg-white/[.03] pl-9 pr-8 text-xs text-zinc-100 placeholder:text-zinc-600 transition focus:border-[#ff3d6a]/30 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20" placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition hover:text-zinc-300"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12"/></svg></button>}
                </div>

                <div className="flex rounded-[9px] border border-white/[.07] bg-white/[.02] p-0.5">
                  {(["grid", "list"] as const).map((v) => (
                    <button key={v} onClick={() => setViewMode(v)} className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition", viewMode === v ? "bg-white/[.07] text-white" : "text-zinc-500 hover:text-zinc-300")}>{v}</button>
                  ))}
                </div>

                <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="h-9 rounded-[9px] border border-white/[.07] bg-white/[.02] px-2.5 text-[11px] font-semibold text-zinc-400 transition focus:outline-none cursor-pointer">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title">Title A-Z</option>
                  <option value="status">Status</option>
                </select>

                <button
                  onClick={loadHistory}
                  className="flex h-9 items-center gap-1.5 rounded-[9px] border border-white/[.07] bg-white/[.02] px-3 text-xs font-semibold text-zinc-400 transition hover:bg-white/[.05] hover:text-zinc-200"
                >
                  <svg className={cn("h-3.5 w-3.5", loading ? "animate-spin" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
                <button onClick={() => navigate("/studio")} className="h-9 rounded-[9px] bg-[#ff3d6a] px-3.5 text-xs font-bold text-white shadow-[0_6px_18px_rgba(255,61,106,.25)] transition hover:bg-[#e8304f] whitespace-nowrap">+ New upload</button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-400/20 bg-red-400/[.07] px-5 py-3 text-sm font-medium text-red-300">{error}</div>
        )}

        {/* Body */}
        <div className={cn("mx-auto grid w-full max-w-[1240px] flex-1", selected ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")} style={{ alignItems: "start" }}>
            <div className="min-w-0 p-3 sm:p-4 xl:p-5">
              {/* Stats */}
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  { key: "ready", label: "Ready", count: readyCount, sub: total > 0 ? `of ${total}` : null, subColor: "text-zinc-600", numColor: "text-emerald-300", iconBg: "bg-emerald-400/10 text-emerald-300", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
                  { key: "processing", label: "Processing", count: processingCount, sub: processingCount > 0 ? "in progress" : null, subColor: "text-amber-400/60", numColor: "text-amber-200", iconBg: "bg-amber-400/10 text-amber-200", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
                  { key: "failed", label: "Failed", count: failedCount, sub: failedCount === 0 ? "none" : null, subColor: "text-zinc-600", numColor: "text-red-300", iconBg: "bg-red-400/10 text-red-300", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> },
                ] as const).map(({ key, label, count, sub, subColor, numColor, iconBg, icon }) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter((f) => f === key ? "all" : key)}
                    className={cn("flex items-center gap-4 rounded-[16px] border px-4 py-3.5 text-left transition cursor-pointer", statusFilter === key ? "border-white/[.12] bg-white/[.035]" : "border-white/[.06] bg-white/[.018] hover:bg-white/[.025]")}
                  >
                    <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", iconBg)}>{icon}</div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600">{label}</div>
                      <div className="mt-0.5 flex items-baseline gap-1.5">
                        <span className={cn("text-2xl font-bold", numColor)}>{count}</span>
                        {sub && <span className={cn("text-[11px]", subColor)}>{sub}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="grid gap-3">
                  {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-[14px] border border-white/[.06] bg-white/[.025]" />)}
                </div>
              ) : displayFiltered.length === 0 ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[20px] border border-dashed border-white/[.09] bg-white/[.015] p-8 text-center">
                  <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-2xl text-[#ff7a9a]">↥</div>
                  <h3 className="mt-4 font-display text-xl font-bold text-white">{history.length === 0 ? "No projects yet" : "No projects match"}</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{history.length === 0 ? tab === "ranking" ? "Create your first ranked countdown video from the Rankings page." : "Upload a video or import from YouTube to create your first clipping project." : "Try a different search term or clear the search field."}</p>
                  <button onClick={() => navigate("/studio")} className="mt-5 rounded-[12px] bg-[#ff3d6a] px-5 py-2.5 text-sm font-bold text-white">Start upload</button>
                </div>
              ) : viewMode === "grid" ? (
                <VirtualizedGrid
                  items={displayFiltered}
                  keyForItem={(v) => v.id}
                  estimateRowHeight={310}
                  columns={[{ minWidth: 768, columns: 2 }, { minWidth: 1536, columns: 3 }]}
                  renderItem={(video) => {
                    const isDeleting = deletingId === video.id;
                    const active = selected?.id === video.id;
                    const pct = progressFor(video);
                    return (
                      <div className={cn(
                        "group overflow-hidden rounded-[20px] border bg-[#111827]",
                        active ? "border-[#ff3d6a]/55 shadow-[0_0_0_1px_rgba(255,61,106,.12)]" : "border-white/[.07]",
                        isDeleting ? "pointer-events-none opacity-50" : ""
                      )}>
                        <button onClick={() => setSelectedId(video.id)} className="w-full text-left">
                          <ProjectThumb video={video} className="aspect-video rounded-b-none border-0" />
                        </button>
                        <div className="p-4">
                          <div className="flex items-start gap-3">
                            <h3 className="min-w-0 flex-1 line-clamp-2 font-display text-[18px] font-bold leading-tight tracking-[-.02em] text-white">{video.title || "Untitled"}</h3>
                            <StatusBadge video={video} />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <SourcePill source={video.source_type} />
                            <span className="rounded-full bg-white/[.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">{formatShortDate(video.created_at)}</span>
                            <span className="rounded-full bg-white/[.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">{formatDuration(video.duration_sec)}</span>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
                            <div className={cn("h-full rounded-full", video.status === "failed" ? "bg-red-400" : "bg-emerald-400")} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="mt-3 flex items-center justify-between border-t border-white/[.06] pt-3">
                            <button onClick={() => setSelectedId(video.id)} className="text-[11px] text-zinc-600 transition hover:text-zinc-400">Details</button>
                            <button onClick={() => navigate(`/projects/${video.id}`)} className="text-xs font-bold text-zinc-500 transition hover:text-white">Show clips →</button>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
              ) : (
                <div className="">
                  <VirtualizedList
                    items={displayFiltered}
                    keyForItem={(v) => v.id}
                    estimateRowHeight={88}
                    renderItem={(video) => {
                      const active = selected?.id === video.id;
                      const isDeleting = deletingId === video.id;
                      const pct = progressFor(video);
                      const isReady = isTerminalStatus(video) && video.status !== "failed";
                      const isFailed = video.status === "failed";
                      return (
                        <div
                          className={cn(
                            "group relative border-l-[3px] border-t border-white/[.04] transition",
                            active ? "border-l-[#ff3d6a]/70 bg-[#ff3d6a]/[.035]" : "border-l-transparent hover:bg-white/[.02]",
                            isDeleting ? "pointer-events-none opacity-50" : "",
                          )}
                        >
                          <button
                            onClick={() => navigate(`/projects/${video.id}`)}
                            className="flex w-full items-start gap-3 px-3 py-3.5 pr-10 text-left sm:items-center sm:gap-4 sm:px-4 sm:pr-12"
                          >
                            <ProjectThumb video={video} className="h-14 w-20 shrink-0 rounded-[10px]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-[14px] font-semibold text-white">{video.title || "Untitled"}</p>
                                <StatusBadge video={video} />
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                                <span>{video.source_type === "youtube" || video.source_type === "youtube_url" ? "YouTube" : "Upload"}</span>
                                <span className="text-zinc-700">·</span>
                                <span>{formatDuration(video.duration_sec)}</span>
                                <span className="text-zinc-700">·</span>
                                <span>{formatShortDate(video.created_at)}</span>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <div className="h-1 w-16 overflow-hidden rounded-full bg-white/[.06] sm:w-24">
                                  <div className={cn("h-full rounded-full", isFailed ? "bg-red-400" : isReady ? "bg-emerald-400" : "bg-amber-300")} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={cn("text-[10px] font-bold", isFailed ? "text-red-400" : isReady ? "text-emerald-400" : "text-amber-300")}>{pct}%</span>
                              </div>
                            </div>
                            <span className="hidden shrink-0 text-xs font-semibold text-zinc-600 transition group-hover:text-zinc-300 sm:block">Show clips →</span>
                          </button>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <RowMenu
                              onShowDetails={() => setSelectedId(video.id)}
                              onDelete={() => setDeleteTarget(video)}
                            />
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              )}
              <Pagination
                page={page}
                perPage={perPage}
                total={totalProjects}
                itemLabel="projects"
                onPageChange={(next) => {
                  setPage(next);
                  setSelectedId(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="mt-4 rounded-[14px] border border-white/[.06] bg-white/[.012]"
              />
            </div>

            {/* Details sidebar */}
            {selected && (
              <aside className="hidden border-l border-white/[.07] bg-[#0e1420] xl:flex xl:flex-col" style={{ position: "sticky", top: 0, height: "calc(100vh - 180px)", overflowY: "auto" }}>
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-500">Project details</span>
                    <button onClick={() => setSelectedId(null)} className="grid h-7 w-7 place-items-center rounded-[7px] text-zinc-600 transition hover:bg-white/[.06] hover:text-zinc-300">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>

                  <ProjectThumb video={selected} className="aspect-video rounded-[20px]" />

                  <div className="mt-5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-[22px] font-bold leading-tight tracking-[-.03em] text-white">{selected.title || "Untitled"}</h2>
                      <p className="mt-1.5 text-sm text-zinc-500">{selected.source_type === "youtube" || selected.source_type === "youtube_url" ? "YouTube import" : "Uploaded video"}</p>
                    </div>
                    <StatusBadge video={selected} />
                  </div>

                  {/* Core info */}
                  <div className="mt-5 grid grid-cols-2 gap-2.5">
                    {[
                      { label: "Duration", value: formatDuration(selected.duration_sec) },
                      { label: "Created", value: formatShortDate(selected.created_at) },
                      { label: "Source", value: selected.source_type === "youtube" || selected.source_type === "youtube_url" ? "YouTube" : "Upload" },
                      { label: "Pipeline", value: selected.pipeline_step ? selected.pipeline_step.replace(/_/g, " ") : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-[12px] border border-white/[.06] bg-white/[.025] p-3.5">
                        <div className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600">{label}</div>
                        <div className="mt-1.5 text-base font-bold capitalize text-white">{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Progress */}
                  <div className="mt-3 rounded-[12px] border border-white/[.06] bg-white/[.02] p-3.5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600">Progress</div>
                      <div className={cn("font-mono text-xs font-bold", selected.status === "failed" ? "text-red-300" : "text-emerald-300")}>{progressFor(selected)}%</div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[.06]">
                      <div className={cn("h-full rounded-full transition-all", selected.status === "failed" ? "bg-red-400" : "bg-emerald-400")} style={{ width: `${progressFor(selected)}%` }} />
                    </div>
                  </div>

                  {/* Clip config */}
                  {selected.clip_config && (
                    <div className="mt-3 rounded-[12px] border border-white/[.06] bg-white/[.02] p-3.5">
                      <div className="mb-3 text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600">Clip config</div>
                      <div className="space-y-2 text-[12px]">
                        {selected.clip_config.aspect_ratio && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Aspect ratio</span>
                            <span className="font-semibold text-zinc-300">{selected.clip_config.aspect_ratio}</span>
                          </div>
                        )}
                        {(selected.clip_config.duration_min != null || selected.clip_config.duration_max != null) && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Duration</span>
                            <span className="font-semibold text-zinc-300">{selected.clip_config.duration_min ?? "—"}–{selected.clip_config.duration_max ?? "—"}s</span>
                          </div>
                        )}
                        {selected.clip_config.max_clips != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Max clips</span>
                            <span className="font-semibold text-zinc-300">{selected.clip_config.max_clips}</span>
                          </div>
                        )}
                        {selected.clip_config.add_captions != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Captions</span>
                            <span className={cn("font-semibold", selected.clip_config.add_captions ? "text-emerald-400" : "text-zinc-500")}>
                              {selected.clip_config.add_captions ? "On" : "Off"}
                              {selected.clip_config.caption_style ? ` · ${selected.clip_config.caption_style}` : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="sticky bottom-0 -mx-5 mt-5 border-t border-white/[.07] bg-[#0e1420]/95 p-5 backdrop-blur">
                    <button onClick={() => navigate(`/projects/${selected.id}`)} className="h-12 w-full rounded-[12px] bg-[#ff3d6a] text-sm font-bold text-white shadow-[0_14px_34px_rgba(255,61,106,.22)] transition hover:bg-[#e8304f]">Show clips</button>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <button onClick={() => navigate(`/projects/${selected.id}`)} className="h-11 rounded-[12px] border border-white/[.08] bg-white/[.025] text-sm font-bold text-zinc-300 transition hover:bg-white/[.05] hover:text-white">Edit project</button>
                      <button onClick={() => setDeleteTarget(selected)} className="h-11 rounded-[12px] border border-white/[.08] bg-white/[.025] text-sm font-bold text-zinc-500 transition hover:border-red-400/25 hover:bg-red-400/10 hover:text-red-300">Delete</button>
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
      </div>
    </>
  );
}
