import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shell } from "../Shell";
import { channelsApi, type ChannelSubscription, type ChannelVideo } from "@/lib/api";
import { navigate } from "@/lib/router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function extractChannelId(input: string): string {
  if (/^UC[\w-]{22}$/.test(input.trim())) return input.trim();
  const paramMatch = input.match(/channel_id=([^&]+)/);
  if (paramMatch) return paramMatch[1];
  const channelMatch = input.match(/\/channel\/(UC[\w-]{22})/);
  if (channelMatch) return channelMatch[1];
  return input.trim();
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

function YoutubeIcon() {
  return (
    <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0">
      <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-zinc-700" />
        <div className="space-y-1 flex-1">
          <div className="h-4 bg-zinc-700 rounded w-1/2" />
          <div className="h-3 bg-zinc-800 rounded w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-zinc-800 rounded" />
        ))}
      </div>
      <div className="h-8 bg-zinc-800 rounded" />
    </div>
  );
}

interface AddFormProps {
  onCancel: () => void;
  onSuccess: () => void;
}

function AddForm({ onCancel, onSuccess }: AddFormProps) {
  const [urlInput, setUrlInput] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{ channel_id: string; channel_name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleResolve() {
    if (!urlInput.trim()) return;
    setResolving(true);
    setErr(null);
    setResolved(null);
    try {
      const r = await channelsApi.resolve(urlInput.trim());
      setResolved(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not resolve channel");
    } finally {
      setResolving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) { setErr("Channel URL or ID is required"); return; }
    setLoading(true);
    setErr(null);
    try {
      await channelsApi.subscribe({
        channel_id: urlInput.trim(),
        channel_url: urlInput.trim(),
        auto_publish: autoPublish,
      });
      onSuccess();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to subscribe");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 mb-6">
      <h3 className="text-sm font-semibold text-white mb-4">Subscribe to Channel</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setResolved(null); }}
            onBlur={handleResolve}
            placeholder="https://youtube.com/@MrBeast or UCxxxxxx"
            className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 flex-1"
          />
          <Button type="button" variant="ghost" size="sm" onClick={handleResolve}
            disabled={resolving || !urlInput.trim()}
            className="text-zinc-400 hover:text-white border border-zinc-700 px-3">
            {resolving ? "…" : "Verify"}
          </Button>
        </div>
        {resolved && (
          <div className="flex items-center gap-2 rounded-lg bg-green-900/20 border border-green-800/50 px-3 py-2">
            <YoutubeIcon />
            <div>
              <p className="text-sm font-medium text-white">{resolved.channel_name || resolved.channel_id}</p>
              <p className="text-xs text-zinc-500">{resolved.channel_id}</p>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} className="accent-blue-500 w-4 h-4" />
          Auto-publish clips
        </label>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={loading || resolving} size="sm" className="bg-white text-zinc-900 hover:bg-zinc-200">
            {loading ? "Subscribing…" : "Subscribe"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="text-zinc-400 hover:text-white">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function formatViews(v: string | null): string {
  if (!v) return "";
  const n = parseInt(v, 10);
  if (isNaN(n)) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`;
  return `${n} views`;
}

interface ChannelCardProps {
  channel: ChannelSubscription;
  onUnsubscribe: (id: string) => void;
}

function ChannelCard({ channel, onUnsubscribe }: ChannelCardProps) {
  const [removing, setRemoving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosErr, setVideosErr] = useState<string | null>(null);

  async function handleUnsubscribe() {
    setRemoving(true);
    try {
      await channelsApi.unsubscribe(channel.channel_id);
      onUnsubscribe(channel.id);
    } catch {
      setRemoving(false);
    }
  }

  async function toggleVideos() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (videos.length > 0) return;
    setVideosLoading(true);
    setVideosErr(null);
    try {
      const res = await channelsApi.recentVideos(channel.channel_id);
      setVideos(res.videos ?? []);
    } catch (e: unknown) {
      setVideosErr(e instanceof Error ? e.message : "Failed to load videos");
    } finally {
      setVideosLoading(false);
    }
  }

  return (
    <div className="group rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900 flex flex-col transition-colors overflow-hidden">
      {/* Card header */}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <YoutubeIcon />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm truncate">
              {channel.channel_name ?? channel.channel_id}
            </p>
            <p className="text-xs text-zinc-500 truncate">{channel.channel_id}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${channel.active ? "bg-green-900/50 text-green-400" : "bg-zinc-800 text-zinc-400"}`}>
            {channel.active ? "Active" : "Inactive"}
          </span>
          {channel.auto_publish && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/50 text-blue-400">Auto-publish</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Subscribed", formatDate(channel.subscribed_at)],
            ["Expires", formatDate(channel.lease_expires_at)],
            ["Last video", channel.last_video_id ?? "None yet"],
            ["Last ping", relativeTime(channel.last_notified_at)],
          ].map(([label, value]) => (
            <div key={label} className="bg-zinc-800/60 rounded-lg p-2">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-xs text-zinc-200 font-medium mt-0.5 truncate">{value}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm" variant="ghost"
            className="flex-1 text-xs h-7 text-zinc-300 hover:text-white hover:bg-zinc-800 border border-zinc-700/60"
            onClick={toggleVideos}
          >
            {expanded ? "Hide videos" : "Recent videos"}
          </Button>
          <Button
            size="sm" variant="ghost"
            className="text-xs h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-900/40 px-3"
            disabled={removing}
            onClick={handleUnsubscribe}
          >
            {removing ? "…" : "Unsub"}
          </Button>
        </div>
      </div>

      {/* Expandable recent videos */}
      {expanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/60">
          {videosLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-2 animate-pulse">
                  <div className="w-20 h-11 rounded bg-zinc-800 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5 py-0.5">
                    <div className="h-3 bg-zinc-800 rounded w-3/4" />
                    <div className="h-2.5 bg-zinc-800/60 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : videosErr ? (
            <p className="p-4 text-xs text-red-400">{videosErr}</p>
          ) : videos.length === 0 ? (
            <p className="p-4 text-xs text-zinc-500">No recent videos found.</p>
          ) : (
            <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
              {videos.map((v) => (
                <DropdownMenu key={v.video_id}>
                  <DropdownMenuTrigger asChild>
                    <div className="flex gap-3 p-3 hover:bg-zinc-800/40 transition-colors group/video cursor-pointer">
                      <div className="relative flex-shrink-0 w-24 h-[54px] rounded overflow-hidden bg-zinc-800">
                        <img src={v.thumbnail} alt={v.title} className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/video:opacity-100 transition-opacity bg-black/50">
                          <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <p className="text-xs text-zinc-200 font-medium line-clamp-2 leading-tight group-hover/video:text-white">
                          {v.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-zinc-500">{formatDate(v.published)}</span>
                          {v.views && <span className="text-[10px] text-zinc-500">{formatViews(v.views)}</span>}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center opacity-0 group-hover/video:opacity-100 transition-opacity">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-zinc-500">
                          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                        </svg>
                      </div>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 bg-zinc-900 border-zinc-700 text-zinc-200">
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 text-[#ff3d6a] focus:text-[#ff3d6a]"
                      onClick={() => navigate(`/studio?type=youtube&url=${encodeURIComponent(v.url)}`)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                      </svg>
                      Clip it
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-zinc-700" />
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"
                      onClick={() => window.open(v.url, "_blank")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                      </svg>
                      Open in YouTube
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [success, setSuccess] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await channelsApi.list();
      setChannels(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleSuccess() {
    setShowForm(false);
    setSuccess(true);
    load();
    setTimeout(() => setSuccess(false), 3000);
  }

  function handleUnsubscribe(id: string) {
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = channels.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.channel_name ?? "").toLowerCase().includes(q) ||
      c.channel_id.toLowerCase().includes(q)
    );
  });

  return (
    <Shell active="channels">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Channel Monitor</h1>
            <p className="text-sm text-zinc-400 mt-1">Auto-clip new videos as they publish</p>
          </div>
          {!showForm && (
            <Button
              onClick={() => setShowForm(true)}
              className="bg-white text-zinc-900 hover:bg-zinc-200 font-medium"
            >
              Add Channel
            </Button>
          )}
        </div>

        {showForm && (
          <AddForm onCancel={() => setShowForm(false)} onSuccess={handleSuccess} />
        )}

        {success && (
          <div className="mb-4 rounded-lg bg-green-900/30 border border-green-800 px-4 py-2 text-sm text-green-400">
            Channel subscribed successfully.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 border border-red-800 px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && channels.length > 0 && (
          <div className="mb-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or channel ID…"
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 max-w-sm"
            />
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : filtered.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">No channels monitored yet</h3>
            <p className="text-sm text-zinc-400 mb-6">Add a channel to start auto-clipping new videos</p>
            <Button
              onClick={() => setShowForm(true)}
              className="bg-white text-zinc-900 hover:bg-zinc-200 font-medium"
            >
              Add Your First Channel
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} onUnsubscribe={handleUnsubscribe} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
