import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";
import { useNotificationStore, markRead, markAllRead, setOpen } from "@/stores/notifications";
import type { AppNotification as Notification } from "@/lib/api";

type IconProps = { size?: number; className?: string };

function Icon({ d, size = 18, children, ...rest }: IconProps & { d?: string; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {d ? <path d={d} /> : children}
    </svg>
  );
}

function BellIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </Icon>
  );
}

function CheckIcon(p: IconProps) {
  return <Icon {...p} d="M20 6L9 17l-5-5" />;
}

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

function NotificationRow({ notification }: { notification: Notification }) {
  function handleClick() {
    if (!notification.is_read) markRead(notification.id);
    if (notification.action_url) navigate(notification.action_url);
  }

  return (
    <button
      onClick={handleClick}
      className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[#141926]"
    >
      <span
        className={cn(
          "mt-[5px] h-[7px] w-[7px] flex-none rounded-full",
          notification.is_read ? "bg-transparent" : "bg-[#ff3d6a] shadow-[0_0_6px_rgba(255,61,106,.7)]"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[12.5px] font-medium leading-5", notification.is_read ? "text-zinc-400" : "text-zinc-100")}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="truncate text-[11.5px] leading-4 text-zinc-500">{notification.body}</p>
        )}
        <span className="text-[10.5px] text-zinc-600">{timeAgo(notification.created_at)}</span>
      </div>
    </button>
  );
}

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
      <button
        onClick={() => setOpen(!open)}
        className="relative grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-white/[.08] text-zinc-400 transition hover:border-white/[.13] hover:bg-[#141926] hover:text-zinc-200"
      >
        <BellIcon size={15} />
        {unreadCount > 0 && (
          <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full bg-[#ff3d6a] shadow-[0_0_8px_rgba(255,61,106,.8),0_0_0_2px_#080b12]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-[12px] border border-white/[.10] bg-[#0e1420] shadow-[0_16px_48px_rgba(0,0,0,.6)]">
          <div className="flex items-center justify-between border-b border-white/[.07] px-3.5 py-2.5">
            <span className="text-[12.5px] font-semibold text-zinc-200">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-zinc-200"
              >
                <CheckIcon size={12} />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-zinc-600">
                <BellIcon size={22} className="mb-2 opacity-40" />
                <span className="text-[12px]">No notifications yet</span>
              </div>
            ) : (
              notifications.slice(0, 8).map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))
            )}
          </div>

          <div className="border-t border-white/[.07] px-3.5 py-2.5">
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
