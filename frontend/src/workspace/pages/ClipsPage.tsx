import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clips } from "../data";
import { Shell } from "../Shell";
import { Platform } from "../components";
import { platformApi, SocialAccount } from "@/lib/api";

function ClipCard({ title, status, dur, score, views, grad, plats, active, onClick, delay = 0 }: {
  title: string; status: string; dur: string; score: string; views: string; grad: string; plats: string[]; active?: boolean; onClick?: () => void; delay?: number;
}) {
  return (
    <button onClick={onClick} className={cn("overflow-hidden rounded-[12px] border bg-[#0e1420] text-left transition hover:border-[#ff3d6a]/25", active ? "border-[#ff3d6a]/45 shadow-[0_0_0_1px_rgba(255,61,106,.12)]" : "border-white/[.07]")} style={{ animation: `fadeUp .28s ${delay}ms cubic-bezier(.22,.8,.4,1) both` }}>
      <div className={cn("relative aspect-[9/12] bg-gradient-to-br p-3", grad)}>
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute left-3 top-3 z-[1] flex gap-1">{plats.slice(0, 3).map((p) => <Platform key={p} id={p} />)}</div>
        <div className="absolute inset-0 grid place-items-center"><div className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur">▶</div></div>
        <div className="absolute bottom-3 right-3 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{dur}</div>
      </div>
      <div className="p-4">
        <div className="line-clamp-2 min-h-10 text-[13px] font-semibold leading-5">{title}</div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500"><span>{views} views</span><span>May 23</span></div>
        <div className="mt-4 flex items-center justify-between"><Badge variant={status === "ready" ? "ready" : status === "processing" ? "warn" : "muted"}>{status}</Badge><div className="font-display text-xl font-bold">{score}</div></div>
      </div>
    </button>
  );
}

interface PublishModalProps {
  clipId: string;
  defaultCaption: string;
  onClose: () => void;
}

function PublishModal({ clipId, defaultCaption, onClose }: PublishModalProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    // Default to 1 hour from now, formatted for datetime-local
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [caption, setCaption] = useState(defaultCaption);
  const [hashtags, setHashtags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformApi
      .listAccounts()
      .then((accs) => {
        const active = accs.filter((a) => a.is_active);
        setAccounts(active);
        if (active.length > 0) setSelectedAccountId(active[0].id);
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
  }, []);

  async function handleSchedule() {
    if (!selectedAccountId) {
      setError("Please select a social account.");
      return;
    }
    if (!scheduledAt) {
      setError("Please pick a date and time.");
      return;
    }

    const account = accounts.find((a) => a.id === selectedAccountId);
    if (!account) return;

    const hashtagList = hashtags
      .split(",")
      .map((h) => h.trim().replace(/^#/, ""))
      .filter(Boolean);

    setSubmitting(true);
    setError(null);

    try {
      await platformApi.schedulePost({
        // TODO: replace with real clip_id from ClipApiResponse when ClipsPage loads real clip data
        clip_id: clipId,
        social_account_id: selectedAccountId,
        platform: account.platform,
        scheduled_at: new Date(scheduledAt).toISOString(),
        caption: caption || undefined,
        hashtags: hashtagList.length > 0 ? hashtagList : undefined,
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="relative w-full max-w-[440px] rounded-[18px] border border-white/[.08] bg-[#0e1420] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
          <h2 className="font-display text-[15px] font-bold">Schedule Post</h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-white/[.06] hover:text-zinc-200 transition"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-green-500/10 text-2xl">✓</div>
              <p className="font-semibold text-green-400">Scheduled!</p>
              <p className="text-xs text-zinc-500">Your post has been queued.</p>
            </div>
          ) : (
            <>
              {/* Account selector */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Social Account</label>
                {loadingAccounts ? (
                  <div className="h-9 rounded-[9px] bg-white/[.04] animate-pulse" />
                ) : accounts.length === 0 ? (
                  <p className="text-xs text-zinc-500">No connected accounts. Connect one in Integrations.</p>
                ) : (
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.platform.charAt(0).toUpperCase() + a.platform.slice(1)} — @{a.platform_username ?? "unknown"}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* DateTime */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Scheduled At</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50 [color-scheme:dark]"
                />
              </div>

              {/* Caption */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                  placeholder="Write a caption..."
                  className="w-full resize-none rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50"
                />
              </div>

              {/* Hashtags */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">
                  Hashtags <span className="font-normal text-zinc-600">(comma-separated)</span>
                </label>
                <Input
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="viral, fyp, trending"
                  className="h-9 text-sm"
                />
              </div>

              {/* Error */}
              {error && (
                <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSchedule}
                  disabled={submitting || loadingAccounts || accounts.length === 0}
                >
                  {submitting ? "Scheduling…" : "Schedule"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClipsPage() {
  const [selected, setSelected] = useState<string | null>(clips[0][0]);
  const [publishOpen, setPublishOpen] = useState(false);
  const drawer = clips.find(([title]) => title === selected) ?? clips[0];

  // TODO: When ClipsPage loads real clip data via videoApi / clipApi, replace this with the
  // real ClipApiResponse.id. For now, using the clip title as the identifier since clips
  // are static mock data — "mock-clip-id" is used as fallback.
  const clipId = "mock-clip-id";

  return (
    <Shell active="clips">
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420]">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[.07] bg-[#0b101a] p-4">
          <h1 className="font-display text-[19px] font-bold tracking-[-.01em]">Clips</h1>
          <span className="rounded-full border border-white/[.07] bg-[#141926] px-2 py-0.5 text-xs font-semibold text-zinc-500">{clips.length}</span>
          <div className="relative min-w-[220px] flex-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600">/</span><Input className="h-[34px] pl-8 text-sm" placeholder="Search clips..." /></div>
          <div className="flex rounded-[9px] border border-white/[.07] bg-[#141926] p-1"><button className="rounded-md bg-white/[.06] px-2.5 py-1 text-xs font-semibold">Grid</button><button className="rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-500">List</button></div>
          <Button size="sm">+ New video</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-white/[.07] px-4 py-3">{["All clips", "TikTok", "Reels", "Shorts", "Ready", "Processing", "Failed"].map((x, i) => <button key={x} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", i === 0 ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-200" : "border-white/[.07] bg-white/[.025] text-zinc-500 hover:text-zinc-200")}>{x}</button>)}</div>
        <div className="grid min-h-0 flex-1 xl:grid-cols-[1fr_360px]">
          <div className="min-h-0 overflow-y-auto p-4"><div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{clips.map(([title, status, dur, score, views, grad, plats], i) => <ClipCard key={title} title={title} status={status} dur={dur} score={score} views={views} grad={grad} plats={[...plats]} active={title === selected} onClick={() => setSelected(title)} delay={i * 35} />)}</div></div>
          <div className="hidden border-l border-white/[.07] bg-[#0b101a] xl:block">
            <div className="flex h-[52px] items-center gap-3 border-b border-white/[.07] px-4"><span className="font-display text-[13px] font-bold">Clip details</span><button className="ml-auto rounded-lg border border-white/[.07] px-2 py-1 text-xs text-zinc-500">•••</button></div>
            <div className="p-4">
              <div className={cn("relative mx-auto aspect-[9/14] max-w-[220px] overflow-hidden rounded-[18px] bg-gradient-to-br", drawer[5])}><div className="absolute inset-0 bg-black/15" /><div className="absolute inset-0 grid place-items-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-white text-zinc-950">▶</div></div><div className="absolute bottom-4 left-4 right-4 h-1 rounded-full bg-white/25"><div className="h-full w-1/3 rounded-full bg-white" /></div></div>
              <h2 className="mt-5 font-display text-lg font-bold leading-6">{drawer[0]}</h2>
              <div className="mt-3 flex items-center gap-2"><Badge variant={drawer[1] === "ready" ? "ready" : "warn"}>{drawer[1]}</Badge><span className="text-xs text-zinc-500">{drawer[2]}</span></div>
              <div className="mt-5 grid grid-cols-3 gap-2">{[["Views", drawer[4]], ["Virality", drawer[3]], ["Format", "9:16"]].map(([l, v]) => <div key={l} className="rounded-[10px] border border-white/[.07] bg-white/[.025] p-3 text-center"><div className="font-display text-lg font-bold">{v}</div><div className="mt-1 text-[10px] uppercase tracking-[.08em] text-zinc-600">{l}</div></div>)}</div>
              <div className="mt-5 space-y-2">
                <Button className="w-full" onClick={() => setPublishOpen(true)}>Publish</Button>
                <Button className="w-full" variant="secondary">Edit clip</Button>
                <Button className="w-full" variant="ghost">Download</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {publishOpen && (
        <PublishModal
          clipId={clipId}
          defaultCaption={drawer[0] as string}
          onClose={() => setPublishOpen(false)}
        />
      )}
    </Shell>
  );
}
