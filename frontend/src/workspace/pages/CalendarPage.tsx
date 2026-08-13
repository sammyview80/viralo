import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { platformApi, type SocialAccount, type ScheduledPost, type CalendarDay } from "@/lib/api";
import { datetimeLocalToUtcIso, defaultDatetimeLocalPlusMs } from "@/lib/datetimeLocal";
import { Pagination } from "../components/Pagination";
import { useSearchParams } from "@/lib/router";

/* ─── Constants ─── */
const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  instagram: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  youtube: "bg-red-500/20 text-red-300 border-red-500/30",
  twitter: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  linkedin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  facebook: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
};

const PLATFORM_DOT: Record<string, string> = {
  tiktok: "bg-rose-400",
  instagram: "bg-purple-400",
  youtube: "bg-red-400",
  twitter: "bg-sky-400",
  linkedin: "bg-blue-400",
  facebook: "bg-indigo-400",
};

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "linkedin", "facebook"];
const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
};

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-500/20 text-amber-300 border-amber-500/30",
  scheduled:  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  processing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  posted:     "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  failed:     "bg-red-500/20 text-red-300 border-red-500/30",
  cancelled:  "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
};

// Calendar pill colors keyed by status (more vivid than badge colors)
const PILL_COLORS: Record<string, string> = {
  scheduled:  "bg-blue-500/15 border-blue-500/25 text-blue-300",
  pending:    "bg-amber-500/15 border-amber-500/25 text-amber-300",
  processing: "bg-amber-500/20 border-amber-400/40 text-amber-200",
  posted:     "bg-emerald-500/15 border-emerald-500/25 text-emerald-300",
  failed:     "bg-red-500/20 border-red-500/40 text-red-300",
  cancelled:  "bg-zinc-700/30 border-zinc-600/20 text-zinc-600",
};

const STATUS_ICON: Record<string, string> = {
  scheduled:  "○",
  pending:    "◷",
  processing: "◌",
  posted:     "✓",
  failed:     "✕",
  cancelled:  "—",
};

const PLATFORM_ABBR: Record<string, string> = {
  tiktok: "TT",
  instagram: "IG",
  youtube: "YT",
  twitter: "X",
  linkedin: "IN",
  facebook: "FB",
};

// Calendar pill colors — platform-keyed, dark maroon style matching design
const CAL_PILL: Record<string, { pill: string; badge: string }> = {
  tiktok:    { pill: "bg-rose-950/70 border-rose-800/40 text-rose-300",    badge: "bg-rose-900/80 text-rose-200" },
  instagram: { pill: "bg-pink-950/70 border-pink-800/40 text-pink-300",    badge: "bg-pink-900/80 text-pink-200" },
  youtube:   { pill: "bg-red-950/70 border-red-800/40 text-red-300",       badge: "bg-red-900/80 text-red-200" },
  twitter:   { pill: "bg-zinc-900/80 border-zinc-700/40 text-zinc-300",    badge: "bg-zinc-800/80 text-zinc-200" },
  linkedin:  { pill: "bg-blue-950/70 border-blue-800/40 text-blue-300",    badge: "bg-blue-900/80 text-blue-200" },
  facebook:  { pill: "bg-indigo-950/70 border-indigo-800/40 text-indigo-300", badge: "bg-indigo-900/80 text-indigo-200" },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYMD(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function fmtLocal(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/* ─── Day Drawer (Google Calendar-style time grid) ─── */
const HOUR_HEIGHT = 128;     // px per hour — each half-hour slot = 64px
const CARD_H = 56;           // fixed card height
const CARD_CANCELLED_H = 22; // compact cancelled card
const MAX_COLS = 3;          // max side-by-side before overflow chip
const CARD_PAD = 4;          // px gap above card within slot
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => i + DAY_START_HOUR);

function fmtHour(h: number) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// Left-bar accent colors per status (Google Calendar style — no heavy bg fill)
const ACCENT_BAR: Record<string, string> = {
  scheduled:  "border-l-blue-400",
  pending:    "border-l-amber-400",
  processing: "border-l-amber-300",
  posted:     "border-l-emerald-400",
  failed:     "border-l-red-500",
  cancelled:  "border-l-zinc-600",
};
const ACCENT_BG: Record<string, string> = {
  scheduled:  "bg-blue-500/[.14]",
  pending:    "bg-amber-500/[.14]",
  processing: "bg-amber-400/[.18]",
  posted:     "bg-emerald-500/[.14]",
  failed:     "bg-red-500/[.20]",
  cancelled:  "bg-zinc-700/[.10]",
};
const ACCENT_TEXT: Record<string, string> = {
  scheduled:  "text-blue-300",
  pending:    "text-amber-300",
  processing: "text-amber-200",
  posted:     "text-emerald-300",
  failed:     "text-red-300",
  cancelled:  "text-zinc-600",
};

function DayDrawer({
  date, posts, onClose, onSelect, onStatusClick,
}: {
  date: string;
  posts: ScheduledPost[];
  onClose: () => void;
  onSelect: (p: ScheduledPost) => void;
  onStatusClick?: (status: string) => void;
}) {
  const [overflow, setOverflow] = useState<{ key: string; list: ScheduledPost[] } | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Drag-resize state
  const modalRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startY: 0, startH: 0 });
  const [customHeight, setCustomHeight] = useState<number | null>(null);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const currentH = modalRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.85;
    dragRef.current = { active: true, startY: e.clientY, startH: currentH };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current.active) return;
      const delta = ev.clientY - dragRef.current.startY;
      const newH = Math.min(Math.max(dragRef.current.startH - delta, 300), window.innerHeight - 40);
      setCustomHeight(newH);
    };
    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const label = new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const grouped = useMemo(() => {
    const g: Record<string, ScheduledPost[]> = {};
    for (const p of posts) (g[p.status] = g[p.status] ?? []).push(p);
    return g;
  }, [posts]);

  const statusOrder = ["processing", "pending", "scheduled", "failed", "posted", "cancelled"];

  // Bucket posts into 30-min slots
  const bySlot = useMemo(() => {
    const s: Record<string, ScheduledPost[]> = {};
    for (const p of posts) {
      const d = new Date(p.scheduled_at);
      const hr = d.getHours();
      const half = d.getMinutes() < 30 ? 0 : 30;
      const key = `${hr}:${half}`;
      (s[key] = s[key] ?? []).push(p);
    }
    return s;
  }, [posts]);

  const totalGridHeight = HOURS.length * HOUR_HEIGHT;

  const firstPostHour = posts.length
    ? Math.min(...posts.map((p) => new Date(p.scheduled_at).getHours()))
    : new Date().getHours();

  const gridScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gridScrollRef.current) return;
    gridScrollRef.current.scrollTop = Math.max(0, firstPostHour * HOUR_HEIGHT - HOUR_HEIGHT);
  }, [firstPostHour]);

  const isToday = new Date(date + "T12:00:00").toDateString() === new Date().toDateString();

  const modalCls = expanded
    ? "fixed inset-x-0 top-0 bottom-[max(env(safe-area-inset-bottom),4rem)] z-10 flex flex-col bg-surface-0 shadow-2xl sm:bottom-0"
    : cn(
        "relative z-10 flex flex-col w-full max-w-4xl rounded-t-[20px] sm:rounded-[18px]",
        "border border-c-border bg-surface-0 shadow-2xl overflow-hidden transition-all duration-200"
      );

  const modalStyle = expanded
    ? {}
    : { height: customHeight ?? undefined, minHeight: customHeight ? undefined : undefined };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex overflow-hidden",
        expanded ? "" : "items-end justify-center pb-[max(env(safe-area-inset-bottom),4rem)] sm:items-center sm:pb-0"
      )}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        ref={modalRef}
        className={modalCls}
        style={{
          ...modalStyle,
          ...(expanded ? {} : { height: customHeight ?? "85vh", maxHeight: "95vh" }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Drag handle (top) ── */}
        {!expanded && (
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-16 flex justify-center pt-1.5 z-20 cursor-ns-resize"
            onPointerDown={onDragStart}
          >
            <div className="w-8 h-1 rounded-full bg-c-border hover:bg-c-border-hover transition" />
          </div>
        )}

        {/* ── Header ── */}
        <div className="shrink-0 flex items-center justify-between border-b border-c-border bg-surface-1 px-5 py-3.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-c-text-muted">Day View</p>
            <p className="text-[16px] font-bold text-c-text leading-tight mt-0.5">{label}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {statusOrder.filter((s) => grouped[s]?.length).map((s) => (
              <button
                key={s}
                onClick={() => { onClose(); onStatusClick?.(s); }}
                title={`View all ${s} posts`}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition",
                  "cursor-pointer hover:brightness-125",
                  PILL_COLORS[s] ?? "bg-zinc-500/15 border-zinc-500/25 text-zinc-400"
                )}
              >
                {STATUS_ICON[s]} {grouped[s].length}
              </button>
            ))}
            {/* Expand/collapse toggle */}
            <button
              onClick={() => { setExpanded((v) => !v); setCustomHeight(null); }}
              className="ml-1 rounded-lg p-1.5 text-c-text-muted hover:bg-surface-2 hover:text-c-text transition cursor-pointer"
              title={expanded ? "Collapse" : "Expand to full screen"}
            >
              {expanded ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                </svg>
              )}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-c-text-muted hover:bg-surface-2 hover:text-c-text transition cursor-pointer"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* ── Time grid ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-1 overflow-y-auto" ref={gridScrollRef}>

            {/* Time gutter — height matches dynamic hour heights */}
            <div className="w-10 shrink-0 select-none bg-surface-0 lg:w-[52px]">
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_HEIGHT }}
                  className="flex items-start justify-end pr-2 pt-1 lg:pr-3 lg:pt-1.5"
                >
                  <span className={cn(
                    "text-[8px] font-semibold tabular-nums whitespace-nowrap lg:text-[9px]",
                    isToday && h === new Date().getHours() ? "text-[#ff3d6a]" : "text-c-text-muted"
                  )}>
                    {fmtHour(h)}
                  </span>
                </div>
              ))}
            </div>

            {/* Events pane */}
            <div className="relative flex-1 border-l border-c-border" style={{ height: totalGridHeight }}>
              {/* Hour rows — fixed height */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ position: "absolute", top: h * HOUR_HEIGHT, left: 0, right: 0, height: HOUR_HEIGHT }}
                  className={cn(
                    "border-b border-c-border",
                    isToday && h === new Date().getHours() ? "bg-[#ff3d6a]/[.02]" : ""
                  )}
                >
                  {/* Half-hour tick */}
                  <div
                    className="absolute left-0 right-0 border-b border-dashed border-c-border"
                    style={{ top: HOUR_HEIGHT / 2 }}
                  />
                </div>
              ))}

              {/* Now line */}
              {isToday && (() => {
                const now = new Date();
                const y = (now.getHours() + now.getMinutes() / 60) * HOUR_HEIGHT;
                return (
                  <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: y }}>
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ff3d6a] shrink-0 -ml-[5px] shadow-[0_0_6px_rgba(255,61,106,.7)]" />
                    <div className="h-[1.5px] flex-1 bg-gradient-to-r from-[#ff3d6a]/80 to-[#ff3d6a]/10" />
                  </div>
                );
              })()}

              {/* Events per 30-min slot */}
              {Object.entries(bySlot).map(([slotKey, slotPosts]) => {
                const [hStr, mStr] = slotKey.split(":");
                const slotHour = parseInt(hStr);
                const slotMin = parseInt(mStr);
                // Top of this slot in the fixed grid
                const topPx = slotHour * HOUR_HEIGHT + (slotMin / 60) * HOUR_HEIGHT + CARD_PAD;
                // Max card height = half-hour slot minus padding — never overflows into next slot
                const maxCardH = HOUR_HEIGHT / 2 - CARD_PAD * 2;

                const sorted = [...slotPosts].sort((a, b) => {
                  const rank = (s: string) => s === "cancelled" ? 99 : s === "failed" ? 0 : 1;
                  return rank(a.status) - rank(b.status);
                });

                const visible = sorted.slice(0, MAX_COLS);
                const hidden = sorted.slice(MAX_COLS);
                // Total columns = visible cards + optional overflow chip
                const totalCols = visible.length + (hidden.length > 0 ? 1 : 0);
                const colPct = 100 / totalCols;

                return [
                  ...visible.map((post, idx) => {
                    const isCancelled = post.status === "cancelled";
                    const isPosted = post.status === "posted";
                    const isFailed = post.status === "failed";
                    const isProcessing = post.status === "processing";
                    const cardHeight = isCancelled ? CARD_CANCELLED_H : Math.min(CARD_H, maxCardH);
                    const time = new Date(post.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                    return (
                      <button
                        key={post.id}
                        onClick={() => { onSelect(post); onClose(); }}
                        style={{
                          top: topPx,
                          left: `calc(${idx * colPct}% + 3px)`,
                          width: `calc(${colPct}% - 5px)`,
                          height: cardHeight,
                        }}
                        title={`${post.caption || "No caption"} · ${post.status}`}
                        className={cn(
                          "absolute rounded-[6px] border-l-[3px] border border-c-border px-1.5 text-left overflow-hidden lg:px-2",
                          "transition-all duration-150 cursor-pointer hover:z-30",
                          "hover:brightness-110 hover:shadow-[0_4px_16px_rgba(0,0,0,.5)]",
                          ACCENT_BAR[post.status] ?? "border-l-zinc-600",
                          ACCENT_BG[post.status] ?? "bg-zinc-700/10",
                          isCancelled ? "opacity-35 flex items-center" : "flex flex-col justify-center gap-0.5",
                        )}
                      >
                        {isCancelled ? (
                          <p className="text-[10px] text-zinc-600 truncate leading-none">
                            <span className={cn("mr-1 h-1.5 w-1.5 rounded-full inline-block align-middle", PLATFORM_DOT[post.platform])} />
                            {time} · {post.caption || PLATFORM_LABELS[post.platform]}
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={cn("shrink-0 h-1.5 w-1.5 rounded-full lg:h-2 lg:w-2", PLATFORM_DOT[post.platform] ?? "bg-zinc-500")} />
                              <p className={cn("truncate text-[11px] font-semibold leading-tight flex-1 lg:text-[12px]", ACCENT_TEXT[post.status] ?? "text-zinc-300")}>
                                {post.caption || PLATFORM_LABELS[post.platform] || post.platform}
                              </p>
                              <span className={cn("shrink-0 text-[9px] font-bold mr-1 lg:text-[10px]", ACCENT_TEXT[post.status])}>
                                {STATUS_ICON[post.status]}
                              </span>
                            </div>
                            <p className="text-[10px] text-c-text-muted truncate lg:text-[11px]">
                              {PLATFORM_LABELS[post.platform] ?? post.platform} · {time}
                              {isPosted && post.posted_at && (
                                <span className="text-emerald-400 ml-1">
                                  → live {new Date(post.posted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                              {isFailed && post.last_error && (
                                <span className="text-red-400 ml-1">· {post.last_error.slice(0, 30)}…</span>
                              )}
                              {isProcessing && (
                                <span className="text-amber-400 animate-pulse ml-1">· publishing…</span>
                              )}
                            </p>
                          </>
                        )}
                      </button>
                    );
                  }),

                  hidden.length > 0 && (
                    <button
                      key={`${slotKey}-more`}
                      onClick={(e) => { e.stopPropagation(); setOverflow({ key: slotKey, list: hidden }); }}
                      style={{
                        top: topPx,
                        left: `calc(${visible.length * colPct}% + 3px)`,
                        width: `calc(${colPct}% - 5px)`,
                        height: Math.min(CARD_H, maxCardH),
                      }}
                      className="absolute rounded-[6px] border border-dashed border-c-border bg-surface-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:bg-surface-2 hover:border-c-border-hover transition z-10"
                    >
                      <span className="text-[13px] font-bold text-c-text-secondary">+{hidden.length}</span>
                      <span className="text-[9px] text-c-text-muted uppercase tracking-wide">more</span>
                    </button>
                  ),
                ].filter(Boolean);
              })}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-c-border bg-surface-1 px-5 py-2.5 flex items-center justify-between">
          <p className="text-[11px] text-c-text-muted">Click a post · drag top handle to resize</p>
          <button onClick={onClose} className="text-[11px] font-semibold text-c-text-muted hover:text-c-text transition cursor-pointer">Done</button>
        </div>

        {/* ── Overflow mini-list ── */}
        {overflow && (
          <div
            className="absolute inset-x-4 bottom-16 z-50 rounded-[14px] border border-c-border bg-surface-3 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-c-border">
              <p className="text-[11px] font-bold text-c-text-secondary">{overflow.list.length} more at this time</p>
              <button onClick={() => setOverflow(null)} className="text-c-text-muted hover:text-c-text-secondary transition cursor-pointer">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-c-border">
              {overflow.list.map((post) => (
                <button
                  key={post.id}
                  onClick={() => { onSelect(post); onClose(); setOverflow(null); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 transition cursor-pointer"
                >
                  <div className={cn("w-1 h-8 rounded-full shrink-0", ACCENT_BAR[post.status]?.replace("border-l-", "bg-") ?? "bg-zinc-600")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[12px] font-semibold truncate", ACCENT_TEXT[post.status] ?? "text-zinc-400")}>
                      {post.caption || PLATFORM_LABELS[post.platform] || "No caption"}
                    </p>
                    <p className="text-[10px] text-c-text-muted mt-0.5">
                      <span className={cn("mr-1 h-1.5 w-1.5 rounded-full inline-block align-middle", PLATFORM_DOT[post.platform])} />
                      {PLATFORM_LABELS[post.platform]} · {new Date(post.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className={cn("text-[10px] font-bold shrink-0 capitalize", ACCENT_TEXT[post.status])}>
                    {STATUS_ICON[post.status]} {post.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Popover ─── */
function PostPopover({ post, onClose, onCancelled, onPublished }: { post: ScheduledPost; onClose: () => void; onCancelled?: (id: string) => void; onPublished?: (updated: ScheduledPost) => void }) {
  const scheduledLocal = fmtLocal(post.scheduled_at);
  const postedLocal = post.posted_at ? fmtLocal(post.posted_at) : null;
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const isPosted = post.status === "posted";
  const isFailed = post.status === "failed";
  const canPublishNow = post.status === "scheduled" || post.status === "pending" || post.status === "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
      <div
        className="relative z-10 w-full max-w-[340px] rounded-[14px] border border-c-border bg-surface-2 p-4 shadow-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-3 top-3 rounded-md p-1 text-c-text-muted hover:text-c-text-secondary transition">✕</button>

        {(post.clip_storage_url || post.clip_thumbnail_url) && (
          <a
            href={post.clip_storage_url || post.clip_thumbnail_url || "#"}
            target="_blank"
            rel="noreferrer"
            className="group relative mb-3 block aspect-[9/16] max-h-[220px] w-full overflow-hidden rounded-[10px] bg-black"
          >
            {post.clip_storage_url ? (
              <video
                src={post.clip_storage_url}
                poster={post.clip_thumbnail_url ?? undefined}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <img src={post.clip_thumbnail_url!} alt="clip thumbnail" className="h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black opacity-0 transition group-hover:opacity-100">▶</span>
            </div>
          </a>
        )}

        <div className="flex items-start gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize", PLATFORM_COLORS[post.platform] ?? "bg-zinc-500/20 text-zinc-300 border-zinc-500/30")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", PLATFORM_DOT[post.platform])} />
            {PLATFORM_LABELS[post.platform] ?? post.platform}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_COLORS[post.status] ?? "bg-zinc-500/20 text-zinc-300 border-zinc-500/30")}>
            {post.status}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-c-text">
          {post.caption || <span className="text-c-text-muted">No caption</span>}
        </p>
        {post.hashtags?.length > 0 && (
          <p className="mt-2 text-xs text-[#ff3d6a]/80">{post.hashtags.map((h) => `#${h}`).join(" ")}</p>
        )}

        <div className="mt-4 space-y-2 rounded-[10px] border border-c-border bg-surface-3 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-c-text-muted">Scheduled</span>
            <span className="text-c-text-secondary">{scheduledLocal}</span>
          </div>
          {isPosted && postedLocal && (
            <div className="flex justify-between">
              <span className="text-c-text-muted">Published</span>
              <span className="text-emerald-400">{postedLocal}</span>
            </div>
          )}
          {isPosted && post.platform_post_id && (
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-c-text-muted">Post ID</span>
              <span className="truncate font-mono text-[10px] text-c-text-secondary">{post.platform_post_id}</span>
            </div>
          )}
          {isFailed && post.last_error && (
            <div className="mt-1 rounded-[7px] bg-red-500/10 px-2.5 py-2 text-red-400">
              <span className="font-semibold">Error: </span>{post.last_error}
            </div>
          )}
        </div>

        {isPosted && (
          <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[11.5px] font-semibold text-emerald-300">Published successfully</span>
          </div>
        )}
        {isFailed && (
          <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-red-400/20 bg-red-400/5 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="text-[11.5px] font-semibold text-red-400">Publish failed — check error above</span>
          </div>
        )}

        {canPublishNow && onPublished && (
          <button
            onClick={async () => {
              setPublishing(true);
              try {
                const updated = await platformApi.publishNow(post.id);
                onPublished(updated);
                onClose();
              } catch {
                setPublishing(false);
              }
            }}
            disabled={publishing}
            className="mt-3 w-full rounded-[9px] bg-[#ff3d6a] py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#e8304f] disabled:opacity-50"
          >
            {publishing ? "Queuing…" : "⚡ Publish Now"}
          </button>
        )}

        {(post.status === "scheduled" || post.status === "pending" || post.status === "failed") && onCancelled && (
          confirmCancel ? (
            <div className="mt-3 space-y-2">
              <p className="text-center text-[12px] text-c-text-secondary">Cancel this scheduled post?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmCancel(false)}
                  className="flex-1 rounded-[9px] border border-c-border bg-surface-3 py-2 text-[12.5px] font-semibold text-c-text-secondary transition hover:text-c-text"
                >
                  Keep it
                </button>
                <button
                  onClick={async () => {
                    setCancelling(true);
                    try {
                      await platformApi.cancelPost(post.id);
                      onCancelled(post.id);
                      onClose();
                    } catch {
                      setCancelling(false);
                      setConfirmCancel(false);
                    }
                  }}
                  disabled={cancelling}
                  className="flex-1 rounded-[9px] bg-red-500/80 py-2 text-[12.5px] font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  {cancelling ? "Cancelling…" : "Yes, cancel"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              className="mt-3 w-full rounded-[9px] border border-red-500/20 bg-red-500/5 py-2 text-[12.5px] font-semibold text-red-400 transition hover:bg-red-500/10"
            >
              Cancel scheduled post
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ─── Schedule Modal ─── */
function ScheduleModal({
  accounts,
  onClose,
  onSubmit,
}: {
  accounts: SocialAccount[];
  onClose: () => void;
  onSubmit: (data: { clip_id: string; social_account_id: string; platform: string; scheduled_at: string; caption: string; hashtags: string[]; platform_kwargs?: Record<string, unknown> }) => Promise<void>;
}) {
  const [clipId, setClipId] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState(() => defaultDatetimeLocalPlusMs(60 * 60 * 1000));
  const [caption, setCaption] = useState("");
  const [hashtagsRaw, setHashtagsRaw] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [ytDescription, setYtDescription] = useState("");
  const [ytTagsRaw, setYtTagsRaw] = useState("");
  const [ytMadeForKids, setYtMadeForKids] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedAcc = accounts.find((a) => a.id === accountId);
  const isYouTube = ["youtube", "shorts"].includes(selectedAcc?.platform?.toLowerCase() ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clipId.trim()) { setError("Clip ID is required"); return; }
    if (!accountId) { setError("Select a platform account"); return; }
    if (!scheduledAt) { setError("Schedule date & time is required"); return; }
    setError("");
    setSubmitting(true);
    try {
      const hashtags = hashtagsRaw.split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean);
      const acc = accounts.find((a) => a.id === accountId);
      const platform_kwargs: Record<string, unknown> | undefined = isYouTube ? {
        title: ytTitle.trim() || undefined,
        description: ytDescription.trim() || undefined,
        tags: ytTagsRaw.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
        made_for_kids: ytMadeForKids,
      } : undefined;
      await onSubmit({
        clip_id: clipId.trim(),
        social_account_id: accountId,
        platform: acc?.platform ?? "",
        scheduled_at: datetimeLocalToUtcIso(scheduledAt),
        caption,
        hashtags,
        platform_kwargs,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to schedule post");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-[9px] border border-c-border bg-surface-1 px-3 py-2 text-sm text-c-text placeholder:text-c-text-muted focus:border-[#ff3d6a]/40 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20 transition";
  const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-[.06em] text-c-text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        className="relative z-10 w-full max-w-md rounded-[16px] border border-c-border bg-surface-2 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">Schedule Post</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-c-text-muted hover:text-c-text-secondary transition" aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className={labelCls}>Clip ID</label>
            <input
              className={inputCls}
              placeholder="e.g. clip-abc123"
              value={clipId}
              onChange={(e) => setClipId(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>Platform Account</label>
            <select
              className={inputCls}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.length === 0 && <option value="">No accounts connected</option>}
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {PLATFORM_LABELS[acc.platform] ?? acc.platform} — {acc.platform_username ?? acc.platform}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Date &amp; Time</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>Caption</label>
            <textarea
              className={cn(inputCls, "min-h-[90px] resize-none")}
              placeholder="Write your caption..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>Hashtags (comma-separated)</label>
            <input
              className={inputCls}
              placeholder="viral, trending, fyp"
              value={hashtagsRaw}
              onChange={(e) => setHashtagsRaw(e.target.value)}
            />
          </div>

          {isYouTube && (
            <>
              <div>
                <label className={labelCls}>YouTube Title</label>
                <input
                  className={inputCls}
                  placeholder="Video title (defaults to caption)"
                  value={ytTitle}
                  onChange={(e) => setYtTitle(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <label className={labelCls}>YouTube Description</label>
                <textarea
                  className={cn(inputCls, "min-h-[80px] resize-none")}
                  placeholder="Video description (defaults to caption)"
                  value={ytDescription}
                  onChange={(e) => setYtDescription(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Tags (comma-separated)</label>
                <input
                  className={inputCls}
                  placeholder="funny, animals, trending"
                  value={ytTagsRaw}
                  onChange={(e) => setYtTagsRaw(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-[9px] border border-c-border bg-surface-1 px-3 py-2.5">
                <span className="text-sm text-c-text-secondary">Made for kids</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ytMadeForKids}
                  onClick={() => setYtMadeForKids((v) => !v)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none",
                    ytMadeForKids ? "bg-[#ff3d6a]" : "bg-surface-3"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
                      ytMadeForKids ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </>
          )}

          {error && (
            <p className="rounded-[8px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[#ff3d6a] hover:bg-[#e8304f] text-white"
              disabled={submitting}
            >
              {submitting ? "Scheduling…" : "Schedule Post"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Posts List View ─── */
const STATUS_FILTERS = [
  { id: "active", label: "Active", match: (s: string) => s === "scheduled" || s === "processing" || s === "pending" },
  { id: "scheduled", label: "Scheduled", match: (s: string) => s === "scheduled" || s === "pending" },
  { id: "processing", label: "Processing", match: (s: string) => s === "processing" },
  { id: "posted", label: "Posted", match: (s: string) => s === "posted" },
  { id: "failed", label: "Failed", match: (s: string) => s === "failed" },
  { id: "cancelled", label: "Cancelled", match: (s: string) => s === "cancelled" },
  { id: "all", label: "All", match: () => true },
];

function PostsListView({
  posts, onSelect, onCancelled, loading, initialStatusFilter,
}: {
  posts: ScheduledPost[];
  onSelect: (p: ScheduledPost) => void;
  onCancelled: (id: string) => void;
  loading: boolean;
  initialStatusFilter?: string;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter ?? "active");

  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const perPage = 20;

  const statusDef = STATUS_FILTERS.find((f) => f.id === statusFilter) ?? STATUS_FILTERS[0];
  const filtered = posts
    .filter((p) => {
      const mp = platformFilter === "all" || p.platform === platformFilter;
      const ms = statusDef.match(p.status);
      return mp && ms;
    })
    .sort((a, b) => {
      const diff = new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime();
      return sort === "newest" ? diff : -diff;
    });

  // Count per status for badges
  const counts = STATUS_FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f.id] = posts.filter((p) => f.match(p.status)).length;
    return acc;
  }, {});

  const usedPlatforms = Array.from(new Set(posts.map((p) => p.platform)));
  const pagedPosts = filtered.slice((page - 1) * perPage, page * perPage);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, platformFilter, sort]);

  if (loading) return (
    <div className="p-6 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-[10px] bg-surface-glass" />
      ))}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Filter bar */}
      <div className="flex flex-col gap-2 border-b border-c-border px-5 py-3">
        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-[11px] font-semibold capitalize transition",
                statusFilter === f.id
                  ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-300"
                  : "border-c-border bg-surface-1 text-c-text-muted hover:border-c-border-hover hover:text-c-text-secondary"
              )}
            >
              {f.label}
              {counts[f.id] > 0 && (
                <span className={cn(
                  "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                  statusFilter === f.id ? "bg-[#ff3d6a]/20 text-rose-300" : "bg-surface-2 text-c-text-muted"
                )}>
                  {counts[f.id]}
                </span>
              )}
            </button>
          ))}
          {/* Sort */}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}
              className="flex items-center gap-1 rounded-[7px] border border-c-border bg-surface-1 px-2.5 py-1 text-[11px] font-semibold text-c-text-muted hover:text-c-text-secondary transition"
            >
              {sort === "newest" ? "↓ Newest" : "↑ Oldest"}
            </button>
          </div>
        </div>
        {/* Platform chips — only show if >1 platform */}
        {usedPlatforms.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setPlatformFilter("all")}
              className={cn(
                "rounded-full border px-3 py-0.5 text-[11px] font-semibold transition",
                platformFilter === "all"
                  ? "border-c-border-hover bg-surface-2 text-c-text-secondary"
                  : "border-c-border bg-surface-1 text-c-text-muted hover:text-c-text-secondary"
              )}
            >
              All platforms
            </button>
            {usedPlatforms.map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-[11px] font-semibold capitalize transition",
                  platformFilter === p
                    ? "border-c-border-hover bg-surface-2 text-c-text-secondary"
                    : "border-c-border bg-surface-1 text-c-text-muted hover:text-c-text-secondary"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", PLATFORM_DOT[p] ?? "bg-zinc-500")} />
                {PLATFORM_LABELS[p] ?? p}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="text-3xl opacity-20">📭</div>
          <p className="text-sm font-semibold text-c-text-secondary">No posts found</p>
          <p className="text-xs text-c-text-muted">Try a different filter or schedule a post.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {pagedPosts.map((post) => {
            const isPosted = post.status === "posted";
            const isFailed = post.status === "failed";
            const isProcessing = post.status === "processing";
            const canCancel = post.status === "scheduled" || post.status === "pending" || post.status === "processing";
            return (
              <button key={post.id} onClick={() => onSelect(post)}
                className="flex w-full items-center gap-4 rounded-[10px] border border-c-border bg-surface-1 px-4 py-3 text-left transition hover:border-c-border-hover hover:bg-surface-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", PLATFORM_DOT[post.platform] ?? "bg-zinc-500")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 sm:justify-start">
                    <span className="text-[13px] font-semibold text-c-text truncate">
                      {post.caption || <span className="text-c-text-muted">No caption</span>}
                    </span>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_COLORS[post.status] ?? "bg-zinc-500/20 text-zinc-300 border-zinc-500/30")}>
                      {isProcessing ? "⟳ Processing" : post.status}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-c-text-muted">
                    <span>{PLATFORM_LABELS[post.platform] ?? post.platform}</span>
                    <span>·</span>
                    <span>Scheduled {fmtLocal(post.scheduled_at)}</span>
                    {isPosted && post.posted_at && <><span>·</span><span className="text-emerald-400">Published {fmtLocal(post.posted_at)}</span></>}
                    {isFailed && post.last_error && <><span>·</span><span className="text-red-400 truncate max-w-[240px]" title={post.last_error}>{post.last_error}</span></>}
                  </div>
                </div>
                {isPosted && <span className="shrink-0 text-emerald-400 text-sm">✓</span>}
                {isFailed && <span className="shrink-0 text-red-400 text-sm">✕</span>}
                {isProcessing && <span className="shrink-0 text-amber-400 text-xs animate-pulse">●</span>}
                {canCancel && (
                  confirmingId === post.id ? (
                    <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="rounded-[7px] border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-c-text-secondary hover:text-c-text"
                      >Keep</button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setCancelling(post.id);
                          setConfirmingId(null);
                          try {
                            await platformApi.cancelPost(post.id);
                            onCancelled(post.id);
                          } finally {
                            setCancelling(null);
                          }
                        }}
                        disabled={cancelling === post.id}
                        className="rounded-[7px] bg-red-500/80 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                      >{cancelling === post.id ? "…" : "Confirm"}</button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmingId(post.id); }}
                      className="shrink-0 rounded-[7px] border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-[11px] font-semibold text-red-400 transition hover:bg-red-500/10"
                    >Cancel</button>
                  )
                )}
              </button>
            );
          })}
          <Pagination
            page={page}
            perPage={perPage}
            total={filtered.length}
            itemLabel="posts"
            onPageChange={setPage}
            className="mt-3 rounded-[10px] border border-c-border bg-surface-1"
          />
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export function CalendarPage() {
  const now = new Date();

  // URL-backed view state
  const [params, setParam] = useSearchParams();

  const activeTab = (params.get("tab") === "posts" ? "posts" : "calendar") as "calendar" | "posts";
  const setActiveTab = (t: "calendar" | "posts") => setParam("tab", t);

  const monthParam = params.get("month");
  const parsedMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? { year: parseInt(monthParam.slice(0, 4)), month: parseInt(monthParam.slice(5, 7)) - 1 }
    : { year: now.getFullYear(), month: now.getMonth() };
  const year = parsedMonth.year;
  const month = parsedMonth.month;
  const setYearMonth = (y: number, m: number) => setParam("month", `${y}-${pad(m + 1)}`);

  const platformFilter = params.get("platform") ?? "all";
  const setPlatformFilter = (v: string) => setParam("platform", v);

  const statusFilter = params.get("status") ?? "all";
  const setStatusFilter = (v: string) => setParam("status", v);

  // Posts tab uses same ?status param; default "active" when not set
  const postsListFilter = params.get("status") ?? "active";
  const setPostsListFilter = (v: string) => setParam("status", v);

  const [calendarData, setCalendarData] = useState<CalendarDay[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const monthKey = `${year}-${pad(month + 1)}`;

  async function loadData() {
    setLoading(true);
    try {
      const [cal, accs] = await Promise.all([
        platformApi.getCalendar(monthKey),
        platformApi.listAccounts(),
      ]);
      setCalendarData(Array.isArray(cal) ? cal : []);
      setAccounts(accs);
    } catch {
      // silently handle — show empty state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  function prevMonth() {
    if (month === 0) setYearMonth(year - 1, 11);
    else setYearMonth(year, month - 1);
  }

  function nextMonth() {
    if (month === 11) setYearMonth(year + 1, 0);
    else setYearMonth(year, month + 1);
  }

  /* Build dynamic cell grid (5 or 6 rows) */
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const cells: Array<{ day: number | null; ymd: string | null }> = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDay + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ day: null, ymd: null });
    } else {
      cells.push({ day: dayNum, ymd: toYMD(year, month, dayNum) });
    }
  }

  /* Build ymd -> posts map with active filters */
  const postsByDay: Record<string, ScheduledPost[]> = {};
  for (const cd of calendarData) {
    for (const post of cd.posts) {
      const matchPlatform = platformFilter === "all" || post.platform === platformFilter;
      const matchStatus = statusFilter === "all" || post.status === statusFilter;
      if (matchPlatform && matchStatus) {
        postsByDay[cd.date] = postsByDay[cd.date] ?? [];
        postsByDay[cd.date].push(post);
      }
    }
  }

  const todayYMD = toYMD(now.getFullYear(), now.getMonth(), now.getDate());

  async function handleSchedule(data: {
    clip_id: string;
    social_account_id: string;
    platform: string;
    scheduled_at: string;
    caption: string;
    hashtags: string[];
    platform_kwargs?: Record<string, unknown>;
  }) {
    const post = await platformApi.schedulePost(data);
    const enriched: ScheduledPost = { ...post };
    const dateStr = enriched.scheduled_at.slice(0, 10);
    setCalendarData((prev) => {
      const existing = prev.find((cd) => cd.date === dateStr);
      if (existing) {
        return prev.map((cd) =>
          cd.date === dateStr ? { ...cd, posts: [...cd.posts, enriched] } : cd
        );
      }
      return [...prev, { date: dateStr, posts: [enriched] }];
    });
  }

  const monthName = new Date(year, month).toLocaleString("default", { month: "long" });

  const totalPostsThisMonth = calendarData.reduce((sum, cd) => sum + cd.posts.length, 0);

  return (
    <>
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[12px] border border-c-border bg-surface-2">
        {/* Header */}
        <div className="flex flex-col items-stretch gap-3 border-b border-c-border bg-surface-1 p-3 sm:p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <h1 className="font-display text-[16px] font-bold tracking-[-.01em] sm:text-[19px]">Calendar</h1>
          {totalPostsThisMonth > 0 && (
            <span className="rounded-full border border-c-border bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-c-text-muted sm:text-xs">
              {totalPostsThisMonth}
            </span>
          )}
          {/* Tab toggle */}
          <div className="flex grid-cols-2 rounded-[9px] border border-c-border bg-surface-3 p-0.5 sm:flex">
            {(["calendar", "posts"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={cn("rounded-[7px] px-2.5 py-1 text-[10px] font-semibold capitalize transition sm:px-3 sm:text-xs",
                  activeTab === t ? "bg-surface-glass text-c-text" : "text-c-text-muted hover:text-c-text-secondary")}>
                {t === "calendar" ? "Calendar" : "All Posts"}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-1 sm:gap-2 sm:justify-start">
            <button onClick={prevMonth} className="rounded-md border border-c-border bg-surface-3 px-2 py-1 text-xs text-c-text-secondary hover:text-c-text transition sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-sm">‹</button>
            <span className="min-w-0 flex-1 text-center text-sm font-semibold text-c-text sm:min-w-[150px] sm:flex-none">{monthName} {year}</span>
            <button onClick={nextMonth} className="rounded-md border border-c-border bg-surface-3 px-2 py-1 text-xs text-c-text-secondary hover:text-c-text transition sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-sm">›</button>
          </div>
          <Button size="sm" className="bg-[#ff3d6a] text-white hover:bg-[#e8304f] lg:ml-auto" onClick={() => setShowModal(true)}>
            + Schedule Post
          </Button>
        </div>

        {activeTab === "posts" && (
          <PostsListView
            key={monthKey}
            posts={calendarData.flatMap((cd) => cd.posts)}
            onSelect={setSelectedPost}
            onCancelled={(id) => setCalendarData((prev) =>
              prev.map((cd) => ({ ...cd, posts: cd.posts.filter((p) => p.id !== id) }))
            )}
            loading={loading}
            initialStatusFilter={postsListFilter}
          />
        )}

        {activeTab === "calendar" && (
        <div className="flex flex-1 min-h-0">
          {/* Left Sidebar */}
          <aside className="hidden w-52 shrink-0 border-r border-c-border bg-surface-1 p-4 md:flex md:flex-col gap-6">
            {/* Platform filter */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-c-text-muted">
                Platform
              </p>
              <div className="space-y-0.5">
                {[
                  { id: "all", label: "All Platforms" },
                  ...PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABELS[p] })),
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setPlatformFilter(id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-xs font-semibold transition",
                      platformFilter === id
                        ? "bg-[#ff3d6a]/10 text-rose-200 border border-[#ff3d6a]/30"
                        : "text-c-text-muted hover:bg-surface-2 hover:text-c-text"
                    )}
                  >
                    {id !== "all" && (
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", PLATFORM_DOT[id])} />
                    )}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Status filter */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-c-text-muted">
                Status
              </p>
              <div className="space-y-0.5">
                {(["all", "pending", "posted", "failed"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "flex w-full items-center rounded-[8px] px-3 py-1.5 text-xs font-semibold capitalize transition",
                      statusFilter === s
                        ? "bg-[#ff3d6a]/10 text-rose-200 border border-[#ff3d6a]/30"
                        : "text-c-text-muted hover:bg-surface-2 hover:text-c-text-secondary"
                    )}
                  >
                    {s === "all" ? "All Statuses" : s}
                  </button>
                ))}
              </div>
            </div>

            {/* Connected accounts */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-c-text-muted">
                Accounts
              </p>
              <div className="space-y-1">
                {accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center gap-2 rounded-[8px] px-2 py-1.5">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", PLATFORM_DOT[acc.platform])} />
                    <span className="truncate text-[11px] text-c-text-secondary">{acc.platform_username ?? acc.platform}</span>
                  </div>
                ))}
                {accounts.length === 0 && (
                  <p className="text-[11px] text-c-text-muted">No accounts connected</p>
                )}
              </div>
            </div>
          </aside>

          {/* Calendar area */}
          <div className="flex-1 min-w-0 overflow-auto p-4">
            {/* Day-of-week headers */}
            <div className="mb-1 grid min-w-[392px] grid-cols-7 gap-1 lg:min-w-0">
              {DAYS.map((d) => (
                <div
                  key={d}
                  className="py-1 text-center text-[9px] font-semibold uppercase tracking-[.08em] text-c-text-muted lg:py-1.5 lg:text-[10px]"
                >
                  {d}
                </div>
              ))}
            </div>

            {loading ? (
              <div className="grid min-w-[392px] grid-cols-7 gap-1 lg:min-w-0">
                {Array.from({ length: totalCells }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-[10px] bg-surface-glass" />
                ))}
              </div>
            ) : (
              <div className="grid min-w-[392px] grid-cols-7 gap-1 lg:min-w-0">
                {cells.map((cell, i) => {
                  const isToday = cell.ymd === todayYMD;
                  const posts = (cell.ymd ? postsByDay[cell.ymd] : null) ?? [];
                  return (
                    <div
                      key={i}
                      className={cn(
                        "min-w-14 min-h-24 rounded-[10px] border p-1 transition lg:min-w-0 lg:min-h-28 lg:p-1.5",
                        cell.day === null
                          ? "border-transparent bg-transparent"
                          : isToday
                          ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/5"
                          : posts.some((p) => p.status === "failed")
                          ? "border-red-500/20 bg-red-500/[.03]"
                          : "border-c-border bg-surface-1 hover:border-c-border-hover"
                      )}
                    >
                      {cell.day !== null && (
                        <>
                          <div className="mb-1 flex items-center justify-between">
                            <div
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold lg:h-6 lg:w-6 lg:text-[11px]",
                                isToday ? "bg-[#ff3d6a] text-white" : "text-c-text-muted"
                              )}
                            >
                              {cell.day}
                            </div>
                            {posts.length > 0 && (
                              <span className="text-[9px] font-semibold text-c-text-muted">{posts.length}</span>
                            )}
                          </div>
                          <div className="space-y-0.5">
                            {posts.slice(0, 3).map((post) => {
                              const cp = CAL_PILL[post.platform] ?? { pill: "bg-rose-950/70 border-rose-800/40 text-rose-300", badge: "bg-rose-900/80 text-rose-200" };
                              const abbr = PLATFORM_ABBR[post.platform] ?? post.platform.slice(0, 2).toUpperCase();
                              const title = (post.caption ?? "").trim() || PLATFORM_LABELS[post.platform] || post.platform;
                              return (
                                <button
                                  key={post.id}
                                  onClick={() => setSelectedPost(post)}
                                  title={`${post.caption ?? ""} · ${post.status} · ${PLATFORM_LABELS[post.platform] ?? post.platform}`}
                                  className={cn(
                                    "group flex w-full items-center gap-1 rounded-[4px] border py-[3px] pl-[3px] pr-1.5 text-left transition hover:brightness-125 cursor-pointer",
                                    cp.pill
                                  )}
                                >
                                  <span className={cn("shrink-0 rounded-[3px] px-[4px] py-px text-[8px] font-bold leading-tight", cp.badge)}>
                                    {abbr}
                                  </span>
                                  <span className="truncate text-[10px] font-medium leading-tight flex-1">
                                    {title}
                                  </span>
                                </button>
                              );
                            })}
                            {posts.length > 3 && (
                              <button
                                onClick={() => setExpandedDay(cell.ymd)}
                                className="w-full cursor-pointer rounded px-1.5 py-0.5 text-left text-[9px] font-semibold text-c-text-muted hover:bg-surface-2 hover:text-c-text-secondary transition"
                              >
                                +{posts.length - 3} more →
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {!loading && calendarData.length === 0 && (
              <div className="mt-12 flex flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-c-border bg-surface-1 text-2xl">
                  📅
                </div>
                <p className="font-display text-base font-semibold text-c-text-secondary">
                  No posts scheduled
                </p>
                <p className="text-sm text-c-text-muted">
                  Click "Schedule Post" to add your first post.
                </p>
                <Button
                  size="sm"
                  className="mt-1 bg-[#ff3d6a] hover:bg-[#e8304f] text-white"
                  onClick={() => setShowModal(true)}
                >
                  + Schedule Post
                </Button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Day expand drawer */}
      {expandedDay && (() => {
        const dayPosts = postsByDay[expandedDay] ?? [];
        return (
          <DayDrawer
            date={expandedDay}
            posts={dayPosts}
            onClose={() => setExpandedDay(null)}
            onSelect={(p) => { setSelectedPost(p); setExpandedDay(null); }}
            onStatusClick={(status) => {
              setPostsListFilter(status);
              setActiveTab("posts");
            }}
          />
        );
      })()}

      {/* Post detail popover */}
      {selectedPost && (
        <PostPopover
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onCancelled={(id) => {
            setCalendarData((prev) =>
              prev.map((cd) => ({ ...cd, posts: cd.posts.filter((p) => p.id !== id) }))
            );
            setSelectedPost(null);
          }}
          onPublished={(updated) => {
            setCalendarData((prev) =>
              prev.map((cd) => ({
                ...cd,
                posts: cd.posts.map((p) => (p.id === updated.id ? updated : p)),
              }))
            );
            setSelectedPost(null);
          }}
        />
      )}

      {/* Schedule modal */}
      {showModal && (
        <ScheduleModal
          accounts={accounts}
          onClose={() => setShowModal(false)}
          onSubmit={handleSchedule}
        />
      )}
    </>
  );
}
