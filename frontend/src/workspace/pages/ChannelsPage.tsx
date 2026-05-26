import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shell } from "../Shell";
import { channelsApi, type ChannelSubscription } from "@/lib/api";

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
  const [nameInput, setNameInput] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) { setErr("Channel URL or ID is required"); return; }
    setLoading(true);
    setErr(null);
    try {
      const channel_id = extractChannelId(urlInput);
      await channelsApi.subscribe({
        channel_id,
        channel_name: nameInput.trim() || undefined,
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
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://youtube.com/@MrBeast or UCxxxxxx"
          className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
        />
        <Input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Channel name (optional)"
          className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => setAutoPublish(e.target.checked)}
            className="accent-blue-500 w-4 h-4"
          />
          Auto-publish clips
        </label>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={loading} size="sm" className="bg-white text-zinc-900 hover:bg-zinc-200">
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

interface ChannelCardProps {
  channel: ChannelSubscription;
  onUnsubscribe: (id: string) => void;
}

function ChannelCard({ channel, onUnsubscribe }: ChannelCardProps) {
  const [removing, setRemoving] = useState(false);

  async function handleUnsubscribe() {
    setRemoving(true);
    try {
      await channelsApi.unsubscribe(channel.channel_id);
      onUnsubscribe(channel.id);
    } catch {
      setRemoving(false);
    }
  }

  return (
    <div className="group rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900 p-4 flex flex-col gap-3 transition-colors">
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
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/50 text-blue-400">
            Auto-publish
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-800/60 rounded-lg p-2">
          <p className="text-xs text-zinc-500">Subscribed</p>
          <p className="text-xs text-zinc-200 font-medium mt-0.5">{formatDate(channel.subscribed_at)}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-2">
          <p className="text-xs text-zinc-500">Expires</p>
          <p className="text-xs text-zinc-200 font-medium mt-0.5">{formatDate(channel.lease_expires_at)}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-2">
          <p className="text-xs text-zinc-500">Last video</p>
          <p className="text-xs text-zinc-200 font-medium mt-0.5 truncate">
            {channel.last_video_id ? channel.last_video_id.slice(0, 11) : "None yet"}
          </p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-2">
          <p className="text-xs text-zinc-500">Last ping</p>
          <p className="text-xs text-zinc-200 font-medium mt-0.5">{relativeTime(channel.last_notified_at)}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="w-full text-xs h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-900/40"
        disabled={removing}
        onClick={handleUnsubscribe}
      >
        {removing ? "Removing…" : "Unsubscribe"}
      </Button>
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
