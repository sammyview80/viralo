import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Shell } from "../Shell";
import { platformApi, type SocialAccount, type ScheduledPost, type CalendarDay } from "@/lib/api";

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
  pending: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  posted: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/20 text-red-300 border-red-500/30",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYMD(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/* ─── Popover ─── */
function PostPopover({ post, onClose }: { post: ScheduledPost; onClose: () => void }) {
  const time = new Date(post.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        className="relative z-10 w-80 rounded-[14px] border border-white/[.08] bg-[#111827] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize", PLATFORM_COLORS[post.platform] ?? "bg-zinc-500/20 text-zinc-300 border-zinc-500/30")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", PLATFORM_DOT[post.platform])} />
            {PLATFORM_LABELS[post.platform] ?? post.platform}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_COLORS[post.status] ?? "bg-zinc-500/20 text-zinc-300 border-zinc-500/30")}>
            {post.status}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-200">
          {post.caption || <span className="text-zinc-600">No caption</span>}
        </p>
        {post.hashtags?.length > 0 && (
          <p className="mt-2 text-xs text-[#ff3d6a]/80">
            {post.hashtags.map((h) => `#${h}`).join(" ")}
          </p>
        )}
        <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {time}
        </div>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-600 hover:text-zinc-300 transition"
          aria-label="Close"
        >
          ✕
        </button>
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
  onSubmit: (data: { clip_id: string; social_account_id: string; platform: string; scheduled_at: string; caption: string; hashtags: string[] }) => Promise<void>;
}) {
  const [clipId, setClipId] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtagsRaw, setHashtagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
      await onSubmit({
        clip_id: clipId.trim(),
        social_account_id: accountId,
        platform: acc?.platform ?? "",
        scheduled_at: new Date(scheduledAt).toISOString(),
        caption,
        hashtags,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to schedule post");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-[9px] border border-white/[.07] bg-[#0b101a] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#ff3d6a]/40 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20 transition";
  const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-[.06em] text-zinc-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        className="relative z-10 w-full max-w-md rounded-[16px] border border-white/[.08] bg-[#0e1420] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">Schedule Post</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-300 transition" aria-label="Close">✕</button>
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

/* ─── Main Page ─── */
export function SchedulerPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [calendarData, setCalendarData] = useState<CalendarDay[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  /* Build 35-cell grid */
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number | null; ymd: string | null }> = [];
  for (let i = 0; i < 35; i++) {
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
    <Shell active="scheduler">
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420]">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[.07] bg-[#0b101a] p-4">
          <h1 className="font-display text-[19px] font-bold tracking-[-.01em]">Scheduler</h1>
          {totalPostsThisMonth > 0 && (
            <span className="rounded-full border border-white/[.07] bg-[#141926] px-2 py-0.5 text-xs font-semibold text-zinc-500">
              {totalPostsThisMonth}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="rounded-lg border border-white/[.07] bg-[#141926] px-2.5 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition"
            >
              ‹
            </button>
            <span className="min-w-[150px] text-center text-sm font-semibold text-zinc-200">
              {monthName} {year}
            </span>
            <button
              onClick={nextMonth}
              className="rounded-lg border border-white/[.07] bg-[#141926] px-2.5 py-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition"
            >
              ›
            </button>
          </div>
          <Button
            size="sm"
            className="bg-[#ff3d6a] hover:bg-[#e8304f] text-white"
            onClick={() => setShowModal(true)}
          >
            + Schedule Post
          </Button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left Sidebar */}
          <aside className="hidden w-52 shrink-0 border-r border-white/[.07] bg-[#0b101a] p-4 md:flex md:flex-col gap-6">
            {/* Platform filter */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-zinc-600">
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
                        : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
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
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-zinc-600">
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
                        : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                    )}
                  >
                    {s === "all" ? "All Statuses" : s}
                  </button>
                ))}
              </div>
            </div>

            {/* Connected accounts */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-zinc-600">
                Accounts
              </p>
              <div className="space-y-1">
                {accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center gap-2 rounded-[8px] px-2 py-1.5">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", PLATFORM_DOT[acc.platform])} />
                    <span className="truncate text-[11px] text-zinc-400">{acc.platform_username ?? acc.platform}</span>
                  </div>
                ))}
                {accounts.length === 0 && (
                  <p className="text-[11px] text-zinc-700">No accounts connected</p>
                )}
              </div>
            </div>
          </aside>

          {/* Calendar area */}
          <div className="flex-1 min-w-0 overflow-auto p-4">
            {/* Day-of-week headers */}
            <div className="mb-1 grid grid-cols-7 gap-1">
              {DAYS.map((d) => (
                <div
                  key={d}
                  className="py-1.5 text-center text-[10px] font-semibold uppercase tracking-[.08em] text-zinc-600"
                >
                  {d}
                </div>
              ))}
            </div>

            {loading ? (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-[10px] bg-white/[.025]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {cells.map((cell, i) => {
                  const isToday = cell.ymd === todayYMD;
                  const posts = (cell.ymd ? postsByDay[cell.ymd] : null) ?? [];
                  return (
                    <div
                      key={i}
                      className={cn(
                        "min-h-28 rounded-[10px] border p-1.5 transition",
                        cell.day === null
                          ? "border-transparent bg-transparent"
                          : isToday
                          ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/5"
                          : "border-white/[.05] bg-white/[.02] hover:border-white/[.1]"
                      )}
                    >
                      {cell.day !== null && (
                        <>
                          <div
                            className={cn(
                              "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                              isToday ? "bg-[#ff3d6a] text-white" : "text-zinc-500"
                            )}
                          >
                            {cell.day}
                          </div>
                          <div className="space-y-0.5">
                            {posts.slice(0, 3).map((post) => (
                              <button
                                key={post.id}
                                onClick={() => setSelectedPost(post)}
                                className={cn(
                                  "w-full truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-medium transition hover:opacity-80",
                                  PLATFORM_COLORS[post.platform] ??
                                    "bg-zinc-500/20 text-zinc-300 border-zinc-500/30"
                                )}
                                title={post.caption ?? ""}
                              >
                                <span
                                  className={cn(
                                    "mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                                    PLATFORM_DOT[post.platform]
                                  )}
                                />
                                {(post.caption ?? "").slice(0, 18) || PLATFORM_LABELS[post.platform] || post.platform}
                              </button>
                            ))}
                            {posts.length > 3 && (
                              <p className="pl-1 text-[9px] text-zinc-600">+{posts.length - 3} more</p>
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
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[.07] bg-white/[.025] text-2xl">
                  📅
                </div>
                <p className="font-display text-base font-semibold text-zinc-300">
                  No posts scheduled
                </p>
                <p className="text-sm text-zinc-600">
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
      </div>

      {/* Post detail popover */}
      {selectedPost && (
        <PostPopover post={selectedPost} onClose={() => setSelectedPost(null)} />
      )}

      {/* Schedule modal */}
      {showModal && (
        <ScheduleModal
          accounts={accounts}
          onClose={() => setShowModal(false)}
          onSubmit={handleSchedule}
        />
      )}
    </Shell>
  );
}
