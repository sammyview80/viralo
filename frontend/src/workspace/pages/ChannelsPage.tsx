import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Shell } from "../Shell";
import { channelsApi, type ChannelSubscription, type ChannelVideo } from "@/lib/api";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

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
function AddChannelModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [urlInput, setUrlInput] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
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
      await channelsApi.subscribe({ channel_id: urlInput.trim(), channel_url: urlInput.trim(), auto_publish: autoPublish });
      onSuccess();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to subscribe");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[460px] overflow-hidden rounded-[18px] border border-white/[.10] bg-[#0e1420] shadow-[0_32px_80px_rgba(0,0,0,.6)]"
        style={{ animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}>
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold text-white">Add Channel</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">Subscribe to a YouTube channel to monitor it</p>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[.06] hover:text-zinc-200">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 p-5">
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setResolved(null); }}
              onBlur={handleResolve}
              placeholder="https://youtube.com/@MrBeast or UCxxxxxx"
              className="h-10 flex-1 rounded-[9px] border border-white/[.08] bg-[#111827] px-3 text-[13px] text-white placeholder:text-zinc-600 focus:border-[#ff3d6a]/40 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20"
            />
            <button type="button" onClick={handleResolve} disabled={resolving || !urlInput.trim()}
              className="h-10 rounded-[9px] border border-white/[.08] bg-white/[.03] px-3 text-[12.5px] font-medium text-zinc-400 transition hover:bg-white/[.07] hover:text-white disabled:opacity-40">
              {resolving ? "…" : "Verify"}
            </button>
          </div>

          {resolved && (
            <div className="flex items-center gap-3 rounded-[10px] border border-green-500/20 bg-green-500/[.06] px-4 py-2.5">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br ${avatarGradient(resolved.channel_name || resolved.channel_id)} text-[14px] font-bold text-white`}>
                {(resolved.channel_name || resolved.channel_id).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">{resolved.channel_name || resolved.channel_id}</p>
                <p className="truncate font-mono text-[10px] text-zinc-500">{resolved.channel_id}</p>
              </div>
              <span className="rounded-full border border-green-500/25 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-400">Verified</span>
            </div>
          )}

          <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-zinc-300">
            <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} className="h-4 w-4 rounded accent-[#ff3d6a]" />
            Auto-publish clips from this channel
          </label>

          {err && <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading || resolving}
              className="h-10 flex-1 rounded-[10px] bg-[#ff3d6a] text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#e8304f] disabled:opacity-50">
              {loading ? "Subscribing…" : "Subscribe"}
            </button>
            <button type="button" onClick={onClose}
              className="h-10 rounded-[10px] border border-white/[.08] bg-white/[.03] px-4 text-[13px] text-zinc-400 transition hover:text-white">
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
          ? "border-[#ff3d6a]/45 bg-[#0e1420] shadow-[0_0_0_1px_rgba(255,61,106,.12)]"
          : "border-white/[.07] bg-[#0e1420] hover:border-white/[.13]"
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
        <div className={`absolute -bottom-5 left-4 grid h-10 w-10 place-items-center rounded-[11px] border-2 border-[#0e1420] bg-gradient-to-br ${avatarGradient(name)} text-[16px] font-bold text-white shadow-lg`}>
          {name.charAt(0).toUpperCase()}
        </div>
      </div>

      <div className="px-4 pb-4 pt-7">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-zinc-100">{name}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{channel.channel_id}</p>
          </div>
          {channel.auto_publish && (
            <span className="shrink-0 rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">AUTO</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-full bg-white/[.04] px-2 py-0.5 text-zinc-500">
            {expiry === "expired" ? <span className="text-red-400">Expired</span>
              : expiry === "soon" ? <span className="text-amber-400">Exp {formatDate(channel.lease_expires_at)}</span>
              : <span className="text-zinc-500">{formatDate(channel.lease_expires_at)}</span>}
          </span>
          <span className="rounded-full bg-white/[.04] px-2 py-0.5 text-zinc-500">{relativeTime(channel.last_notified_at)}</span>
          <span className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.07] px-2 py-0.5 font-medium text-[#ff3d6a]/80">Creator</span>
        </div>
      </div>
    </button>
  );
}

/* ─── Skeleton card ─── */
function ChannelCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/[.07] bg-[#0e1420]">
      <Skeleton className="h-[68px] w-full bg-white/[.05]" />
      <div className="space-y-2 px-4 pb-4 pt-7">
        <Skeleton className="h-4 w-3/4 bg-white/[.04]" />
        <Skeleton className="h-3 w-1/2 bg-white/[.03]" />
        <div className="flex gap-2 mt-3">
          <Skeleton className="h-5 w-16 rounded-full bg-white/[.03]" />
          <Skeleton className="h-5 w-20 rounded-full bg-white/[.03]" />
        </div>
      </div>
    </div>
  );
}

/* ─── Right detail panel ─── */
function ChannelDetailPanel({ channel, onUnsubscribe, onRefresh }: {
  channel: ChannelSubscription;
  onUnsubscribe: (id: string) => void;
  onRefresh: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosErr, setVideosErr] = useState<string | null>(null);
  const name = channel.channel_name ?? channel.channel_id;
  const expiry = expiryState(channel.lease_expires_at);

  useEffect(() => {
    setVideos([]); setVideosErr(null); setVideosLoading(true);
    channelsApi.recentVideos(channel.channel_id)
      .then((res) => setVideos(res.videos ?? []))
      .catch((e: unknown) => setVideosErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setVideosLoading(false));
  }, [channel.channel_id]);

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
      });
      onRefresh();
    } finally { setRenewing(false); }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-white/[.06] px-5 py-5">
        <div className="flex items-start gap-3">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br ${avatarGradient(name)} text-[18px] font-bold text-white shadow-lg`}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-bold text-zinc-100 truncate">{name}</p>
              <span className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                channel.active
                  ? "border-green-500/25 bg-green-500/10 text-green-400"
                  : "border-white/[.08] bg-white/[.03] text-zinc-500"
              )}>
                {channel.active ? "● Active" : "● Inactive"}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{channel.channel_id}</p>
          </div>
        </div>

        {/* Stat grid */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {([
            ["Category", <span key="cat" className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2 py-0.5 text-[11px] font-bold text-[#ff3d6a]">Creator</span>],
            ["Auto-pub", channel.auto_publish
              ? <span key="auto" className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold text-blue-400">On</span>
              : <span key="auto" className="text-[12px] text-zinc-500">Off</span>],
            ["Expires", <span key="exp" className={expiry === "expired" ? "text-[12px] text-red-400" : expiry === "soon" ? "text-[12px] text-amber-400" : "text-[12px] text-zinc-300"}>{formatDate(channel.lease_expires_at)}</span>],
            ["Last ping", <span key="ping" className="text-[12px] text-zinc-300">{relativeTime(channel.last_notified_at)}</span>],
          ] as [string, React.ReactNode][]).map(([label, value]) => (
            <div key={label} className="rounded-[10px] border border-white/[.06] bg-white/[.025] px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">{label}</p>
              <div className="mt-1">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent videos */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[.14em] text-zinc-600">Recent Videos</p>
        {videosLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-[10px] border border-white/[.06] bg-white/[.02] p-2.5">
                <Skeleton className="h-[52px] w-[88px] shrink-0 rounded-[8px] bg-white/[.05]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4 bg-white/[.04]" />
                  <Skeleton className="h-2.5 w-1/2 bg-white/[.03]" />
                </div>
              </div>
            ))}
          </div>
        ) : videosErr ? (
          <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{videosErr}</p>
        ) : videos.length === 0 ? (
          <p className="text-[12px] text-zinc-600">No recent videos found.</p>
        ) : (
          <div className="space-y-2">
            {videos.slice(0, 5).map((v) => (
              <div key={v.video_id} className="group flex items-center gap-3 rounded-[10px] border border-white/[.06] bg-white/[.02] p-2.5 transition hover:border-white/[.10] hover:bg-white/[.04]">
                <div className="relative h-[52px] w-[88px] shrink-0 overflow-hidden rounded-[8px] bg-zinc-900">
                  <img src={v.thumbnail} alt={v.title} className="h-full w-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                    <span className="text-white text-sm">▶</span>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12px] font-medium leading-[1.35] text-zinc-200">{v.title}</p>
                  <p className="mt-1 text-[10px] text-zinc-600">{formatNum(v.views)} views · {formatDate(v.published)}</p>
                </div>
                <button
                  onClick={() => navigate(`/studio?type=youtube&url=${encodeURIComponent(v.url)}`)}
                  className="shrink-0 rounded-[8px] border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-[#ff3d6a]/30 hover:bg-[#ff3d6a]/10 hover:text-[#ff3d6a]"
                >
                  Clip ↗
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2 border-t border-white/[.06] px-5 py-4">
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
  const [channels, setChannels] = useState<ChannelSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
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

  function handleSuccess() {
    setShowForm(false); setSuccess(true);
    load();
    setTimeout(() => setSuccess(false), 3000);
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
    <Shell active="channels">
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[18px] border border-white/[.07] bg-[#0b1018] shadow-[0_18px_80px_rgba(0,0,0,.28)]">

        {/* Header */}
        <div className="border-b border-white/[.06] bg-[#090e16]/95 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Title */}
            <div className="mr-2">
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-bold tracking-[-.02em] text-white">Channels</h1>
                <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2 py-0.5 text-xs font-medium text-zinc-500">
                  {loading ? "…" : counts.total}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-600">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,.7)]" />
                Monitor YouTube channels and clip new uploads.
              </p>
            </div>

            {/* Search */}
            <div className="relative min-w-[200px] flex-1 lg:max-w-[380px]">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search channels…"
                className="h-10 w-full rounded-[11px] border border-white/[.07] bg-white/[.035] pl-9 pr-3 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-[#ff3d6a]/30 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20 transition"
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
                      : "border-white/[.07] bg-white/[.025] text-zinc-500 hover:border-white/[.12] hover:text-zinc-300"
                  )}>
                  {label}
                  <span className={cn(
                    "rounded-full px-1.5 py-px font-mono text-[10px]",
                    filter === id ? "bg-[#ff3d6a]/20 text-rose-200" : "bg-white/[.07] text-zinc-600"
                  )}>{count}</span>
                </button>
              ))}
            </div>

            {/* Right actions */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button onClick={load} disabled={loading} aria-label="Refresh"
                className="grid h-9 w-9 place-items-center rounded-[9px] border border-white/[.08] bg-white/[.03] text-zinc-400 transition hover:bg-white/[.07] hover:text-white disabled:opacity-40">
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
                <h3 className="mb-2 text-[17px] font-bold text-white">
                  {channels.length === 0 ? "No channels yet" : "No channels match"}
                </h3>
                <p className="mb-7 max-w-sm text-[13px] leading-6 text-zinc-500">
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
                  <button onClick={() => { setSearch(""); setFilter("all"); }} className="text-[13px] text-zinc-500 hover:text-zinc-300">
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
              "border-l border-white/[.07] bg-[#0b101a] transition-[width] duration-200 overflow-hidden",
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

      {showForm && <AddChannelModal onClose={() => setShowForm(false)} onSuccess={handleSuccess} />}
    </Shell>
  );
}
