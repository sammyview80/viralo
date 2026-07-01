import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";
import { useNotificationStore, markRead, removeToast } from "@/stores/notifications";
import type { AppNotification as Notification } from "@/lib/api";

type IconProps = { size?: number; className?: string };

function Icon({ size = 18, children, ...rest }: IconProps & { children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

function XIcon(p: IconProps) {
  return <Icon {...p}><path d="M18 6L6 18M6 6l12 12" /></Icon>;
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

function Toast({ id, notification }: { id: string; notification: Notification }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => removeToast(id), 300);
    }, 4000);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(timer);
    };
  }, [id]);

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setVisible(false);
    setTimeout(() => removeToast(id), 300);
  }

  function handleClick() {
    if (!notification.is_read) markRead(notification.id);
    const url = notification.action_url;
    if (url) {
      if (url.startsWith("http")) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        navigate(url.replace(/^\/workspace/, ""));
      }
    }
    setVisible(false);
    setTimeout(() => removeToast(id), 300);
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        "flex w-[320px] cursor-pointer items-start gap-3 rounded-[12px] border border-c-border bg-surface-1 p-3.5 shadow-[0_12px_40px_rgba(0,0,0,.25)] dark:shadow-[0_12px_40px_rgba(0,0,0,.55)] transition-[opacity,transform] duration-300",
        visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      )}
    >
      <span className="mt-[3px] h-[8px] w-[8px] flex-none rounded-full bg-[#ff3d6a] shadow-[0_0_8px_rgba(255,61,106,.7)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-c-text">{notification.title}</p>
        {notification.body && (
          <p className="truncate text-[11.5px] leading-4 text-c-text-secondary">{notification.body}</p>
        )}
        <span className="text-[10.5px] text-c-text-muted">{timeAgo(notification.created_at)}</span>
      </div>
      <button
        onClick={handleDismiss}
        className="flex-none text-c-text-muted transition hover:text-c-text-secondary"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useNotificationStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[max(env(safe-area-inset-bottom),80px)] right-4 z-[100] flex flex-col gap-2 lg:bottom-6 lg:right-6">
      {toasts.map(({ id, notification }) => (
        <Toast key={id} id={id} notification={notification} />
      ))}
    </div>
  );
}
