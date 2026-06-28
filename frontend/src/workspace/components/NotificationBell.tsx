import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";
import { useNotificationStore, markRead, markAllRead, setOpen } from "@/stores/notifications";
import type { AppNotification as Notification } from "@/lib/api";

// ── Icons ────────────────────────────────────────────────────────────────────

function BellIcon({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}

function CheckAllIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// ── Per-type config ───────────────────────────────────────────────────────────

type TypeConfig = {
  icon: React.ReactNode;
  accent: string;       // tailwind text color
  bg: string;           // tailwind bg for icon ring
  label: string;
};

function VideoReadyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function VideoFailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function PostLiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function PostFailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChannelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-1.96C18.88 4 12 4 12 4s-6.88 0-8.6.46A2.78 2.78 0 0 0 1.46 6.42C1 8.15 1 12 1 12s0 3.85.46 5.58a2.78 2.78 0 0 0 1.94 1.96C5.12 20 12 20 12 20s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-1.96C23 15.85 23 12 23 12s0-3.85-.46-5.58z" />
      <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <rect x="2" y="3" width="6" height="5" rx="1" />
      <rect x="16" y="3" width="6" height="5" rx="1" />
      <rect x="9" y="16" width="6" height="5" rx="1" />
      <path d="M5 8v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <line x1="12" y1="12" x2="12" y2="16" />
    </svg>
  );
}

function QuotaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
    </svg>
  );
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  video_ready:      { icon: <VideoReadyIcon />, accent: "text-emerald-400", bg: "bg-emerald-500/15", label: "Video ready" },
  video_failed:     { icon: <VideoFailIcon />,  accent: "text-red-400",     bg: "bg-red-500/15",     label: "Processing failed" },
  post_published:   { icon: <PostLiveIcon />,   accent: "text-emerald-400", bg: "bg-emerald-500/15", label: "Post live" },
  post_failed:      { icon: <PostFailIcon />,   accent: "text-red-400",     bg: "bg-red-500/15",     label: "Post failed" },
  channel_video:    { icon: <ChannelIcon />,    accent: "text-red-400",     bg: "bg-red-500/15",     label: "New video" },
  workflow_complete:{ icon: <WorkflowIcon />,   accent: "text-blue-400",    bg: "bg-blue-500/15",    label: "Workflow done" },
  workflow_failed:  { icon: <WorkflowIcon />,   accent: "text-red-400",     bg: "bg-red-500/15",     label: "Workflow failed" },
  session_complete: { icon: <BrainIcon />,      accent: "text-violet-400",  bg: "bg-violet-500/15",  label: "Brainstorm done" },
  quota_warning:    { icon: <QuotaIcon />,      accent: "text-amber-400",   bg: "bg-amber-500/15",   label: "Quota warning" },
};

const DEFAULT_CONFIG: TypeConfig = {
  icon: <BellIcon size={14} />,
  accent: "text-zinc-400",
  bg: "bg-white/[.06]",
  label: "Notification",
};

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
  return `${d}d ago`;
}

// ── NotificationRow ───────────────────────────────────────────────────────────

function NotificationRow({ notification: n }: { notification: Notification }) {
  const cfg = (n.type ? TYPE_CONFIG[n.type] : null) ?? DEFAULT_CONFIG;
  const isUnread = !n.is_read;

  function handleClick() {
    if (isUnread) markRead(n.id);
    const url = n.action_url;
    if (url) {
      setOpen(false);
      if (url.startsWith("http")) window.open(url, "_blank", "noopener,noreferrer");
      else setTimeout(() => navigate(url.replace(/^\/workspace/, "")), 0);
    }
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "group relative flex w-full items-start gap-3 px-3.5 py-3 text-left transition",
        "hover:bg-[#141926]",
        isUnread && "bg-white/[.015]"
      )}
    >
      {/* Unread left bar */}
      {isUnread && (
        <span className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full bg-[#ff3d6a]" />
      )}

      {/* Type icon */}
      <span className={cn(
        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px]",
        cfg.bg, cfg.accent
      )}>
        {cfg.icon}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn("text-[10px] font-bold uppercase tracking-[.1em]", cfg.accent)}>
            {cfg.label}
          </span>
          <span className="text-[10px] text-zinc-600">{timeAgo(n.created_at)}</span>
        </div>
        <p className={cn(
          "text-[12.5px] font-medium leading-[1.4]",
          isUnread ? "text-zinc-100" : "text-zinc-400"
        )}>
          {n.title}
        </p>
        {n.body && (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-[1.4] text-zinc-500">{n.body}</p>
        )}
        {n.action_url && (
          <span className="mt-1 inline-block text-[11px] font-medium text-[#ff5f86] opacity-0 transition group-hover:opacity-100">
            View →
          </span>
        )}
      </div>
    </button>
  );
}

// ── NotificationBell ──────────────────────────────────────────────────────────

export function NotificationBell() {
  const { notifications, unreadCount, open } = useNotificationStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-white/[.08] text-zinc-400 transition hover:border-white/[.13] hover:bg-[#141926] hover:text-zinc-200"
      >
        <BellIcon size={15} />
        {unreadCount > 0 && (
          <span className="absolute -right-[3px] -top-[3px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#ff3d6a] px-[3px] text-[9px] font-bold text-white shadow-[0_0_8px_rgba(255,61,106,.6)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] overflow-hidden rounded-[14px] border border-white/[.10] bg-[#0e1420] shadow-[0_20px_60px_rgba(0,0,0,.65)]">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-white">Notifications</span>
              {unreadCount > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff3d6a]/20 px-1.5 text-[10px] font-bold text-[#ff5f86]">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-zinc-200"
              >
                <CheckAllIcon />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-white/[.04]">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                <BellIcon size={24} className="mb-3 opacity-30" />
                <span className="text-[12.5px] font-medium">All caught up</span>
                <span className="mt-1 text-[11.5px] text-zinc-700">No notifications yet</span>
              </div>
            ) : (
              notifications.slice(0, 8).map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/[.07] px-4 py-2.5">
            <button
              onClick={() => { setOpen(false); navigate("/notifications"); }}
              className="text-[11.5px] text-zinc-500 transition hover:text-zinc-200"
            >
              See all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
