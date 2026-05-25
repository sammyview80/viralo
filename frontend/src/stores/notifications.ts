import { useState, useEffect } from "react";
import { notificationApi, token } from "@/lib/api";
import type { AppNotification as Notification } from "@/lib/api";

const PLATFORM_BASE = import.meta.env.VITE_PLATFORM_BASE ?? "http://localhost:8006/api/v1";

type Listener = () => void;
const listeners = new Set<Listener>();

interface Toast {
  id: string;
  notification: Notification;
}

interface State {
  notifications: Notification[];
  unreadCount: number;
  open: boolean;
  toasts: Toast[];
}

let state: State = {
  notifications: [],
  unreadCount: 0,
  open: false,
  toasts: [],
};

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export async function fetchUnreadCount() {
  try {
    const res = await notificationApi.list(true, 1);
    setState({ unreadCount: res.total });
  } catch {
    // ignore
  }
}

export async function fetchNotifications() {
  try {
    const res = await notificationApi.list();
    setState({ notifications: res.items.slice(0, 50) });
  } catch {
    // ignore
  }
}

export async function markRead(id: string) {
  try {
    await notificationApi.markRead(id);
    setState({
      notifications: state.notifications.map((n) => n.id === id ? { ...n, is_read: true } : n),
      unreadCount: Math.max(0, state.unreadCount - 1),
    });
  } catch {
    // ignore
  }
}

export async function markAllRead() {
  try {
    await notificationApi.markAllRead();
    setState({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    });
  } catch {
    // ignore
  }
}

export async function deleteNotification(id: string) {
  try {
    await notificationApi.delete(id);
    setState({ notifications: state.notifications.filter((n) => n.id !== id) });
  } catch {
    // ignore
  }
}

export function setOpen(open: boolean) {
  setState({ open });
  if (open) fetchNotifications();
}

export function addToast(notification: Notification) {
  const toasts = state.toasts.length >= 3
    ? [...state.toasts.slice(1), { id: notification.id, notification }]
    : [...state.toasts, { id: notification.id, notification }];
  setState({ toasts });
}

export function removeToast(id: string) {
  setState({ toasts: state.toasts.filter((t) => t.id !== id) });
}

let _sseCleanup: (() => void) | null = null;

export function connectSSE(): () => void {
  if (_sseCleanup) _sseCleanup();

  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (stopped) return;
    const t = token.get();
    if (!t) {
      retryTimer = setTimeout(connect, 3000);
      return;
    }

    let reader: ReadableStreamDefaultReader<string> | null = null;
    let response: Response | null = null;

    try {
      response = await fetch(`${PLATFORM_BASE}/notifications/stream`, {
        headers: { Authorization: `Bearer ${t}` },
        credentials: "include",
      });

      if (!response.ok || !response.body) {
        if (!stopped) retryTimer = setTimeout(connect, 3000);
        return;
      }

      const stream = response.body.pipeThrough(new TextDecoderStream());
      reader = stream.getReader();
      let buffer = "";

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let eventType = "";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            if (line.startsWith("data:")) dataStr = line.slice(5).trim();
          }
          if (eventType === "keepalive" || !dataStr) continue;
          try {
            const notification = JSON.parse(dataStr) as Notification;
            addToast(notification);
            setState({ unreadCount: state.unreadCount + 1 });
          } catch {
            // ignore malformed
          }
        }
      }
    } catch {
      // ignore
    } finally {
      try { reader?.cancel(); } catch { /* ignore */ }
    }

    if (!stopped) retryTimer = setTimeout(connect, 3000);
  }

  connect();

  const cleanup = () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
  };

  _sseCleanup = cleanup;
  return cleanup;
}

export function useNotificationStore() {
  const [, tick] = useState(0);
  useEffect(() => {
    const rerender = () => tick((n) => n + 1);
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);
  return {
    ...state,
    fetchUnreadCount,
    fetchNotifications,
    markRead,
    markAllRead,
    deleteNotification,
    setOpen,
    addToast,
    removeToast,
    connectSSE,
  };
}
