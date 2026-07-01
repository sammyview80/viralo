import { useState, useEffect } from "react";
import { platformApi, AnalyticsOverview, PostAnalytics } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { Pagination } from "../components/Pagination";

type Period = "7d" | "30d" | "90d";

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "X",
  tt: "TikTok",
  ig: "Instagram",
  yt: "YouTube",
  tw: "X",
};

function platformLabel(p: string) {
  return PLATFORM_LABELS[p.toLowerCase()] ?? p;
}

function platformColor(p: string): string {
  const key = p.toLowerCase();
  if (key === "tiktok" || key === "tt") return "#010101";
  if (key === "instagram" || key === "ig") return "#e1306c";
  if (key === "youtube" || key === "yt") return "#ff0000";
  if (key === "twitter" || key === "tw" || key === "x") return "#1da1f2";
  return "#666";
}

function viralityColor(score: number | null): string {
  if (score === null) return "#6b7280";
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#eab308";
  return "#ef4444";
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-c-border bg-surface-2 p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#ff3d6a]/10 text-lg">
        {icon}
      </div>
      <div className="font-display text-2xl font-bold tracking-[-0.02em]">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-c-text-muted">{sub}</div>}
      <div className="mt-1 text-xs font-medium text-c-text-muted">{label}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[14px] border border-c-border bg-surface-2 p-5 animate-pulse">
      <div className="mb-3 h-9 w-9 rounded-[10px] bg-surface-glass" />
      <div className="h-7 w-24 rounded bg-surface-glass" />
      <div className="mt-2 h-3 w-16 rounded bg-surface-glass" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-c-border">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3.5 rounded bg-surface-glass animate-pulse" style={{ width: `${50 + (i * 13) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

const PAGE_SIZE = 10;

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [page, setPage] = useState(1);

  const { data: overview, loading: loadingOverview, error: errorOverview } = useQuery(
    `analytics:overview:${period}`,
    () => platformApi.analyticsOverview(period),
    { ttl: 60_000 },
  );

  const { data: postsPage, loading: loadingPosts, error: errorPosts } = useQuery(
    `analytics:posts:${page}`,
    () => platformApi.analyticsPosts(page, PAGE_SIZE),
    { ttl: 60_000 },
  );

  const posts = postsPage?.items ?? [];
  const total = postsPage?.total ?? 0;

  const isEmpty = !loadingPosts && !errorPosts && posts.length === 0 && !loadingOverview && overview !== null && overview.posts_count === 0;

  return (
      <div className="space-y-6">
        {/* Header + period selector */}
        <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Analytics</h1>
          <div className="grid grid-cols-3 rounded-[10px] border border-c-border bg-surface-1 p-1 gap-1 sm:flex">
            {(["7d", "30d", "90d"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setPage(1); }}
                className={`rounded-[7px] px-4 py-1.5 text-xs font-semibold transition-colors ${
                  period === p
                    ? "bg-[#ff3d6a] text-white"
                    : "text-c-text-muted hover:text-c-text"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Overview stat cards */}
        {errorOverview ? (
          <div className="rounded-[14px] border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            Failed to load overview: {errorOverview}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {loadingOverview ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : overview ? (
              <>
                <StatCard icon="👁" label="Total Views" value={fmt(overview.total_views)} />
                <StatCard icon="❤" label="Total Likes" value={fmt(overview.total_likes)} />
                <StatCard
                  icon="%"
                  label="Engagement Rate"
                  value={`${overview.engagement_rate.toFixed(2)}%`}
                />
                <StatCard icon="📤" label="Posts Published" value={String(overview.posts_count)} />
              </>
            ) : null}
          </div>
        )}

        {/* Per-post table */}
        <div className="overflow-hidden rounded-[14px] border border-c-border bg-surface-1">
          <div className="flex flex-col gap-1 border-b border-c-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="font-display text-[15px] font-bold">Post Performance</span>
            {total > 0 && (
              <span className="text-xs text-c-text-muted">
                {total} post{total !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {errorPosts ? (
            <div className="p-6 text-sm text-red-400">Failed to load posts: {errorPosts}</div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="text-4xl">📊</div>
              <p className="font-semibold text-c-text-secondary">No analytics yet.</p>
              <p className="text-sm text-c-text-muted">Post your first clip to see data here.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-c-border text-left">
                      {["Platform", "Post ID", "Views", "Likes", "Engagement", "Virality", "Fetched At"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[.06em] text-c-text-muted"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingPosts
                      ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                      : posts.map((p) => (
                          <tr
                            key={p.scheduled_post_id}
                            className="border-b border-c-border transition-colors hover:bg-surface-glass"
                          >
                            <td className="px-4 py-3">
                              <span
                                className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                                style={{ background: platformColor(p.platform) }}
                              >
                                {platformLabel(p.platform)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-c-text-muted">
                              {p.platform_post_id.length > 14
                                ? `${p.platform_post_id.slice(0, 14)}…`
                                : p.platform_post_id}
                            </td>
                            <td className="px-4 py-3 font-semibold">{fmt(p.views)}</td>
                            <td className="px-4 py-3 font-semibold">{fmt(p.likes)}</td>
                            <td className="px-4 py-3 text-c-text-secondary">
                              {p.engagement_rate.toFixed(2)}%
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className="font-display text-base font-bold"
                                style={{ color: viralityColor(p.virality_score) }}
                              >
                                {p.virality_score !== null ? p.virality_score.toFixed(0) : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[11px] text-c-text-muted">
                              {new Date(p.fetched_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                perPage={PAGE_SIZE}
                total={total}
                itemLabel="posts"
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </div>
  );
}

