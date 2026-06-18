import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";
import { notificationApi } from "@/lib/api";
import type { AppNotification } from "@/lib/api";
import { markRead, markAllRead, deleteNotification } from "@/stores/notifications";

// ── Icons ─────────────────────────────────────────────────────────────────────

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={cn("size-4", className)}>
      {children}
    </svg>
  );
}

const Icons = {
  Bell:     () => <Svg><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></Svg>,
  Check:    () => <Svg><path d="M20 6L9 17l-5-5"/></Svg>,
  CheckAll: () => <Svg className="size-3.5"><path d="M20 6L9 17l-5-5"/></Svg>,
  Trash:    () => <Svg><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></Svg>,
  Filter:   () => <Svg><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></Svg>,
  ArrowRight: () => <Svg className="size-3"><path d="M5 12h14M12 5l7 7-7 7"/></Svg>,
  Video:    () => <Svg><polygon points="5 3 19 12 5 21 5 3"/></Svg>,
  Post:     () => <Svg><path d="M20 6L9 17l-5-5"/></Svg>,
  Workflow: () => <Svg><rect x="2" y="3" width="6" height="5" rx="1"/><rect x="16" y="3" width="6" height="5" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M5 8v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><line x1="12" y1="12" x2="12" y2="16"/></Svg>,
  Channel:  () => <Svg><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-1.96C18.88 4 12 4 12 4s-6.88 0-8.6.46A2.78 2.78 0 0 0 1.46 6.42C1 8.15 1 12 1 12s0 3.85.46 5.58a2.78 2.78 0 0 0 1.94 1.96C5.12 20 12 20 12 20s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-1.96C23 15.85 23 12 23 12s0-3.85-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/></Svg>,
  Alert:    () => <Svg><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Svg>,
  Error:    () => <Svg><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></Svg>,
  Brain:    () => <Svg><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-3.14zm5 0a2.5 2.5 0 0 0-2.5 2.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-3.14z"/></Svg>,
  Refresh:  () => <Svg><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></Svg>,
};

// ── Type config ───────────────────────────────────────────────────────────────

type TypeCfg = { icon: React.ReactNode; accent: string; bg: string; label: string; filterLabel: string };

const TYPE_CFG: Record<string, TypeCfg> = {
  video_ready:       { icon: <Icons.Video />,    accent: "text-emerald-400", bg: "bg-emerald-500/15", label: "Video ready",      filterLabel: "Videos" },
  video_failed:      { icon: <Icons.Error />,    accent: "text-red-400",     bg: "bg-red-500/15",     label: "Processing failed",filterLabel: "Videos" },
  post_published:    { icon: <Icons.Post />,     accent: "text-emerald-400", bg: "bg-emerald-500/15", label: "Post live",        filterLabel: "Posts" },
  post_failed:       { icon: <Icons.Error />,    accent: "text-red-400",     bg: "bg-red-500/15",     label: "Post failed",      filterLabel: "Posts" },
  channel_video:     { icon: <Icons.Channel />,  accent: "text-red-400",     bg: "bg-red-500/15",     label: "New video",        filterLabel: "Channels" },
  workflow_complete: { icon: <Icons.Workflow />, accent: "text-blue-400",    bg: "bg-blue-500/15",    label: "Workflow done",    filterLabel: "System" },
  workflow_failed:   { icon: <Icons.Workflow />, accent: "text-red-400",     bg: "bg-red-500/15",     label: "Workflow failed",  filterLabel: "System" },
  session_complete:  { icon: <Icons.Brain />,    accent: "text-violet-400",  bg: "bg-violet-500/15",  label: "Brainstorm done",  filterLabel: "System" },
  quota_warning:     { icon: <Icons.Alert />,    accent: "text-amber-400",   bg: "bg-amber-500/15",   label: "Quota warning",    filterLabel: "System" },
};
const DEFAULT_CFG: TypeCfg = {
  icon: <Icons.Bell />, accent: "text-zinc-400", bg: "bg-white/[.06]", label: "Notification", filterLabel: "Other",
};

type FilterKey = "all" | "unread" | "Videos" | "Posts" | "Channels" | "System";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "unread",   label: "Unread" },
  { key: "Videos",   label: "Videos" },
  { key: "Posts",    label: "Posts" },
  { key: "Channels", label: "Channels" },
  { key: "System",   label: "System" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: diff > 365 ? "numeric" : undefined });
}

function groupByDate(items: AppNotification[]): { label: string; items: AppNotification[] }[] {
  const groups: Map<string, AppNotification[]> = new Map();
  for (const item of items) {
    const label = fmtDate(item.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function cfg(n: AppNotification): TypeCfg {
  return (n.type ? TYPE_CFG[n.type] : null) ?? DEFAULT_CFG;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function NotifRow({
  n, selected, onSelect, onDelete,
}: {
  n: AppNotification;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const c = cfg(n);
  const isUnread = !n.is_read;

  function handleClick() {
    if (isUnread) markRead(n.id);
    if (n.action_url) {
      if (n.action_url.startsWith("http")) window.open(n.action_url, "_blank", "noopener,noreferrer");
      else navigate(n.action_url.replace(/^\/workspace/, ""));
    }
  }

  return (
    <div className={cn(
      "group relative flex items-start gap-4 px-5 py-4 transition-colors",
      "hover:bg-white/[.025] cursor-pointer",
      isUnread && "bg-white/[.018]",
      selected && "bg-[#ff3d6a]/[.06]",
    )}>
      {/* Unread stripe */}
      {isUnread && !selected && (
        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[#ff3d6a]" />
      )}
      {selected && (
        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[#ff3d6a]/60" />
      )}

      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition",
          selected
            ? "border-[#ff3d6a] bg-[#ff3d6a] text-white"
            : "border-white/[.12] bg-transparent text-transparent group-hover:border-white/[.25]"
        )}
        aria-label="Select notification"
      >
        <svg viewBox="0 0 12 12" fill="none" className="size-2.5">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Icon */}
      <span
        className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px]", c.bg, c.accent)}
        onClick={handleClick}
      >
        {c.icon}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1" onClick={handleClick}>
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("text-[10.5px] font-bold uppercase tracking-[.1em]", c.accent)}>{c.label}</span>
          <span className="text-[11px] text-zinc-600">{timeAgo(n.created_at)}</span>
          {isUnread && (
            <span className="ml-1 h-[5px] w-[5px] rounded-full bg-[#ff3d6a] shadow-[0_0_5px_rgba(255,61,106,.8)]" />
          )}
        </div>
        <p className={cn("text-[13.5px] font-semibold leading-[1.4]", isUnread ? "text-zinc-100" : "text-zinc-400")}>
          {n.title}
        </p>
        {n.body && (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-zinc-500">{n.body}</p>
        )}
        {n.action_url && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-[#ff5f86] opacity-0 transition group-hover:opacity-100">
            View <Icons.ArrowRight />
          </span>
        )}
      </div>

      {/* Actions (hover) */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        {isUnread && (
          <button
            onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
            title="Mark as read"
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/[.08] hover:text-zinc-200 transition"
          >
            <Icons.CheckAll />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
          title="Delete"
          className="flex size-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
        >
          <Icons.Trash />
        </button>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: FilterKey }) {
  const msgs: Record<FilterKey, { title: string; body: string }> = {
    all:      { title: "All caught up", body: "No notifications yet. They'll appear here when something happens." },
    unread:   { title: "Nothing unread", body: "You've read everything. Nice work." },
    Videos:   { title: "No video notifications", body: "Import a YouTube video or upload one to get started." },
    Posts:    { title: "No post notifications", body: "Schedule and publish posts to see updates here." },
    Channels: { title: "No channel notifications", body: "Subscribe to YouTube channels to get notified on new videos." },
    System:   { title: "No system notifications", body: "Workflow and quota alerts will appear here." },
  };
  const m = msgs[filter];

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-[20px] border border-white/[.07] bg-white/[.03] text-zinc-600">
        <Icons.Bell />
      </div>
      <p className="text-[15px] font-semibold text-zinc-300">{m.title}</p>
      <p className="mt-1.5 max-w-[280px] text-[13px] leading-[1.6] text-zinc-600">{m.body}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function NotificationsPage() {
  const [items, setItems]         = useState<AppNotification[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [filter, setFilter]       = useState<FilterKey>("all");
  const [selected, setSelected]   = useState<Set<string>>(new Set());

  const PER_PAGE = 20;

  const load = useCallback(async (pg: number, reset = false) => {
    try {
      if (pg === 1) setLoading(true); else setLoadingMore(true);
      const res = await notificationApi.list(filter === "unread" ? true : undefined, pg);
      setTotal(res.total);
      setItems((prev) => reset ? res.items : [...prev, ...res.items]);
      setPage(pg);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => {
    setSelected(new Set());
    setItems([]);
    load(1, true);
  }, [filter]);

  // Client-side filter for type groups (data already loaded per page, filter locally)
  const displayed = items.filter((n) => {
    if (filter === "all" || filter === "unread") return true;
    const c = (n.type ? TYPE_CFG[n.type] : null) ?? DEFAULT_CFG;
    return c.filterLabel === filter;
  });

  // Unread counts per filter
  const unreadByFilter: Record<FilterKey, number> = {
    all:      items.filter((n) => !n.is_read).length,
    unread:   items.filter((n) => !n.is_read).length,
    Videos:   items.filter((n) => !n.is_read && ["video_ready","video_failed"].includes(n.type ?? "")).length,
    Posts:    items.filter((n) => !n.is_read && ["post_published","post_failed"].includes(n.type ?? "")).length,
    Channels: items.filter((n) => !n.is_read && n.type === "channel_video").length,
    System:   items.filter((n) => !n.is_read && ["workflow_complete","workflow_failed","session_complete","quota_warning"].includes(n.type ?? "")).length,
  };

  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    setSelected((s) => s.size === displayed.length ? new Set() : new Set(displayed.map((n) => n.id)));
  }

  async function handleDeleteSelected() {
    for (const id of selected) await deleteNotification(id);
    setItems((prev) => prev.filter((n) => !selected.has(n.id)));
    setSelected(new Set());
  }

  async function handleMarkSelectedRead() {
    for (const id of selected) await markRead(id);
    setItems((prev) => prev.map((n) => selected.has(n.id) ? { ...n, is_read: true } : n));
    setSelected(new Set());
  }

  async function handleMarkAllRead() {
    await markAllRead();
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function handleDelete(id: string) {
    await deleteNotification(id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  const groups = groupByDate(displayed);
  const hasMore = items.length < total && (filter === "all" || filter === "unread");
  const allSelected = displayed.length > 0 && selected.size === displayed.length;
  const unreadTotal = items.filter((n) => !n.is_read).length;

  return (
      <div className="mx-auto max-w-3xl">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="font-display text-[22px] font-bold tracking-[-0.01em] text-white">
              Notifications
            </h1>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              {total > 0 ? `${total} total${unreadTotal > 0 ? ` · ${unreadTotal} unread` : ""}` : "Activity from your videos, posts, and workflows"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(1, true)}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-transparent px-3 text-[12px] font-medium text-zinc-400 transition hover:border-white/[.14] hover:text-zinc-200"
            >
              <Icons.Refresh />
              Refresh
            </button>
            {unreadTotal > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-transparent px-3 text-[12px] font-medium text-zinc-400 transition hover:border-white/[.14] hover:text-zinc-200"
              >
                <Icons.CheckAll />
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mb-4 flex items-center gap-1 overflow-x-auto pb-1">
          {FILTERS.map((f) => {
            const count = unreadByFilter[f.key];
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold transition",
                  filter === f.key
                    ? "bg-[#ff3d6a]/[.12] text-[#ff5f86] shadow-[inset_0_0_0_1px_rgba(255,61,106,.25)]"
                    : "text-zinc-500 hover:bg-white/[.05] hover:text-zinc-300"
                )}
              >
                {f.label}
                {count > 0 && (
                  <span className={cn(
                    "flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold",
                    filter === f.key ? "bg-[#ff3d6a]/20 text-[#ff5f86]" : "bg-white/[.07] text-zinc-500"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main card */}
        <div className="overflow-hidden rounded-[16px] border border-white/[.08] bg-[#0e1420]">

          {/* Bulk action bar */}
          {displayed.length > 0 && (
            <div className={cn(
              "flex items-center justify-between border-b border-white/[.07] px-5 py-2.5 transition-all",
              selected.size > 0 ? "bg-[#ff3d6a]/[.04]" : "bg-transparent"
            )}>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSelectAll}
                  className={cn(
                    "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition",
                    allSelected
                      ? "border-[#ff3d6a] bg-[#ff3d6a] text-white"
                      : "border-white/[.15] text-transparent hover:border-white/[.3]"
                  )}
                  aria-label="Select all"
                >
                  <svg viewBox="0 0 12 12" fill="none" className="size-2.5">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {selected.size > 0 ? (
                  <span className="text-[12px] font-medium text-zinc-300">
                    {selected.size} selected
                  </span>
                ) : (
                  <span className="text-[12px] text-zinc-600">
                    {displayed.length} notification{displayed.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleMarkSelectedRead}
                    className="flex h-7 items-center gap-1.5 rounded-[7px] border border-white/[.09] bg-white/[.04] px-2.5 text-[11.5px] font-medium text-zinc-300 transition hover:bg-white/[.08] hover:text-white"
                  >
                    <Icons.Check />
                    Mark read
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    className="flex h-7 items-center gap-1.5 rounded-[7px] border border-red-500/20 bg-red-500/[.07] px-2.5 text-[11.5px] font-medium text-red-400 transition hover:bg-red-500/[.14] hover:text-red-300"
                  >
                    <Icons.Trash />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Content */}
          {loading ? (
            <div className="divide-y divide-white/[.04]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-4 px-5 py-4">
                  <div className="mt-0.5 size-[18px] animate-pulse rounded-[5px] bg-white/[.06]" />
                  <div className="mt-0.5 size-9 animate-pulse rounded-[10px] bg-white/[.06]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-2.5 w-24 animate-pulse rounded-full bg-white/[.06]" />
                    <div className="h-3 w-3/4 animate-pulse rounded-full bg-white/[.05]" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-white/[.04]" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div>
              {groups.map((group) => (
                <div key={group.label}>
                  {/* Date group header */}
                  <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[.04] bg-[#0b101a]/95 px-5 py-2 backdrop-blur-sm">
                    <span className="text-[11px] font-bold uppercase tracking-[.1em] text-zinc-600">
                      {group.label}
                    </span>
                    <div className="h-px flex-1 bg-white/[.04]" />
                    <span className="text-[10.5px] text-zinc-700">{group.items.length}</span>
                  </div>

                  <div className="divide-y divide-white/[.04]">
                    {group.items.map((n) => (
                      <NotifRow
                        key={n.id}
                        n={n}
                        selected={selected.has(n.id)}
                        onSelect={toggleSelect}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Load more */}
              {hasMore && (
                <div className="border-t border-white/[.07] px-5 py-3.5">
                  <button
                    onClick={() => load(page + 1)}
                    disabled={loadingMore}
                    className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/[.07] py-2.5 text-[12.5px] font-medium text-zinc-500 transition hover:border-white/[.13] hover:text-zinc-300 disabled:opacity-40"
                  >
                    {loadingMore ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
                    ) : (
                      <>Load more <span className="text-zinc-600">({total - items.length} remaining)</span></>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  );
}
