import { useEffect, useState, useCallback, useRef } from "react";
import { adminApi, ApiError, type AdminUserRow } from "@/lib/api";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

const PER_PAGE = 25;

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "gray" | "red" | "amber" }) {
  const tones = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    gray: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

function statusTone(status: string | null): "green" | "gray" | "red" | "amber" {
  if (status === "active" || status === "trialing") return "green";
  if (status === "past_due") return "amber";
  if (status === "cancelled") return "red";
  return "gray";
}

export function AdminPaymentsPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    adminApi
      .listUsers({ page, per_page: PER_PAGE, sort_by: "created_at", order: "desc", subscription_status: statusFilter || undefined })
      .then((u) => {
        if (seq !== requestSeq.current) return;
        setUsers(u.items);
        setTotal(u.total);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          navigate("/admin");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to load payments data");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[24px] font-bold text-c-text">Payments</h1>
        <p className="mt-1 text-[13px] text-c-text-muted">Subscription status per user, from local billing data</p>
      </div>

      {/* TODO: full Stripe invoice/payment history is a future enhancement — it
          requires calling the Stripe API (no Stripe client is set up for that
          use case yet; billing.py only handles checkout + webhooks). This
          view is built entirely from what's already in the DB: subscription
          status, plan, billing cycle, and current period end. */}
      <div className="mb-6 rounded-[10px] border border-amber-500/20 bg-amber-500/[.08] px-4 py-3 text-[12.5px] text-amber-300">
        This view reflects subscription status stored locally (status, plan, billing cycle, period end).
        Full Stripe invoice/payment history isn't wired up yet — that requires a Stripe API integration
        not currently present in this codebase.
      </div>

      {error && (
        <div className="mb-5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
          className="min-h-[42px] w-full max-w-xs rounded-[10px] border border-c-border bg-surface-2 px-3 py-2.5 text-[13px] text-c-text outline-none sm:w-auto"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past due</option>
          <option value="cancelled">Cancelled</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-c-border bg-surface-2">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-c-border text-[11px] uppercase tracking-[.06em] text-c-text-muted">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Billing cycle</th>
              <th className="px-4 py-3">Period ends</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-c-text-muted">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-c-text-muted">No matching subscriptions.</td></tr>
            )}
            {!loading && users.map((u) => (
              <tr key={u.id} className="cursor-pointer border-b border-c-border/60 last:border-0 hover:bg-surface-3" onClick={() => navigate(`/admin/users/${u.id}`)}>
                <td className="px-4 py-3 text-c-text">{u.email}</td>
                <td className="px-4 py-3 text-c-text-secondary">{u.tier}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(u.subscription_status)}>{u.subscription_status ?? "no subscription"}</Badge></td>
                <td className="px-4 py-3 text-c-text-muted">{u.billing_cycle ?? "—"}</td>
                <td className="px-4 py-3 text-c-text-muted">{u.current_period_end ? new Date(u.current_period_end).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-c-text-muted">
        <span>{total} subscription{total === 1 ? "" : "s"} · page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="min-h-[40px] rounded-[8px] border border-c-border px-3 py-1.5 disabled:opacity-40">Prev</button>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="min-h-[40px] rounded-[8px] border border-c-border px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
