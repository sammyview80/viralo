import { useEffect, useState, useCallback, useRef } from "react";
import { adminApi, ApiError, type AdminNotificationRow } from "@/lib/api";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

const PER_PAGE = 25;

export function AdminNotificationsPage() {
  const [items, setItems] = useState<AdminNotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [readFilter, setReadFilter] = useState<"" | "true" | "false">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    adminApi
      .listNotifications({
        page,
        per_page: PER_PAGE,
        type: type || undefined,
        is_read: readFilter === "" ? undefined : readFilter === "true",
      })
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          navigate("/admin");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to load notifications");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [page, type, readFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleMarkRead(id: string) {
    setUpdatingId(id);
    try {
      const updated = await adminApi.markNotificationRead(id);
      setItems((prev) => prev.map((n) => (n.id === id ? updated : n)));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        navigate("/admin");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to update notification");
    } finally {
      setUpdatingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[24px] font-bold text-c-text">Notifications</h1>
        <p className="mt-1 text-[13px] text-c-text-muted">Signup alerts and system events</p>
      </div>

      {error && (
        <div className="mb-5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={type}
          onChange={(e) => { setPage(1); setType(e.target.value); }}
          className="min-h-[42px] rounded-[10px] border border-c-border bg-surface-2 px-3 py-2 text-[13px] text-c-text outline-none"
        >
          <option value="">All types</option>
          <option value="new_signup">New signup</option>
        </select>
        <select
          value={readFilter}
          onChange={(e) => { setPage(1); setReadFilter(e.target.value as "" | "true" | "false"); }}
          className="min-h-[42px] rounded-[10px] border border-c-border bg-surface-2 px-3 py-2 text-[13px] text-c-text outline-none"
        >
          <option value="">All</option>
          <option value="false">Unread</option>
          <option value="true">Read</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-c-border bg-surface-2">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-c-border text-[11px] uppercase tracking-[.06em] text-c-text-muted">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Body</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-c-text-muted">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-c-text-muted">No notifications found.</td></tr>
            )}
            {!loading && items.map((n) => (
              <tr key={n.id} className={cn("border-b border-c-border/60 last:border-0", !n.is_read && "bg-surface-3/40")}>
                <td className="px-4 py-3 text-c-text">{n.title}</td>
                <td className="px-4 py-3 text-c-text-secondary">{n.body}</td>
                <td className="px-4 py-3 text-c-text-muted">{n.type}</td>
                <td className="px-4 py-3 text-c-text-muted">{new Date(n.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                    n.is_read ? "border-zinc-500/20 bg-zinc-500/10 text-zinc-400" : "border-[#ff3d6a]/20 bg-[#ff3d6a]/10 text-[#ff3d6a]"
                  )}>
                    {n.is_read ? "read" : "unread"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {!n.is_read && (
                    <button
                      disabled={updatingId === n.id}
                      onClick={() => handleMarkRead(n.id)}
                      className="min-h-[36px] whitespace-nowrap rounded-[8px] border border-c-border bg-surface-3 px-2.5 py-1.5 text-[12px] font-semibold text-c-text hover:bg-surface-2 disabled:opacity-50"
                    >
                      {updatingId === n.id ? "Updating…" : "Mark read"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-c-text-muted">
        <span>{total} notification{total === 1 ? "" : "s"} · page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-h-[40px] rounded-[8px] border border-c-border px-3 py-1.5 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="min-h-[40px] rounded-[8px] border border-c-border px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
