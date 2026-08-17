import { useEffect, useState } from "react";
import { adminApi, ApiError, type AdminUserStats, type SignupTrendPoint, type BrainstormStatsResponse } from "@/lib/api";
import { navigate } from "@/lib/router";
import { SimpleLineChart } from "./charts/SimpleLineChart";
import { SimpleBarChart } from "./charts/SimpleBarChart";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[12px] border border-c-border bg-surface-2 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-c-text-muted">{label}</p>
      <p className="mt-1.5 font-display text-[26px] font-bold text-c-text">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-c-border bg-surface-2 p-5">
      <p className="mb-4 text-[13px] font-semibold text-c-text">{title}</p>
      {children}
    </div>
  );
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminUserStats | null>(null);
  const [signups, setSignups] = useState<SignupTrendPoint[]>([]);
  const [brainstorm, setBrainstorm] = useState<BrainstormStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([adminApi.me(), adminApi.userStats(), adminApi.signupTrend(30), adminApi.brainstormStats(30)])
      .then(([, s, trend, brainstormStats]) => {
        setStats(s);
        setSignups(trend.points);
        setBrainstorm(brainstormStats);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          navigate("/admin");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to load dashboard data");
      })
      .finally(() => setLoading(false));
  }, []);

  const signupTotal = signups.reduce((sum, p) => sum + p.count, 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[24px] font-bold text-c-text">Dashboard</h1>
        <p className="mt-1 text-[13px] text-c-text-muted">Overview of users, growth, and tier distribution</p>
      </div>

      {error && (
        <div className="mb-5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="text-[13px] text-c-text-muted">Loading…</p>}

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Total users" value={stats.total_users} />
          <StatCard label="Active users" value={stats.active_users} />
          <StatCard label="Paid users" value={stats.paid_users} />
          {Object.entries(stats.by_tier).map(([tier, count]) => (
            <StatCard key={tier} label={`${tier} tier`} value={count} />
          ))}
        </div>
      )}

      {brainstorm && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Brainstorm sessions" value={brainstorm.total_sessions} />
          <StatCard label="Converted to video" value={brainstorm.converted_sessions} />
          <StatCard
            label="Conversion rate"
            value={brainstorm.conversion_rate == null ? "no data yet" : `${Math.round(brainstorm.conversion_rate * 100)}% converted to video`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={`Signups — last 30 days (${signupTotal} total)`}>
          {signups.length > 0 ? (
            <SimpleLineChart points={signups.map((p) => ({ label: p.date, value: p.count }))} />
          ) : (
            <p className="text-[12.5px] text-c-text-muted">No signup data yet.</p>
          )}
        </Panel>

        <Panel title="Users per tier">
          {stats ? (
            <SimpleBarChart bars={Object.entries(stats.by_tier).map(([tier, count]) => ({ label: tier, value: count }))} />
          ) : (
            <p className="text-[12.5px] text-c-text-muted">No tier data yet.</p>
          )}
        </Panel>

        <Panel title={`Brainstorm sessions — last 30 days (${brainstorm?.trend.reduce((sum, p) => sum + p.count, 0) ?? 0} total)`}>
          {brainstorm && brainstorm.trend.length > 0 ? (
            <SimpleLineChart points={brainstorm.trend.map((p) => ({ label: p.date, value: p.count }))} />
          ) : (
            <p className="text-[12.5px] text-c-text-muted">No brainstorm session data yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
