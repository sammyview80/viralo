import { useEffect, useState } from "react";
import { adminApi, ApiError, type RevenueSummaryResponse } from "@/lib/api";
import { navigate } from "@/lib/router";
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

function usd(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AdminRevenuePage() {
  const [data, setData] = useState<RevenueSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    adminApi
      .revenueSummary()
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          navigate("/admin");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to load revenue data");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[24px] font-bold text-c-text">Revenue</h1>
        <p className="mt-1 text-[13px] text-c-text-muted">MRR, tier breakdown, and subscription movement</p>
      </div>

      {error && (
        <div className="mb-5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="text-[13px] text-c-text-muted">Loading…</p>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="MRR" value={usd(data.mrr)} />
            <StatCard label="Upgrades (30d)" value={data.upgrades_last_30d ?? "n/a"} />
            <StatCard label="Downgrades (30d)" value={data.downgrades_last_30d ?? "n/a"} />
            <StatCard label="Cancellations (30d)" value={data.cancellations_last_30d} />
          </div>

          <div className="mb-6 rounded-[10px] border border-amber-500/20 bg-amber-500/[.08] px-4 py-3 text-[12.5px] text-amber-300">
            {data.change_tracking_note}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="MRR by tier">
              <SimpleBarChart bars={data.by_tier.map((t) => ({ label: t.tier, value: t.mrr }))} />
            </Panel>

            <Panel title="Subscribers by tier">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-c-border text-[11px] uppercase tracking-[.06em] text-c-text-muted">
                    <th className="py-2 pr-4">Tier</th>
                    <th className="py-2 pr-4">Subscribers</th>
                    <th className="py-2 pr-4">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_tier.map((t) => (
                    <tr key={t.tier} className="border-b border-c-border/60 last:border-0">
                      <td className="py-2 pr-4 text-c-text">{t.tier}</td>
                      <td className="py-2 pr-4 text-c-text-muted">{t.subscriber_count}</td>
                      <td className="py-2 pr-4 text-c-text-muted">{usd(t.mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
