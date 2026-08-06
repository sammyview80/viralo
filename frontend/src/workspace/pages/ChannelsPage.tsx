import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { channelsApi, type ChannelSubscription, type ChannelVideo, type AutoPublishConfig, DEFAULT_AUTO_PUBLISH_CONFIG } from "@/lib/api";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

const ASPECT_RATIOS = ["9:16", "1:1", "16:9", "4:5"];
const PLATFORM_OPTIONS = ["tiktok", "instagram", "youtube", "twitter", "linkedin", "facebook"];

function AutoPublishForm({
  config,
  onChange,
}: {
  config: AutoPublishConfig;
  onChange: (c: AutoPublishConfig) => void;
}) {
  function set<K extends keyof AutoPublishConfig>(key: K, val: AutoPublishConfig[K]) {
    onChange({ ...config, [key]: val });
  }

  function togglePlatform(p: string) {
    const has = config.platforms.includes(p);
    set("platforms", has ? config.platforms.filter((x) => x !== p) : [...config.platforms, p]);
  }

  return (
    <div className="space-y-3 rounded-[11px] border border-blue-500/20 bg-blue-500/[.04] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[.1em] text-blue-400">Auto-Publish Config</p>

      {/* Clips + aspect ratio */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-c-text-muted">Clips per video</label>
          <input
            type="number" min={1} max={10} value={config.num_clips}
            onChange={(e) => set("num_clips", parseInt(e.target.value) || 4)}
            className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text outline-none focus:border-blue-500/40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-c-text-muted">Aspect ratio</label>
          <select
            value={config.aspect_ratio}
            onChange={(e) => set("aspect_ratio", e.target.value)}
            className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text outline-none"
          >
            {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Publish per day + interval */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-c-text-muted">Posts per day</label>
          <input
            type="number" min={1} max={20} value={config.publish_per_day}
            onChange={(e) => set("publish_per_day", parseInt(e.target.value) || 3)}
            className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text outline-none focus:border-blue-500/40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-c-text-muted">Interval (hours)</label>
          <input
            type="number" min={1} max={24} value={config.publish_interval_hours}
            onChange={(e) => set("publish_interval_hours", parseInt(e.target.value) || 8)}
            className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text outline-none focus:border-blue-500/40"
          />
        </div>
      </div>

      {/* Clip duration */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-c-text-muted">Min clip (sec)</label>
          <input
            type="number" min={10} max={300} value={config.min_clip_duration}
            onChange={(e) => set("min_clip_duration", parseInt(e.target.value) || 30)}
            className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text outline-none focus:border-blue-500/40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-c-text-muted">Max clip (sec)</label>
          <input
            type="number" min={10} max={300} value={config.max_clip_duration}
            onChange={(e) => set("max_clip_duration", parseInt(e.target.value) || 60)}
            className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text outline-none focus:border-blue-500/40"
          />
        </div>
      </div>

      {/* Platforms */}
      <div>
        <label className="mb-1.5 block text-[10px] text-c-text-muted">Publish to</label>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORM_OPTIONS.map((p) => (
            <button
              key={p} type="button"
              onClick={() => togglePlatform(p)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition",
                config.platforms.includes(p)
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                  : "border-c-border bg-surface-1 text-c-text-muted hover:text-c-text-secondary"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Caption template */}
      <div>
        <label className="mb-1 block text-[10px] text-c-text-muted">Caption template</label>
        <input
          type="text" value={config.caption_template}
          onChange={(e) => set("caption_template", e.target.value)}
          placeholder="#viral #shorts"
          className="h-8 w-full rounded-[7px] border border-c-border bg-surface-1 px-2 text-[12px] text-c-text placeholder:text-c-text-muted outline-none focus:border-blue-500/40"
        />
      </div>

      {/* Burn captions */}
      <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-c-text-secondary">
        <input type="checkbox" checked={config.burn_captions} onChange={(e) => set("burn_captions", e.target.checked)} className="h-3.5 w-3.5 rounded accent-blue-500" />
        Burn captions into clips
      </label>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatNum(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function expiryState(iso: string | null): "expired" | "soon" | "ok" {
  if (!iso) return "ok";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "expired";
  if (diff < 1000 * 60 * 60 * 24 * 7) return "soon";
  return "ok";
}

function avatarGradient(seed: string) {
  const gradients = [
    "from-pink-500 to-fuchsia-700",
    "from-blue-500 to-cyan-600",
    "from-emerald-500 to-teal-700",
    "from-amber-500 to-orange-600",
    "from-violet-500 to-purple-700",
    "from-rose-500 to-pink-700",
  ];
  let n = 0;
  for (const ch of seed) n += ch.charCodeAt(0);
  return gradients[n % gradients.length];
}

/* ─── Add channel modal ─── */
function AddChannelModal({ onClose, onSuccess, initialUrl }: { onClose: () => void; onSuccess: () => void; initialUrl?: string }) {
  const [urlInput, setUrlInput] = useState(initialUrl ?? "");
  const [autoPublish, setAutoPublish] = useState(false);
  const [apConfig, setApConfig] = useState<AutoPublishConfig>({ ...DEFAULT_AUTO_PUBLISH_CONFIG });
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{ channel_id: string; channel_name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleResolve() {
    if (!urlInput.trim()) return;
    setResolving(true); setErr(null); setResolved(null);
    try {
      const r = await channelsApi.resolve(urlInput.trim());
      setResolved(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not resolve channel");
    } finally { setResolving(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) { setErr("Channel URL or ID is required"); return; }
    setLoading(true); setErr(null);
    try {
      await channelsApi.subscribe({
        channel_id: urlInput.trim(),
        channel_url: urlInput.trim(),
        auto_publish: autoPublish,
        auto_publish_config: autoPublish ? apConfig : undefined,
      });
      onSuccess();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to subscribe");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[480px] max-h-[90vh] overflow-y-auto rounded-[18px] border border-c-border bg-surface-1 pb-[max(env(safe-area-inset-bottom),4rem)] shadow-[0_32px_80px_rgba(0,0,0,.6)]"
        style={{ animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}>
        <div className="flex items-center justify-between border-b border-c-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold text-c-text">Add Channel</h2>
            <p className="mt-0.5 text-[11px] text-c-text-muted">Subscribe to a YouTube channel to monitor it</p>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full text-c-text-muted transition hover:bg-surface-2 hover:text-c-text">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 p-5 [&_input,&_select,&_textarea]:scroll-mb-16">
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setResolved(null); }}
              onBlur={handleResolve}
              placeholder="https://youtube.com/@MrBeast or UCxxxxxx"
              className="h-10 flex-1 rounded-[9px] border border-c-border bg-surface-1 px-3 text-[13px] text-c-text placeholder:text-c-text-muted focus:border-[#ff3d6a]/40 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20"
            />
            <button type="button" onClick={handleResolve} disabled={resolving || !urlInput.trim()}
              className="h-10 rounded-[9px] border border-c-border bg-surface-2 px-3 text-[12.5px] font-medium text-c-text-muted transition hover:bg-surface-3 hover:text-c-text disabled:opacity-40">
              {resolving ? "…" : "Verify"}
            </button>
          </div>

          {resolved && (
            <div className="flex items-center gap-3 rounded-[10px] border border-green-500/20 bg-green-500/[.06] px-4 py-2.5">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br ${avatarGradient(resolved.channel_name || resolved.channel_id)} text-[14px] font-bold text-white`}>
                {(resolved.channel_name || resolved.channel_id).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-c-text">{resolved.channel_name || resolved.channel_id}</p>
                <p className="truncate font-mono text-[10px] text-c-text-muted">{resolved.channel_id}</p>
              </div>
              <span className="rounded-full border border-green-500/25 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-400">Verified</span>
            </div>
          )}

          <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-c-text-secondary">
            <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} className="h-4 w-4 rounded accent-[#ff3d6a]" />
            Auto-publish clips from this channel
          </label>

          {autoPublish && (
            <AutoPublishForm config={apConfig} onChange={setApConfig} />
          )}

          {err && <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading || resolving}
              className="h-10 flex-1 rounded-[10px] bg-[#ff3d6a] text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#e8304f] disabled:opacity-50">
              {loading ? "Subscribing…" : "Subscribe"}
            </button>
            <button type="button" onClick={onClose}
              className="h-10 rounded-[10px] border border-c-border bg-surface-2 px-4 text-[13px] text-c-text-muted transition hover:text-c-text">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Channel card ─── */
function ChannelCard({ channel, selected, onClick }: { channel: ChannelSubscription; selected: boolean; onClick: () => void }) {
  const name = channel.channel_name ?? channel.channel_id;
  const expiry = expiryState(channel.lease_expires_at);

  return (
    <button
      onClick={onClick}
      className={cn(
        "group w-full overflow-hidden rounded-[14px] border text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,.32)]",
        selected
          ? "border-[#ff3d6a]/45 bg-surface-1 shadow-[0_0_0_1px_rgba(255,61,106,.12)]"
          : "border-c-border bg-surface-1 hover:border-c-border-hover"
      )}
    >
      {/* Avatar banner */}
      <div className={`relative h-[68px] w-full bg-gradient-to-br ${avatarGradient(name)}`}>
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <span className={cn(
          "absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
          channel.active ? "bg-green-500/25 text-green-400" : "bg-black/40 text-zinc-400"
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", channel.active ? "bg-green-400" : "bg-zinc-500")} />
          {channel.active ? "Active" : "Inactive"}
        </span>
        <div className={`absolute -bottom-5 left-4 grid h-10 w-10 place-items-center rounded-[11px] border-2 border-surface-1 bg-gradient-to-br ${avatarGradient(name)} text-[16px] font-bold text-white shadow-lg`}>
          {name.charAt(0).toUpperCase()}
        </div>
      </div>

      <div className="px-4 pb-4 pt-7">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-c-text">{name}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-c-text-muted">{channel.channel_id}</p>
          </div>
          {channel.auto_publish && (
            <span className="shrink-0 rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">AUTO</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-c-text-muted">
            {expiry === "expired" ? <span className="text-red-400">Expired</span>
              : expiry === "soon" ? <span className="text-amber-400">Exp {formatDate(channel.lease_expires_at)}</span>
              : <span className="text-c-text-muted">{formatDate(channel.lease_expires_at)}</span>}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-c-text-muted">{relativeTime(channel.last_notified_at)}</span>
          <span className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.07] px-2 py-0.5 font-medium text-[#ff3d6a]/80">Creator</span>
        </div>
      </div>
    </button>
  );
}

/* ─── Skeleton card ─── */
function ChannelCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-c-border bg-surface-1">
      <Skeleton className="h-[68px] w-full bg-surface-glass" />
      <div className="space-y-2 px-4 pb-4 pt-7">
        <Skeleton className="h-4 w-3/4 bg-surface-glass" />
        <Skeleton className="h-3 w-1/2 bg-surface-glass" />
        <div className="flex gap-2 mt-3">
          <Skeleton className="h-5 w-16 rounded-full bg-surface-glass" />
          <Skeleton className="h-5 w-20 rounded-full bg-surface-glass" />
        </div>
      </div>
    </div>
  );
}

/* ─── Video list skeleton ─── */
function VideoSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[10px] border border-c-border bg-surface-1 p-2.5">
          <Skeleton className="h-[52px] w-[88px] shrink-0 rounded-[8px] bg-surface-glass" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4 bg-surface-glass" />
            <Skeleton className="h-2.5 w-1/2 bg-surface-glass" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Single video row ─── */
function VideoCard({ v, rank, showRank }: { v: ChannelVideo; rank?: number; showRank?: boolean }) {
  const dur = parseDuration(v.duration);
  return (
    <div className={cn(
      "group flex items-center gap-3 rounded-[10px] border bg-surface-1 p-2.5 transition",
      v.already_clipped
        ? "border-amber-500/20 hover:border-amber-500/30"
        : "border-c-border hover:border-c-border-hover hover:bg-surface-2"
    )}>
      {/* Rank badge */}
      {showRank && rank && rank <= 3 && (
        <span className="shrink-0 text-[13px]">{["🥇","🥈","🥉"][rank - 1]}</span>
      )}
      {showRank && rank && rank > 3 && (
        <span className="w-4 shrink-0 text-center text-[10px] font-bold text-c-text-muted">#{rank}</span>
      )}

      {/* Thumbnail */}
      <div className="relative h-[52px] w-[88px] shrink-0 overflow-hidden rounded-[8px] bg-zinc-900">
        <img src={v.thumbnail} alt={v.title} className="h-full w-full object-cover" loading="lazy" />
        {dur && (
          <span className="absolute bottom-0.5 right-0.5 rounded-[4px] bg-black/75 px-1 py-0.5 text-[9px] font-bold text-white">
            {dur}
          </span>
        )}
        <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
          <span className="text-white text-sm">▶</span>
        </div>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <p className="line-clamp-2 flex-1 text-[12px] font-medium leading-[1.35] text-c-text">{v.title}</p>
          {v.already_clipped && (
            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
              Clipped
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-c-text-muted">
          <span>{formatNum(v.views)} views</span>
          {v.likes && <span>· {formatNum(v.likes)} likes</span>}
          <span>· {formatDate(v.published)}</span>
        </div>
      </div>

      {/* Clip button */}
      <button
        onClick={() => navigate(`/studio?type=youtube&url=${encodeURIComponent(v.url)}`)}
        className={cn(
          "shrink-0 rounded-[8px] border px-2.5 py-1.5 text-[11px] font-medium transition",
          v.already_clipped
            ? "border-amber-500/20 bg-amber-500/[.06] text-amber-500 hover:bg-amber-500/10"
            : "border-c-border bg-surface-2 text-c-text-muted hover:border-[#ff3d6a]/30 hover:bg-[#ff3d6a]/10 hover:text-[#ff3d6a]"
        )}
      >
        {v.already_clipped ? "Re-clip ↗" : "Clip ↗"}
      </button>
    </div>
  );
}

/* ─── Duration ISO 8601 parser ─── */
function parseDuration(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] ?? "0");
  const min = parseInt(m[2] ?? "0");
  const sec = parseInt(m[3] ?? "0");
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/* ─── Right detail panel ─── */
function ChannelDetailPanel({ channel, onUnsubscribe, onRefresh }: {
  channel: ChannelSubscription;
  onUnsubscribe: (id: string) => void;
  onRefresh: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [apEnabled, setApEnabled] = useState(channel.auto_publish);
  const [apConfig, setApConfig] = useState<AutoPublishConfig>(
    channel.auto_publish_config ?? { ...DEFAULT_AUTO_PUBLISH_CONFIG }
  );
  const [tab, setTab] = useState<"top" | "recent">("top");
  const [orderBy, setOrderBy] = useState<"viewCount" | "date" | "rating">("viewCount");
  const [hideClipped, setHideClipped] = useState(false);

  const [topVideos, setTopVideos] = useState<ChannelVideo[]>([]);
  const [topLoading, setTopLoading] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);

  const [recentVideos, setRecentVideos] = useState<ChannelVideo[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentErr, setRecentErr] = useState<string | null>(null);

  const name = channel.channel_name ?? channel.channel_id;
  const expiry = expiryState(channel.lease_expires_at);

  useEffect(() => {
    setTopVideos([]); setTopErr(null); setTopLoading(true);
    channelsApi.topVideos(channel.channel_id, orderBy)
      .then((res) => setTopVideos(res.videos ?? []))
      .catch((e: unknown) => setTopErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setTopLoading(false));
  }, [channel.channel_id, orderBy]);

  useEffect(() => {
    if (tab !== "recent") return;
    setRecentVideos([]); setRecentErr(null); setRecentLoading(true);
    channelsApi.recentVideos(channel.channel_id)
      .then((res) => setRecentVideos(res.videos ?? []))
      .catch((e: unknown) => setRecentErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setRecentLoading(false));
  }, [channel.channel_id, tab]);

  async function handleUnsubscribe() {
    setRemoving(true);
    try { await channelsApi.unsubscribe(channel.channel_id); onUnsubscribe(channel.id); }
    catch { setRemoving(false); }
  }

  async function handleRenew() {
    setRenewing(true);
    try {
      await channelsApi.subscribe({
        channel_id: channel.channel_id,
        channel_name: channel.channel_name ?? undefined,
        channel_url: channel.channel_url ?? undefined,
        auto_publish: channel.auto_publish,
        auto_publish_config: channel.auto_publish_config ?? undefined,
      });
      onRefresh();
    } finally { setRenewing(false); }
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    try {
      await channelsApi.update(channel.channel_id, {
        auto_publish: apEnabled,
        auto_publish_config: apConfig,
      });
      setEditingConfig(false);
      onRefresh();
    } finally { setSavingConfig(false); }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-c-border px-5 py-5">
        <div className="flex items-start gap-3">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br ${avatarGradient(name)} text-[18px] font-bold text-white shadow-lg`}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-bold text-c-text truncate">{name}</p>
              <span className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                channel.active
                  ? "border-green-500/25 bg-green-500/10 text-green-400"
                  : "border-c-border bg-surface-2 text-c-text-muted"
              )}>
                {channel.active ? "● Active" : "● Inactive"}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-c-text-muted">{channel.channel_id}</p>
          </div>
        </div>

        {/* Stat grid */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {([
            ["Category", <span key="cat" className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2 py-0.5 text-[11px] font-bold text-[#ff3d6a]">Creator</span>],
            ["Auto-pub", channel.auto_publish
              ? <span key="auto" className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold text-blue-400">On</span>
              : <span key="auto" className="text-[12px] text-c-text-muted">Off</span>],
            ["Expires", <span key="exp" className={expiry === "expired" ? "text-[12px] text-red-400" : expiry === "soon" ? "text-[12px] text-amber-400" : "text-[12px] text-c-text-secondary"}>{formatDate(channel.lease_expires_at)}</span>],
            ["Last ping", <span key="ping" className="text-[12px] text-c-text-secondary">{relativeTime(channel.last_notified_at)}</span>],
          ] as [string, React.ReactNode][]).map(([label, value]) => (
            <div key={label} className="rounded-[10px] border border-c-border bg-surface-1 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-c-text-muted">{label}</p>
              <div className="mt-1">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-publish config section */}
      <div className="border-b border-c-border px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[.1em] text-c-text-muted">Auto-Publish</p>
          <div className="flex items-center gap-2">
            {editingConfig ? (
              <>
                <button onClick={() => setEditingConfig(false)}
                  className="rounded-[7px] border border-c-border px-2.5 py-1 text-[11px] text-c-text-muted hover:text-c-text-secondary transition">
                  Cancel
                </button>
                <button onClick={handleSaveConfig} disabled={savingConfig}
                  className="rounded-[7px] bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition">
                  {savingConfig ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button onClick={() => setEditingConfig(true)}
                className="rounded-[7px] border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] text-c-text-muted hover:text-c-text transition">
                Edit
              </button>
            )}
          </div>
        </div>

        {editingConfig ? (
          <>
            <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-c-text-secondary">
              <input type="checkbox" checked={apEnabled} onChange={(e) => setApEnabled(e.target.checked)} className="h-3.5 w-3.5 rounded accent-[#ff3d6a]" />
              Enable auto-publish
            </label>
            {apEnabled && <AutoPublishForm config={apConfig} onChange={setApConfig} />}
          </>
        ) : (
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between text-c-text-muted">
              <span>Status</span>
              {apEnabled
                ? <span className="text-blue-400 font-medium">Enabled</span>
                : <span className="text-c-text-muted">Disabled</span>}
            </div>
            {apEnabled && (
              <>
                <div className="flex justify-between text-c-text-muted">
                  <span>Clips</span><span className="text-c-text-secondary">{apConfig.num_clips} · {apConfig.aspect_ratio}</span>
                </div>
                <div className="flex justify-between text-c-text-muted">
                  <span>Per day</span><span className="text-c-text-secondary">{apConfig.publish_per_day} posts · every {apConfig.publish_interval_hours}h</span>
                </div>
                <div className="flex justify-between text-c-text-muted">
                  <span>Clip length</span><span className="text-c-text-secondary">{apConfig.min_clip_duration}–{apConfig.max_clip_duration}s</span>
                </div>
                {apConfig.platforms.length > 0 && (
                  <div className="flex justify-between text-c-text-muted">
                    <span>Platforms</span>
                    <span className="text-c-text-secondary capitalize">{apConfig.platforms.join(", ")}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Videos tabs */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar + controls */}
        <div className="flex items-center gap-2 border-b border-c-border px-5 py-2.5">
          <div className="flex rounded-[8px] border border-c-border bg-surface-1 p-0.5">
            {(["top", "recent"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-[6px] px-3 py-1 text-[11px] font-semibold transition",
                  tab === t ? "bg-[#ff3d6a] text-white shadow" : "text-c-text-muted hover:text-c-text-secondary"
                )}
              >
                {t === "top" ? "⚡ Top Videos" : "🕐 Recent"}
              </button>
            ))}
          </div>
          {tab === "top" && (
            <>
              <select
                value={orderBy}
                onChange={(e) => setOrderBy(e.target.value as "viewCount" | "date" | "rating")}
                className="ml-auto rounded-[7px] border border-c-border bg-surface-2 px-2 py-1 text-[11px] text-c-text-muted outline-none"
              >
                <option value="viewCount">Most Viewed</option>
                <option value="date">Newest</option>
                <option value="rating">Top Rated</option>
              </select>
              <button
                onClick={() => setHideClipped((p) => !p)}
                className={cn(
                  "rounded-[7px] border px-2.5 py-1 text-[10px] font-semibold transition",
                  hideClipped
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-c-border bg-surface-1 text-c-text-muted hover:text-c-text-secondary"
                )}
              >
                {hideClipped ? "✓ Hide Clipped" : "Hide Clipped"}
              </button>
            </>
          )}
        </div>

        {/* Video list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {tab === "top" ? (
            <>
              {topLoading ? (
                <VideoSkeleton />
              ) : topErr ? (
                <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{topErr}</p>
              ) : topVideos.length === 0 ? (
                <p className="text-[12px] text-c-text-muted">No videos found.</p>
              ) : (
                <div className="space-y-2">
                  {topVideos
                    .filter((v) => !hideClipped || !v.already_clipped)
                    .map((v, idx) => (
                      <VideoCard key={v.video_id} v={v} rank={idx + 1} showRank />
                    ))}
                </div>
              )}
            </>
          ) : (
            <>
              {recentLoading ? (
                <VideoSkeleton />
              ) : recentErr ? (
                <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{recentErr}</p>
              ) : recentVideos.length === 0 ? (
                <p className="text-[12px] text-c-text-muted">No recent videos found.</p>
              ) : (
                <div className="space-y-2">
                  {recentVideos.map((v) => (
                    <VideoCard key={v.video_id} v={v} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2 border-t border-c-border px-5 py-4">
        <button onClick={handleRenew} disabled={renewing}
          className="w-full rounded-[10px] bg-[#ff3d6a] py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.25)] transition hover:bg-[#e8304f] disabled:opacity-50">
          {renewing ? "Renewing…" : "↻ Renew Subscription"}
        </button>
        <button onClick={handleUnsubscribe} disabled={removing}
          className="w-full rounded-[10px] border border-red-500/20 bg-red-500/[.06] py-2.5 text-[13px] font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50">
          {removing ? "Removing…" : "Remove Channel"}
        </button>
      </div>
    </div>
  );
}

/* ─── Page ─── */
export default function ChannelsPage() {
  const params = new URLSearchParams(window.location.search);
  const initialChannelUrl = params.get("channel_url") ?? undefined;
  const redirectQuery = params.get("q") ?? undefined;

  const [channels, setChannels] = useState<ChannelSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!!initialChannelUrl);
  const [search, setSearch] = useState("");
  const [success, setSuccess] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "auto" | "soon" | "expired">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await channelsApi.list();
      setChannels(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load channels");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function redirectBack() {
    if (redirectQuery) {
      navigate(`/trending?q=${encodeURIComponent(redirectQuery)}`);
    }
  }

  function handleSuccess() {
    setShowForm(false); setSuccess(true);
    load();
    setTimeout(() => { setSuccess(false); redirectBack(); }, 1500);
  }

  function handleModalClose() {
    setShowForm(false);
    redirectBack();
  }

  function handleUnsubscribe(id: string) {
    setChannels((prev) => prev.filter((c) => c.id !== id));
    setSelectedId(null);
  }

  const counts = {
    total: channels.length,
    active: channels.filter((c) => c.active).length,
    inactive: channels.filter((c) => !c.active).length,
    auto: channels.filter((c) => c.auto_publish).length,
    soon: channels.filter((c) => expiryState(c.lease_expires_at) === "soon").length,
    expired: channels.filter((c) => expiryState(c.lease_expires_at) === "expired").length,
  };

  const filtered = channels.filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || (c.channel_name ?? "").toLowerCase().includes(q) || c.channel_id.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (filter === "active") return c.active;
    if (filter === "inactive") return !c.active;
    if (filter === "auto") return c.auto_publish;
    if (filter === "soon") return expiryState(c.lease_expires_at) === "soon";
    if (filter === "expired") return expiryState(c.lease_expires_at) === "expired";
    return true;
  });

  const selectedChannel = channels.find((c) => c.id === selectedId) ?? null;

  const filterItems: Array<[typeof filter, string, number]> = [
    ["all", "All", counts.total],
    ["active", "Active", counts.active],
    ["inactive", "Inactive", counts.inactive],
    ["auto", "Auto-pub", counts.auto],
    ["soon", "Expiring soon", counts.soon],
    ["expired", "Expired", counts.expired],
  ];

  return (
    <>
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[18px] border border-c-border bg-surface-0 shadow-[0_18px_80px_rgba(0,0,0,.28)]">

        {/* Header */}
        <div className="border-b border-c-border bg-surface-1/95 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Title */}
            <div className="mr-2">
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-bold tracking-[-.02em] text-c-text">Channels</h1>
                <span className="rounded-full border border-c-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-c-text-muted">
                  {loading ? "…" : counts.total}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-c-text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,.7)]" />
                Monitor YouTube channels and clip new uploads.
              </p>
            </div>

            {/* Search */}
            <div className="relative min-w-[200px] flex-1 lg:max-w-[380px]">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-c-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search channels…"
                className="h-10 w-full rounded-[11px] border border-c-border bg-surface-1 pl-9 pr-3 text-[13px] text-c-text placeholder:text-c-text-muted focus:border-[#ff3d6a]/30 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20 transition"
              />
            </div>

            {/* Filter pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {filterItems.map(([id, label, count]) => (
                <button key={id} onClick={() => setFilter(id)}
                  className={cn(
                    "shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition cursor-pointer",
                    filter === id
                      ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-rose-100"
                      : "border-c-border bg-surface-2 text-c-text-muted hover:border-c-border-hover hover:text-c-text-secondary"
                  )}>
                  {label}
                  <span className={cn(
                    "rounded-full px-1.5 py-px font-mono text-[10px]",
                    filter === id ? "bg-[#ff3d6a]/20 text-rose-200" : "bg-surface-3 text-c-text-muted"
                  )}>{count}</span>
                </button>
              ))}
            </div>

            {/* Right actions */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button onClick={load} disabled={loading} aria-label="Refresh"
                className="grid h-9 w-9 place-items-center rounded-[9px] border border-c-border bg-surface-2 text-c-text-muted transition hover:bg-surface-3 hover:text-c-text disabled:opacity-40">
                <svg className={cn("h-4 w-4", loading && "animate-spin")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              </button>
              <button onClick={() => setShowForm(true)}
                className="h-9 rounded-[10px] bg-[#ff3d6a] px-4 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#e8304f]">
                + Add Channel
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Grid area */}
          <div className="flex-1 overflow-y-auto p-5">
            {success && (
              <div className="mb-4 rounded-[10px] border border-green-500/20 bg-green-500/[.07] px-4 py-2.5 text-[12.5px] text-green-400">
                Channel subscribed successfully.
              </div>
            )}
            {error && (
              <div className="mb-4 rounded-[10px] border border-red-500/20 bg-red-500/[.07] px-4 py-2.5 text-[12.5px] text-red-400">
                {error}
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                {[...Array(6)].map((_, i) => <ChannelCardSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 text-2xl">▶</div>
                <h3 className="mb-2 text-[17px] font-bold text-c-text">
                  {channels.length === 0 ? "No channels yet" : "No channels match"}
                </h3>
                <p className="mb-7 max-w-sm text-[13px] leading-6 text-c-text-muted">
                  {channels.length === 0
                    ? "Add a YouTube channel and Viralo will monitor new uploads for clipping."
                    : "Try a different filter or clear your search."}
                </p>
                {channels.length === 0 ? (
                  <button onClick={() => setShowForm(true)}
                    className="rounded-[10px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#e8304f]">
                    Add Your First Channel
                  </button>
                ) : (
                  <button onClick={() => { setSearch(""); setFilter("all"); }} className="text-[13px] text-c-text-muted hover:text-c-text-secondary">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((ch) => (
                  <ChannelCard
                    key={ch.id}
                    channel={ch}
                    selected={selectedId === ch.id}
                    onClick={() => setSelectedId(selectedId === ch.id ? null : ch.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div
            className={cn(
              "border-l border-c-border bg-surface-0 transition-[width] duration-200 overflow-hidden",
              selectedChannel ? "w-[340px] xl:w-[360px]" : "w-0"
            )}
            style={{ position: "sticky", top: 0, height: "calc(100vh - 180px)" }}
          >
            {selectedChannel && (
              <ChannelDetailPanel
                key={selectedChannel.id}
                channel={selectedChannel}
                onUnsubscribe={handleUnsubscribe}
                onRefresh={load}
              />
            )}
          </div>
        </div>
      </div>

      {showForm && <AddChannelModal onClose={handleModalClose} onSuccess={handleSuccess} initialUrl={initialChannelUrl} />}
    </>
  );
}
