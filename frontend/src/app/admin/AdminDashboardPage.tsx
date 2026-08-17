import { useEffect, useState, useCallback } from "react";
import { adminApi, adminToken, ApiError, type AdminUserRow, type AdminUserStats } from "@/lib/api";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

const PLAN_OPTIONS = ["free", "pro", "agency"];
const PER_PAGE = 25;

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[12px] border border-c-border bg-surface-2 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-c-text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[26px] font-bold text-c-text">{value}</p>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "gray" | "red" }) {
  const tones = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    gray: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminUserStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      adminApi.me(),
      adminApi.userStats(),
      adminApi.listUsers({ page, per_page: PER_PAGE, search, sort_by: sortBy, order }),
    ])
      .then(([me, s, u]) => {
        setMeId(me.id);
        setIsSuperadmin(me.is_superadmin);
        setStats(s);
        setUsers(u.items);
        setTotal(u.total);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          navigate("/admin");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to load admin data");
      })
      .finally(() => setLoading(false));
  }, [page, search, sortBy, order]);

  useEffect(() => { load(); }, [load]);

  function toggleSort(col: string) {
    if (sortBy === col) { setOrder((o) => (o === "asc" ? "desc" : "asc")); }
    else { setSortBy(col); setOrder("desc"); }
  }

  async function handleTierChange(userId: string, planName: string) {
    setUpdatingId(userId);
    try {
      const updated = await adminApi.changeTier(userId, planName);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update tier");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleAdminRoleToggle(userId: string, nextIsAdmin: boolean) {
    setUpdatingId(userId);
    try {
      const updated = await adminApi.changeAdminRole(userId, nextIsAdmin);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update admin role");
    } finally {
      setUpdatingId(null);
    }
  }

  function handleLogout() {
    adminToken.clear();
    navigate("/admin");
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="min-h-screen bg-background px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-display text-[24px] font-bold text-c-text">Admin dashboard</h1>
            <p className="mt-1 text-[13px] text-c-text-muted">Users, plans, and account status</p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-[10px] border border-c-border px-4 py-2 text-[12.5px] font-semibold text-c-text-secondary hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
            {error}
          </div>
        )}

        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Total users" value={stats.total_users} />
            <StatCard label="Active users" value={stats.active_users} />
            <StatCard label="Paid users" value={stats.paid_users} />
            {Object.entries(stats.by_tier).map(([tier, count]) => (
              <StatCard key={tier} label={`${tier} tier`} value={count} />
            ))}
          </div>
        )}

        <div className="mb-4 flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            placeholder="Search by email or name…"
            className="w-full max-w-sm rounded-[10px] border border-c-border bg-surface-2 px-4 py-2.5 text-[13px] text-c-text placeholder-c-text-muted outline-none focus:border-[#ff3d6a]/40"
          />
        </div>

        <div className="overflow-x-auto rounded-[12px] border border-c-border bg-surface-2">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-c-border text-[11px] uppercase tracking-[.06em] text-c-text-muted">
                <th className="cursor-pointer px-4 py-3" onClick={() => toggleSort("email")}>Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Active</th>
                <th className="cursor-pointer px-4 py-3" onClick={() => toggleSort("created_at")}>Signed up</th>
                <th className="cursor-pointer px-4 py-3" onClick={() => toggleSort("last_login_at")}>Last active</th>
                <th className="px-4 py-3">Change tier</th>
                {isSuperadmin && <th className="px-4 py-3">Admin access</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={isSuperadmin ? 9 : 8} className="px-4 py-6 text-center text-c-text-muted">Loading…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={isSuperadmin ? 9 : 8} className="px-4 py-6 text-center text-c-text-muted">No users found.</td></tr>
              )}
              {!loading && users.map((u) => (
                <tr key={u.id} className="border-b border-c-border/60 last:border-0">
                  <td className="px-4 py-3 text-c-text">{u.email}{u.is_admin && <span className="ml-1.5 text-[10px] text-[#ff3d6a]">ADMIN</span>}</td>
                  <td className="px-4 py-3 text-c-text-secondary">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-3"><Badge tone={u.tier === "free" ? "gray" : "green"}>{u.tier}</Badge></td>
                  <td className="px-4 py-3">
                    <Badge tone={u.subscription_status === "active" ? "green" : u.subscription_status ? "red" : "gray"}>
                      {u.subscription_status ?? "no subscription"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><Badge tone={u.is_active ? "green" : "red"}>{u.is_active ? "active" : "disabled"}</Badge></td>
                  <td className="px-4 py-3 text-c-text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-c-text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "never"}</td>
                  <td className="px-4 py-3">
                    <select
                      defaultValue=""
                      disabled={updatingId === u.id}
                      onChange={(e) => { if (e.target.value) handleTierChange(u.id, e.target.value); e.target.value = ""; }}
                      className="rounded-[8px] border border-c-border bg-surface-3 px-2 py-1.5 text-[12px] text-c-text outline-none disabled:opacity-50"
                    >
                      <option value="" disabled>{updatingId === u.id ? "Updating…" : "Set plan…"}</option>
                      {PLAN_OPTIONS.map((p) => (
                        <option key={p} value={p} disabled={p === u.tier}>{p}</option>
                      ))}
                    </select>
                  </td>
                  {isSuperadmin && (
                    <td className="px-4 py-3">
                      {u.id === meId ? (
                        <span className="text-c-text-muted">—</span>
                      ) : (
                        <button
                          disabled={updatingId === u.id}
                          onClick={() => handleAdminRoleToggle(u.id, !u.is_admin)}
                          className={cn(
                            "rounded-[8px] border px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-50",
                            u.is_admin
                              ? "border-red-500/20 bg-red-500/[.08] text-red-300 hover:bg-red-500/[.14]"
                              : "border-c-border bg-surface-3 text-c-text hover:bg-surface-2"
                          )}
                        >
                          {updatingId === u.id ? "Updating…" : u.is_admin ? "Revoke admin" : "Grant admin"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-[12.5px] text-c-text-muted">
          <span>{total} user{total === 1 ? "" : "s"} · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-[8px] border border-c-border px-3 py-1.5 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-[8px] border border-c-border px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
