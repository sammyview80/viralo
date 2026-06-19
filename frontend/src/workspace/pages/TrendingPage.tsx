import { useState, useCallback, useEffect } from "react";

import { trendsApi, type VideoMeta, type TrendSearchResponse } from "@/lib/api";
import { navigate } from "@/lib/router";

// ── Icons ─────────────────────────────────────────────────────────────────────

function YTIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1C4.5 20.4 12 20.4 12 20.4s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden>
      <path d="M19.6 3.3A4.9 4.9 0 0 1 14.8 0h-3.6v16.4a2.9 2.9 0 1 1-2.1-2.8V10a6.5 6.5 0 1 0 5.7 6.4V8.3a8.4 8.4 0 0 0 4.8 1.5V6.2a4.9 4.9 0 0 1-4.8-2.9h4.8z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      className="size-3.5" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className="size-4" aria-hidden>
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`size-4 ${spinning ? "animate-spin" : ""}`} aria-hidden>
      <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className="size-4" aria-hidden>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_STYLES: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  youtube: { icon: <YTIcon />, label: "YouTube", color: "text-red-400 bg-red-500/10" },
  tiktok:  { icon: <TikTokIcon />, label: "TikTok", color: "text-pink-400 bg-pink-500/10" },
  web:     { icon: <GlobeIcon />, label: "Web", color: "text-blue-400 bg-blue-500/10" },
  instagram: { icon: <GlobeIcon />, label: "Instagram", color: "text-purple-400 bg-purple-500/10" },
};

const SUGGESTED = [
  "AI video tools 2025", "generative AI shorts", "AI fitness coach",
  "creator economy", "AI automation", "text to video AI",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtViews(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PlatformBadge({ platform }: { platform: string }) {
  const style = PLATFORM_STYLES[platform] ?? PLATFORM_STYLES.web;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.color}`}>
      {style.icon}{style.label}
    </span>
  );
}

// ── Video card ────────────────────────────────────────────────────────────────

function VideoCard({ video, rank, searchQuery }: { video: VideoMeta; rank?: number; searchQuery?: string }) {
  function handleClipIt(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const studioUrl = `/studio?type=${video.platform}&url=${encodeURIComponent(video.url)}`;
    window.location.href = studioUrl;
  }

  function handleSubscribe(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const channelUrl = video.channel_url ?? video.url;
    const params = new URLSearchParams();
    params.set("channel_url", channelUrl);
    if (searchQuery) params.set("q", searchQuery);
    navigate(`/channels?${params.toString()}`);
  }

  return (
    <div className="group/card relative">
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 rounded-xl border border-white/[.06] bg-white/[.03] p-3
                   transition hover:border-white/[.12] hover:bg-white/[.06]"
      >
        {/* Thumbnail */}
        <div className="relative shrink-0">
          <div className="size-20 overflow-hidden rounded-lg bg-white/[.06] sm:size-24">
            {video.thumbnail ? (
              <img src={video.thumbnail} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <div className="size-full" />
            )}
          </div>
          {video.duration_sec && (
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[10px] text-white">
              {fmtDuration(video.duration_sec)}
            </span>
          )}
          {rank !== undefined && (
            <span className="absolute -left-1 -top-1 flex size-5 items-center justify-center
                             rounded-full bg-[#ff3d6a] text-[10px] font-bold text-white shadow">
              {rank}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 pr-24 sm:pr-40">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-white/90
                        group-hover/card:text-white">
            {video.title}
          </p>
          {video.channel && (
            <p className="mt-0.5 truncate text-xs text-white/40">{video.channel}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PlatformBadge platform={video.platform} />
            {video.views && (
              <span className="text-xs text-white/50">{fmtViews(video.views)} views</span>
            )}
            {video.likes && (
              <span className="text-xs text-white/40">{fmtViews(video.likes)} likes</span>
            )}
          </div>
          {video.hashtags.length > 0 && (
            <p className="mt-1.5 line-clamp-1 text-xs text-[#ff3d6a]/70">
              {video.hashtags.slice(0, 5).map((h) => `#${h}`).join(" ")}
            </p>
          )}
        </div>
      </a>

      {/* Clean inline actions */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <button
          onClick={handleClipIt}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#ff3d6a]/25
                     bg-[#ff3d6a]/10 px-3 text-xs font-semibold text-[#ff6f91]
                     shadow-[0_8px_24px_rgba(255,61,106,.08)] transition
                     hover:border-[#ff3d6a]/45 hover:bg-[#ff3d6a]/18 hover:text-white"
        >
          <svg viewBox="0 0 16 16" className="size-3.5 fill-current" aria-hidden>
            <path d="M13.4 2.6a2 2 0 0 0-2.8 0L4 9.2 2 14l4.8-2 6.6-6.6a2 2 0 0 0 0-2.8zM5.9 11.1l-2 .8.8-2 5.3-5.3 1.2 1.2-5.3 5.3z" />
          </svg>
          Clip
        </button>
        {video.platform === "youtube" && (
          <button
            onClick={handleSubscribe}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[.08]
                       bg-white/[.04] px-2.5 text-xs font-medium text-white/55 transition
                       hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-300"
            title="Subscribe to channel"
          >
            <svg viewBox="0 0 16 16" className="size-3.5 fill-current" aria-hidden>
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm1 10H7V8H5l3-4 3 4H9v3z" />
            </svg>
            <span className="hidden sm:inline">Channel</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Hashtag pills ─────────────────────────────────────────────────────────────

function HashtagCloud({ tags, onSearch }: { tags: string[]; onSearch: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onSearch(`#${tag}`)}
          className="rounded-full border border-white/[.08] bg-white/[.04] px-3 py-1
                     text-xs text-white/60 transition hover:border-[#ff3d6a]/40
                     hover:bg-[#ff3d6a]/10 hover:text-[#ff3d6a]"
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}

// ── Platform tab ──────────────────────────────────────────────────────────────

type Tab = "all" | "youtube" | "tiktok" | "web";

function PlatformTabs({ active, onChange, counts }: {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: { youtube: number; tiktok: number; web: number; total: number };
}) {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.total },
    { id: "youtube", label: "YouTube", count: counts.youtube },
    { id: "tiktok", label: "TikTok", count: counts.tiktok },
    { id: "web", label: "Web", count: counts.web },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-white/[.06] bg-white/[.03] p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            active === t.id
              ? "bg-white/[.08] text-white"
              : "text-white/50 hover:text-white/70"
          }`}
        >
          {t.label}
          <span className={`rounded-full px-1.5 py-px text-[10px] ${
            active === t.id ? "bg-[#ff3d6a] text-white" : "bg-white/[.06] text-white/40"
          }`}>
            {t.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex gap-3 rounded-xl border border-white/[.06] bg-white/[.03] p-3">
      <div className="size-20 shrink-0 animate-pulse rounded-lg bg-white/[.06] sm:size-24" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/[.06]" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/[.06]" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-white/[.06]" />
      </div>
    </div>
  );
}

// ── AI Analysis ──────────────────────────────────────────────────────────────

function AiAnalysis({ analysis, onSearch }: {
  analysis: NonNullable<TrendSearchResponse["analysis"]>;
  onSearch: (t: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.055] p-4">
      <div className="flex items-center gap-2 text-[#ff3d6a]">
        <SparklesIcon />
        <span className="text-[11px] font-bold uppercase tracking-widest">AI Trend Analysis</span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-white/80">
        {analysis.insights}
      </p>
      {analysis.suggested_topics.length > 0 && (
        <div className="mt-4 border-t border-white/[.06] pt-4">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-white/30">
            Suggested related topics
          </p>
          <div className="flex flex-wrap gap-2">
            {analysis.suggested_topics.map((s) => (
              <button
                key={s}
                onClick={() => onSearch(s)}
                className="rounded-full border border-white/[.08] bg-white/[.04] px-3
                           py-1.5 text-xs text-white/60 transition hover:border-[#ff3d6a]/40
                           hover:bg-[#ff3d6a]/10 hover:text-[#ff3d6a]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendInsightRail({ result, onSearch }: {
  result: TrendSearchResponse;
  onSearch: (t: string) => void;
}) {
  const platformStats = [
    { label: "YouTube", count: result.summary.youtube_count, color: "text-red-400" },
    { label: "TikTok", count: result.summary.tiktok_count, color: "text-pink-400" },
    { label: "Web", count: result.summary.web_count, color: "text-blue-400" },
  ];

  return (
    <aside className="space-y-4 lg:sticky lg:top-6">
      {result.analysis ? (
        <AiAnalysis analysis={result.analysis} onSearch={onSearch} />
      ) : (
        <div className="rounded-xl border border-white/[.06] bg-white/[.03] p-4">
          <div className="flex items-center gap-2 text-white/70">
            <SparklesIcon />
            <span className="text-[11px] font-bold uppercase tracking-widest">AI Trend Analysis</span>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-white/45">
            Analysis is not available for this search yet. Refresh the trend scan to request a new read.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-white/[.06] bg-white/[.03] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/35">
            Platform mix
          </p>
          {result.from_cache && (
            <span className="rounded-full border border-white/[.06] px-2 py-0.5 text-[10px] text-white/35">
              cached
            </span>
          )}
        </div>
        <div className="space-y-2">
          {platformStats.map(({ label, count, color }) => (
            <div key={label} className="flex items-center justify-between rounded-lg bg-white/[.035] px-3 py-2">
              <span className="text-xs text-white/55">{label}</span>
              <span className={`text-sm font-bold ${color}`}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {result.common_hashtags.length > 0 && (
        <div className="rounded-xl border border-white/[.06] bg-white/[.03] p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/35">
            Trending hashtags
          </p>
          <HashtagCloud
            tags={result.common_hashtags.slice(0, 12)}
            onSearch={onSearch}
          />
        </div>
      )}
    </aside>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const HISTORY_KEY = "viralo:trending:history";
const MAX_HISTORY = 10;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function saveToHistory(q: string) {
  const prev = loadHistory().filter((h) => h.toLowerCase() !== q.toLowerCase());
  localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, MAX_HISTORY)));
}
function clearHistory() { localStorage.removeItem(HISTORY_KEY); }

export function TrendingPage() {
  const initialQuery = new URLSearchParams(window.location.search).get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrendSearchResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [history, setHistory] = useState<string[]>(loadHistory);

  const doSearch = useCallback(async (topic: string, forceRefresh = false) => {
    const t = topic.trim();
    if (!t) return;
    setQuery(t);
    setLoading(true);
    setError(null);
    setActiveTab("all");
    try {
      const res = await trendsApi.search(t, undefined, forceRefresh);
      setResult(res);
      saveToHistory(t);
      setHistory(loadHistory());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery) doSearch(initialQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Videos to show based on active tab
  const visibleVideos: VideoMeta[] = result
    ? activeTab === "all"
      ? result.top_by_views
      : activeTab === "youtube"
      ? result.youtube
      : activeTab === "tiktok"
      ? result.tiktok
      : result.web
    : [];

  return (
    <>
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-white">Trending</h1>
          <p className="mt-1 text-sm text-white/50">
            Discover viral AI videos across YouTube, TikTok, and the web.
          </p>
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">
              <SearchIcon />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
              placeholder="Search trending videos… e.g. AI tools 2025"
              className="h-11 w-full rounded-xl border border-white/[.08] bg-white/[.04]
                         pl-10 pr-4 text-sm text-white placeholder-white/30
                         outline-none transition focus:border-[#ff3d6a]/50 focus:bg-white/[.06]"
            />
          </div>
          <button
            onClick={() => doSearch(query)}
            disabled={loading || !query.trim()}
            className="flex h-11 items-center gap-2 rounded-xl bg-[#ff3d6a] px-5 text-sm
                       font-medium text-white shadow-lg transition hover:bg-[#ff3d6a]/90
                       disabled:opacity-40"
          >
            {loading ? <RefreshIcon spinning /> : <SearchIcon />}
            Search
          </button>
          {result && (
            <>
              <button
                onClick={() => doSearch(query, true)}
                disabled={loading}
                title="Force refresh — bypass cache"
                className="flex h-11 w-11 items-center justify-center rounded-xl border
                           border-white/[.08] bg-white/[.04] text-white/50 transition
                           hover:border-white/20 hover:text-white/80 disabled:opacity-40"
              >
                <RefreshIcon spinning={loading} />
              </button>
              <button
                onClick={() => { setResult(null); setQuery(""); }}
                title="Clear results"
                className="flex h-11 w-11 items-center justify-center rounded-xl border
                           border-white/[.08] bg-white/[.04] text-white/50 transition
                           hover:border-red-500/30 hover:text-red-400"
              >
                ✕
              </button>
            </>
          )}
        </div>

        {/* History + Suggestions */}
        {!result && !loading && (
          <div className="space-y-4">
            {history.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-white/30">Recent searches</p>
                  <button
                    onClick={() => { clearHistory(); setHistory([]); }}
                    className="text-[10px] text-white/30 transition hover:text-white/60"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {history.map((h) => (
                    <button
                      key={h}
                      onClick={() => doSearch(h)}
                      className="flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.04] px-3
                                 py-1.5 text-xs text-white/70 transition hover:border-[#ff3d6a]/40
                                 hover:bg-[#ff3d6a]/10 hover:text-[#ff3d6a]"
                    >
                      <span className="text-white/30">↺</span>{h}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/30">
                Suggested searches
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => doSearch(s)}
                    className="rounded-full border border-white/[.08] bg-white/[.04] px-3
                               py-1.5 text-xs text-white/60 transition hover:border-[#ff3d6a]/40
                               hover:bg-[#ff3d6a]/10 hover:text-[#ff3d6a]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-5">
              {/* Meta bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <PlatformTabs
                    active={activeTab}
                    onChange={setActiveTab}
                    counts={{
                      youtube: result.summary.youtube_count,
                      tiktok: result.summary.tiktok_count,
                      web: result.summary.web_count,
                      total: result.summary.total,
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span>{result.summary.total} videos found</span>
                </div>
              </div>

              {/* Video list */}
              {visibleVideos.length > 0 ? (
                <div className="space-y-2">
                  {visibleVideos.map((v, i) => (
                    <VideoCard
                      key={`${v.platform}-${v.video_id}-${i}`}
                      video={v}
                      rank={activeTab === "all" ? i + 1 : undefined}
                      searchQuery={query}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-white/40">
                  No {activeTab === "all" ? "" : activeTab + " "}results found.
                </p>
              )}
            </div>

            <div className="min-w-0">
              <TrendInsightRail
                result={result}
                onSearch={(t) => doSearch(t)}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
