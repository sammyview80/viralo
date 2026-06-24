import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, safeFilename, downloadUrl } from "@/lib/utils";
import { Platform } from "../components";
import { UniversalClipCard } from "../components/UniversalClipCard";
import { VirtualizedGrid, VirtualizedList } from "../components/VirtualizedCollection";
import { Pagination } from "../components/Pagination";
import { videoApi, platformApi, agentApi, token, API_BASES, type ClipApiResponse, type ScheduledPost, SocialAccount, type TagSuggestResponse } from "@/lib/api";
import { VideoEditor } from "../components/VideoEditor";
import { addToast } from "@/stores/notifications";

const VIDEO_SSE_BASE = API_BASES.video;

function formatDuration(ms: number | null): string {
  if (ms == null) return "--:--";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildPostedClipIds(posts: ScheduledPost[]): Set<string> {
  const s = new Set<string>();
  for (const p of posts) { if (p.status === "posted" && p.clip_id) s.add(p.clip_id); }
  return s;
}
function buildScheduledClipIds(posts: ScheduledPost[]): Set<string> {
  const s = new Set<string>();
  for (const p of posts) {
    if (["scheduled", "pending", "processing"].includes(p.status) && p.clip_id) s.add(p.clip_id);
  }
  return s;
}

const CARD_PLAT_CFG: Record<string, { color: string; icon: string }> = {
  youtube:   { color: "#FF0000", icon: "▶" },
  shorts:    { color: "#FF0000", icon: "▶" },
  tiktok:    { color: "#69C9D0", icon: "♪" },
  reels:     { color: "#E1306C", icon: "◈" },
  instagram: { color: "#E1306C", icon: "◈" },
  twitter:   { color: "#1DA1F2", icon: "𝕏" },
  facebook:  { color: "#1877F2", icon: "f"  },
};

const ClipCard = memo(function ClipCard({ clip, active, onClick, onRetry, delay = 0, isPosted, isScheduled, clipPosts = [] }: {
  clip: ClipApiResponse; active?: boolean; onClick?: () => void; onRetry?: () => void; delay?: number;
  isPosted?: boolean; isScheduled?: boolean; clipPosts?: ScheduledPost[];
}) {
  const dur = formatDuration(clip.duration_ms);
  const scoreValue = clip.score ?? 0;
  const score = clip.score != null ? clip.score.toFixed(1) : "--";
  const scorePct = Math.min(100, Math.round(scoreValue * 10));
  const scoreColor = scoreValue >= 7 ? "#34d399" : scoreValue >= 4 ? "#fbbf24" : "#f87171";
  const platformKey = clip.platform ?? "shorts";
  const platformContent = clip.clip_metadata?.platforms?.[platformKey] ?? clip.clip_metadata?.platforms?.shorts ?? null;
  const viralReason = clip.clip_metadata?.viral_reason;
  const description = platformContent?.description ?? viralReason ?? clip.clip_metadata?.ai_title ?? clip.title ?? "";
  const tags = platformContent?.tags ?? [];
  const clipStart = clip.start_ms != null ? formatDuration(clip.start_ms) : null;
  const clipEnd = clip.end_ms != null ? formatDuration(clip.end_ms) : null;
  const platCfg = CARD_PLAT_CFG[clip.platform?.toLowerCase() ?? ""] ?? { color: "#ff3d6a", icon: "↗" };

  const postedPlatforms = Array.from(
    clipPosts.reduce((map, p) => {
      const key = p.platform?.toLowerCase() ?? "";
      const existing = map.get(key);
      const rank = (s: string) => s === "posted" ? 2 : ["scheduled","pending","processing"].includes(s) ? 1 : 0;
      if (!existing || rank(p.status) > rank(existing.status)) map.set(key, p);
      return map;
    }, new Map<string, ScheduledPost>()).values()
  );

  return (
    <button onClick={onClick} className={cn("group overflow-hidden rounded-[16px] border bg-[#0e1420] text-left transition hover:-translate-y-0.5 hover:border-white/[.13] hover:shadow-[0_18px_50px_rgba(0,0,0,.32)]", active ? "border-[#ff3d6a]/45 shadow-[0_0_0_1px_rgba(255,61,106,.12)]" : "border-white/[.07]")} style={{ animation: `fadeUp .28s ${delay}ms cubic-bezier(.22,.8,.4,1) both` }}>
      <div className="relative aspect-video overflow-hidden bg-black">
        {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt={clip.title ?? "clip"} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <div className="absolute inset-0 bg-gradient-to-br from-rose-600/40 to-violet-700/40" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/20" />
        <div className="absolute left-3 top-3 z-[1] grid h-7 w-7 place-items-center rounded-[8px] border border-white/10 bg-black/55 text-[12px] font-black text-white backdrop-blur" style={{ color: platCfg.color }}>{platCfg.icon}</div>
        {(isPosted || isScheduled) && (
          <div className={cn("absolute right-3 top-3 z-[1] flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm", isPosted ? "bg-amber-500/90" : "bg-blue-500/80")}>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>{isPosted ? <path d="M20 6 9 17l-5-5"/> : <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>}</svg>
            <span>{isPosted ? "Live" : "Queued"}</span>
          </div>
        )}

        {/* Upload state overlays */}
        {(clip.status === "pending_upload" || clip.status === "uploading") && (
          <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-[2px]">
            <svg className="h-6 w-6 animate-spin text-white/80" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-[11px] font-semibold text-white/70">
              {clip.status === "uploading" ? "Uploading…" : "Queued"}
            </span>
          </div>
        )}
        {clip.status === "upload_failed" && (
          <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-black/70">
            <span className="text-[22px]">⚠</span>
            <span className="text-[11px] font-bold text-red-400">Upload failed</span>
            {onRetry && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                className="mt-1 rounded-[8px] border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-white/20"
              >
                ↻ Retry Upload
              </button>
            )}
          </div>
        )}

        {clip.status === "ready" && (
          <div className="absolute inset-0 grid place-items-center"><div className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur transition group-hover:scale-105">▶</div></div>
        )}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
          <div className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold capitalize text-white/90 backdrop-blur">{clip.platform ?? "—"}</div>
          <div className="rounded-[7px] bg-black/65 px-2 py-1 font-mono text-[11px] font-bold text-white">{dur}</div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 min-h-10 flex-1 text-[15px] font-bold leading-5 tracking-[-.01em] text-white">{clip.clip_metadata?.ai_title ?? clip.title ?? "Untitled clip"}</h3>
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.025] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: scoreColor }} />
              <span className="font-mono text-[11px] font-bold" style={{ color: scoreColor }}>{score}</span>
            </div>
          </div>
          {description && <p className="line-clamp-2 min-h-9 text-[12px] leading-[1.45] text-zinc-500">{description}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
          <Badge variant={clip.status === "ready" ? "ready" : ["pending_upload","uploading"].includes(clip.status) ? "warn" : clip.status === "upload_failed" ? "error" : clip.status === "processing" ? "warn" : "muted"}>{clip.status === "pending_upload" ? "queued" : clip.status === "upload_failed" ? "failed" : clip.status}</Badge>
          <span className="rounded-full bg-white/[.035] px-2 py-1">{tags.length} tags</span>
          <span className="rounded-full bg-white/[.035] px-2 py-1">{new Date(clip.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          {clipStart && clipEnd && <span className="rounded-full bg-white/[.035] px-2 py-1 font-mono">{clipStart}–{clipEnd}</span>}
          <span className="rounded-full bg-white/[.035] px-2 py-1">{clip.clip_metadata?.aspect_ratio ?? "9:16"}</span>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ width: `${scorePct}%`, background: scoreColor }} /></div>

        {(postedPlatforms.length > 0 || tags.length > 0) && (
          <div className="space-y-2 border-t border-white/[.06] pt-3">
            {postedPlatforms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {postedPlatforms.slice(0, 2).map((p) => {
                  const pcfg = CARD_PLAT_CFG[p.platform?.toLowerCase() ?? ""] ?? { color: "#ff3d6a", icon: "↗" };
                  const isLive = p.status === "posted";
                  const isQ = ["scheduled","pending","processing"].includes(p.status);
                  return (
                    <span key={p.id} className="flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold" style={{ borderColor: `${pcfg.color}40`, background: `${pcfg.color}10`, color: pcfg.color }}>
                      <span>{pcfg.icon}</span><span className="capitalize">{p.platform}</span>{isLive && <span>✓</span>}{isQ && <span>⏱</span>}
                    </span>
                  );
                })}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-white/[.035] px-2 py-0.5 text-[9px] font-medium text-zinc-500">#{tag}</span>)}
                {tags.length > 2 && <span className="rounded-full bg-white/[.03] px-2 py-0.5 text-[9px] font-medium text-zinc-600">+{tags.length - 2}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
});

function PublishModal({ clip, onClose }: { clip: ClipApiResponse; onClose: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => { const d = new Date(Date.now() + 60 * 60 * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [caption, setCaption] = useState(clip.clip_metadata?.ai_title ?? clip.title ?? "");
  const [hashtags, setHashtags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<TagSuggestResponse | null>(() => {
    // Pre-load from clip metadata if platforms already have descriptions (generated during clipping)
    const platforms = clip.clip_metadata?.platforms;
    if (platforms && Object.values(platforms).some((p) => p?.description)) {
      return {
        primary_hashtags: clip.clip_metadata?.trending_hashtags ?? [],
        platforms: platforms as TagSuggestResponse["platforms"],
        research_used: false,
        _fromMeta: true,
      } as TagSuggestResponse & { _fromMeta?: boolean };
    }
    return null;
  });
  const [aiError, setAiError] = useState<string | null>(null);

  // When suggestions load (auto or manual), auto-fill caption + hashtags for clip's platform
  useEffect(() => {
    if (!aiSuggestions) return;
    const key = clip.platform?.toLowerCase() ?? "tiktok";
    const platData = aiSuggestions.platforms?.[key] ?? aiSuggestions.platforms?.tiktok;
    if (platData?.description && !caption) setCaption(platData.description);
    const tags = platData?.tags?.length ? platData.tags : aiSuggestions.primary_hashtags ?? [];
    if (tags.length > 0 && !hashtags) setHashtags(tags.map((t: string) => t.replace(/^#/, "")).join(", "));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestions]);

  // Auto-suggest on open if no metadata platforms yet
  useEffect(() => {
    if (aiSuggestions) return; // already have suggestions (from metadata or prior run)
    const topic = clip.clip_metadata?.ai_title ?? clip.title ?? "video content";
    if (!topic) return;
    const niche = clip.clip_metadata?.niche ?? clip.clip_metadata?.topic ?? undefined;
    const extra_context = clip.caption_srt
      ? clip.caption_srt.replace(/^\d+\n[\d:,]+ --> [\d:,]+\n/gm, "").replace(/\n{2,}/g, " ").trim().slice(0, 2000)
      : undefined;
    setAiLoading(true); setAiError(null);
    agentApi.suggestTags({ topic, niche, extra_context })
      .then((result) => setAiSuggestions(result))
      .catch(() => { /* silent — user can still click Suggest manually */ })
      .finally(() => setAiLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAiSuggest() {
    const topic = clip.clip_metadata?.ai_title ?? clip.title ?? "video content";
    const niche = clip.clip_metadata?.niche ?? clip.clip_metadata?.topic ?? undefined;
    const extra_context = clip.caption_srt
      ? clip.caption_srt.replace(/^\d+\n[\d:,]+ --> [\d:,]+\n/gm, "").replace(/\n{2,}/g, " ").trim().slice(0, 2000)
      : undefined;
    setAiLoading(true); setAiError(null); setAiSuggestions(null);
    try {
      const result = await agentApi.suggestTags({ topic, niche, extra_context });
      setAiSuggestions(result);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI suggest failed");
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiSuggestion(platform?: string) {
    if (!aiSuggestions) return;
    const key = platform ?? "tiktok";
    const platData = aiSuggestions.platforms?.[key];
    if (platData?.description) setCaption(platData.description);
    const tags = platData?.tags?.length
      ? platData.tags
      : aiSuggestions.primary_hashtags ?? [];
    setHashtags(tags.map((t: string) => t.replace(/^#/, "")).join(", "));
  }
  const platformKeyMap: Record<string, string> = { instagram: "reels", reels: "reels", tiktok: "tiktok", tt: "tiktok", shorts: "shorts", youtube: "youtube", yt: "youtube", twitter: "twitter", tw: "twitter", facebook: "facebook" };
  function fillFromPlatform(platformRaw: string) {
    const key = platformKeyMap[platformRaw.toLowerCase()] ?? platformRaw.toLowerCase();
    const content = clip.clip_metadata?.platforms?.[key];
    if (content) { setCaption(content.description || clip.clip_metadata?.ai_title || clip.title || ""); setHashtags(content.tags.join(", ")); }
    else { setCaption(clip.clip_metadata?.ai_title ?? clip.title ?? ""); setHashtags(""); }
  }
  useEffect(() => {
    platformApi.listAccounts().then((accs) => { const active = accs.filter((a) => a.is_active); setAccounts(active); if (active.length > 0) { setSelectedAccountId(active[0].id); fillFromPlatform(active[0].platform); } }).catch(() => setAccounts([])).finally(() => setLoadingAccounts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function handleSchedule() {
    if (!selectedAccountId) { setError("Please select a social account."); return; }
    if (!scheduledAt) { setError("Please pick a date and time."); return; }
    const account = accounts.find((a) => a.id === selectedAccountId);
    if (!account) return;
    const hashtagList = hashtags.split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean);
    const isYouTube = ["youtube", "shorts"].includes(account.platform.toLowerCase());
    const platformKey = platformKeyMap[account.platform.toLowerCase()] ?? account.platform.toLowerCase();
    const platContent = clip.clip_metadata?.platforms?.[platformKey];
    const platform_kwargs = isYouTube ? {
      title: clip.clip_metadata?.ai_title ?? clip.title ?? undefined,
      description: caption || platContent?.description || undefined,
      tags: hashtagList.length > 0 ? hashtagList : (platContent?.tags ?? []),
      made_for_kids: false,
    } : undefined;
    setSubmitting(true); setError(null);
    try { await platformApi.schedulePost({ clip_id: clip.id, social_account_id: selectedAccountId, platform: account.platform, scheduled_at: new Date(scheduledAt).toISOString(), caption: caption || undefined, hashtags: hashtagList.length > 0 ? hashtagList : undefined, platform_kwargs }); setSuccess(true); setTimeout(onClose, 1500); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setSubmitting(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-[440px] rounded-[18px] border border-white/[.08] bg-[#0e1420] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4"><h2 className="font-display text-[15px] font-bold">Schedule Post</h2><button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full text-zinc-500 hover:bg-white/[.06] hover:text-zinc-200 transition cursor-pointer">✕</button></div>
        <div className="space-y-4 p-5">
          {success ? (<div className="flex flex-col items-center gap-3 py-6 text-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-green-500/10 text-2xl">✓</div><p className="font-semibold text-green-400">Scheduled!</p><p className="text-xs text-zinc-500">Your post has been queued.</p></div>) : (
            <>
              <div><label className="mb-1.5 block text-xs font-semibold text-zinc-400">Social Account</label>
                {loadingAccounts ? <div className="h-9 rounded-[9px] bg-white/[.04] animate-pulse" /> : accounts.length === 0 ? (<div className="flex flex-col items-center gap-3 rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-5 text-center"><p className="text-sm font-semibold text-white">No social accounts connected</p><a href="/integrations" className="mt-1 rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#ff3d6a]/85">Connect social media →</a></div>) : (
                  <select value={selectedAccountId} onChange={(e) => { setSelectedAccountId(e.target.value); const acc = accounts.find((a) => a.id === e.target.value); if (acc) fillFromPlatform(acc.platform); }} className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50">
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.platform.charAt(0).toUpperCase() + a.platform.slice(1)} — @{a.platform_username ?? "unknown"}</option>)}
                  </select>)}
              </div>
              <div><label className="mb-1.5 block text-xs font-semibold text-zinc-400">Scheduled At</label><input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50 [color-scheme:dark]" /></div>
              {/* AI Suggest strip */}
              <div className="rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11.5px] font-semibold text-white">✦ AI Viral Suggestions</p>
                    <p className="text-[10.5px] text-zinc-500">Auto-fill caption + hashtags optimised for virality</p>
                  </div>
                  <button
                    onClick={handleAiSuggest}
                    disabled={aiLoading}
                    className="flex-none rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#e8304f] disabled:opacity-50"
                  >
                    {aiLoading ? "…" : "Suggest"}
                  </button>
                </div>
                {aiError && <p className="mt-2 text-[10.5px] text-red-400">{aiError}</p>}
                {aiSuggestions && (
                  <div className="mt-3 space-y-2.5">
                    {/* Research badge */}
                    <p className="text-[9.5px] text-zinc-500">
                      {(aiSuggestions as any)._fromMeta
                        ? "✓ Pre-generated during clipping"
                        : (aiSuggestions as any).research_used
                          ? "🔍 Based on live web research"
                          : "⚡ From AI knowledge (no Tavily key)"}
                    </p>
                    {/* Platform tabs */}
                    <div className="flex flex-wrap gap-1.5">
                      {Object.keys(aiSuggestions.platforms ?? {}).map((plat) => (
                        <button
                          key={plat}
                          onClick={() => applyAiSuggestion(plat)}
                          className="rounded-full border border-[#ff3d6a]/30 bg-[#ff3d6a]/10 px-2.5 py-0.5 text-[10px] font-semibold text-[#ff3d6a] transition hover:bg-[#ff3d6a]/20"
                        >
                          Apply {plat}
                        </button>
                      ))}
                    </div>
                    {/* Primary hashtag chips */}
                    {aiSuggestions.primary_hashtags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {aiSuggestions.primary_hashtags.slice(0, 8).map((t: string) => (
                          <span key={t} className="rounded-full bg-white/[.05] px-2 py-0.5 text-[9.5px] text-zinc-400">#{t.replace(/^#/, "")}</span>
                        ))}
                      </div>
                    )}
                    {/* Caption preview */}
                    {aiSuggestions.platforms?.tiktok?.description && (
                      <p className="line-clamp-2 text-[10.5px] text-zinc-400">{aiSuggestions.platforms.tiktok.description}</p>
                    )}
                  </div>
                )}
              </div>

              <div><label className="mb-1.5 block text-xs font-semibold text-zinc-400">Caption</label><textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Write a caption..." className="w-full resize-none rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50" /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-zinc-400">Hashtags <span className="font-normal text-zinc-600">(comma-separated)</span></label><input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="viral, fyp, trending" className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/50" /></div>
              {error && <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
              {accounts.length > 0 && (<div className="flex gap-2 pt-1"><Button variant="ghost" className="flex-1" onClick={onClose} disabled={submitting}>Cancel</Button><Button className="flex-1 bg-[#ff3d6a] hover:bg-[#e8304f] text-white" onClick={handleSchedule} disabled={submitting || loadingAccounts}>{submitting ? "Scheduling…" : "Schedule"}</Button></div>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ShortsPlayer({ clip }: { clip: ClipApiResponse }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(clip.duration_ms ? clip.duration_ms / 1000 : 0);
  const hasVideo = !!clip.storage_url;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const onTime = () => { setCurrentTime(v.currentTime); setProgress(v.duration ? v.currentTime / v.duration : 0); };
    const onMeta = () => setDuration(v.duration);
    const onEnd = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime); v.addEventListener("loadedmetadata", onMeta); v.addEventListener("ended", onEnd);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("ended", onEnd); };
  }, []);
  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };
  const seekFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const v = videoRef.current;
    if (!barRef.current || !v || !v.duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration; setProgress(ratio);
  }, []);
  const onBarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); seekFromEvent(e);
    const onMove = (ev: MouseEvent) => seekFromEvent(ev);
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  const platform = clip.platform ?? "shorts";
  const content = clip.clip_metadata?.platforms?.[platform];
  const description = content?.description ?? clip.title ?? "";
  const tags = content?.tags ?? [];
  const aspectRatioStr = clip.clip_metadata?.aspect_ratio ?? "9:16";
  const aspectRatioCss = aspectRatioStr === "1:1" ? "1/1" : aspectRatioStr === "16:9" ? "16/9" : aspectRatioStr === "4:5" ? "4/5" : "9/16";
  const playerWidth = aspectRatioStr === "16:9" ? 240 : aspectRatioStr === "1:1" ? 160 : 160;
  return (
    <div className="select-none">
      <div className="relative mx-auto overflow-hidden rounded-[24px] bg-black shadow-[0_0_0_2px_rgba(255,255,255,.1),0_12px_40px_rgba(0,0,0,.7)]" style={{ width: playerWidth, aspectRatio: aspectRatioCss }}>
        {hasVideo ? <video ref={videoRef} src={clip.storage_url!} className="absolute inset-0 h-full w-full object-cover" playsInline preload="metadata" poster={clip.thumbnail_url ?? undefined} />
          : clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : <div className="absolute inset-0 bg-gradient-to-br from-rose-600/60 to-violet-700/60" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute right-1.5 bottom-14 flex flex-col items-center gap-2">
          {([["👍","4.2K"],["💬","312"],["↗","1.1K"],["🎵",""]] as [string,string][]).map(([icon, val], i) => (
            <div key={i} className="flex flex-col items-center gap-px"><div className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-sm backdrop-blur-md">{icon}</div>{val && <span className="text-[8px] font-bold text-white drop-shadow">{val}</span>}</div>
          ))}
        </div>
        <div className="absolute bottom-9 left-2 right-11">
          <div className="text-[8px] font-bold text-white drop-shadow-md">@viralo</div>
          <div className="mt-0.5 line-clamp-2 text-[7.5px] font-medium leading-3 text-white/90 drop-shadow-md">{description}</div>
          {tags.length > 0 && <div className="mt-1 flex flex-wrap gap-0.5">{tags.slice(0, 3).map((t) => <span key={t} className="text-[7px] font-bold text-[#ff6b8a] drop-shadow">#{t}</span>)}</div>}
        </div>
        <button className="absolute inset-0 z-10 flex items-center justify-center" onClick={togglePlay}>
          {!playing && <div className="grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>}
        </button>
        <div className="absolute bottom-0 left-0 right-0 z-20 px-2 pb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[7px] font-semibold text-white/80">{fmt(currentTime)}</span>
            <div ref={barRef} className="relative h-1 flex-1 cursor-pointer rounded-full bg-white/30" onMouseDown={onBarMouseDown}>
              <div className="h-full rounded-full bg-white transition-none" style={{ width: `${progress * 100}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-white shadow" style={{ left: `calc(${progress * 100}% - 5px)` }} />
            </div>
            <span className="font-mono text-[7px] font-semibold text-white/80">{fmt(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformCopyCard({ platform, content, pcfg }: {
  platform: string;
  content: { description: string; tags: string[] };
  pcfg: { color: string; icon: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-[10px] border border-white/[.06] bg-[#0d1420] transition hover:border-white/[.1]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-2.5 text-left cursor-pointer">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: pcfg.color }}>{pcfg.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold capitalize" style={{ color: pcfg.color }}>{platform}</span>
            <span className="rounded-full bg-white/[.04] px-1.5 py-px text-[9px] font-semibold text-zinc-500">{content.tags?.length ?? 0} tags</span>
          </div>
          {!open && <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-zinc-500">{content.description}</p>}
        </div>
        <span className={cn("text-zinc-600 transition-transform", open && "rotate-180")}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="m6 9 6 6 6-6"/></svg>
        </span>
      </button>

      {open && (
        <div className="border-t border-white/[.06] px-3 pb-3 pt-2">
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-zinc-600">Description</p>
              <p className="rounded-[8px] bg-white/[.025] p-2 text-[11px] leading-4 text-zinc-300">{content.description}</p>
            </div>
            {content.tags?.length > 0 && (
              <div>
                <p className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-zinc-600">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {content.tags.map((tag) => <span key={tag} className="rounded-full border px-2 py-1 text-[10px] font-semibold" style={{ borderColor: `${pcfg.color}35`, background: `${pcfg.color}12`, color: pcfg.color }}>#{tag.replace(/^#+/, "")}</span>)}
                </div>
              </div>
            )}
            <button type="button" onClick={() => setOpen(false)} className="mt-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-300">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420] animate-pulse">
      <div className="aspect-[9/12] bg-white/[.04]" />
      <div className="p-4 space-y-3"><div className="h-3 rounded bg-white/[.06] w-3/4" /><div className="h-3 rounded bg-white/[.04] w-1/2" /><div className="flex justify-between mt-4"><div className="h-5 w-14 rounded-full bg-white/[.06]" /><div className="h-6 w-10 rounded bg-white/[.06]" /></div></div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap", active ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-rose-100" : "border-white/[.06] bg-white/[.018] text-zinc-500 hover:border-white/[.12] hover:bg-white/[.035] hover:text-zinc-200")}>
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[.13em] text-zinc-600">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Multi-select filter definitions — match fn used for non-platform filters
const PLATFORM_OPTIONS = [
  { id: "tiktok",    label: "TikTok",      match: (c: ClipApiResponse) => c.platform === "tiktok" },
  { id: "reels",     label: "Reels",       match: (c: ClipApiResponse) => c.platform === "reels" || c.platform === "instagram" },
  { id: "shorts",    label: "Shorts",      match: (c: ClipApiResponse) => c.platform === "shorts" || c.platform === "youtube" },
  { id: "twitter",   label: "Twitter / X", match: (c: ClipApiResponse) => c.platform === "twitter" },
  { id: "linkedin",  label: "LinkedIn",    match: (c: ClipApiResponse) => c.platform === "linkedin" },
  { id: "facebook",  label: "Facebook",    match: (c: ClipApiResponse) => c.platform === "facebook" },
];
const STATUS_OPTIONS = [
  { id: "ready",          label: "Ready",      match: (c: ClipApiResponse) => c.status === "ready" },
  { id: "pending_upload", label: "Queued",     match: (c: ClipApiResponse) => c.status === "pending_upload" },
  { id: "uploading",      label: "Uploading",  match: (c: ClipApiResponse) => c.status === "uploading" },
  { id: "upload_failed",  label: "Failed",     match: (c: ClipApiResponse) => c.status === "upload_failed" || c.status === "failed" },
  { id: "processing",     label: "Processing", match: (c: ClipApiResponse) => c.status === "processing" },
];
const DURATION_OPTIONS = [
  { id: "short",  label: "< 30s",    match: (c: ClipApiResponse) => (c.duration_ms ?? 0) < 30_000 },
  { id: "medium", label: "30 – 60s", match: (c: ClipApiResponse) => (c.duration_ms ?? 0) >= 30_000 && (c.duration_ms ?? 0) < 60_000 },
  { id: "long",   label: "> 1 min",  match: (c: ClipApiResponse) => (c.duration_ms ?? 0) >= 60_000 },
];
const SCORE_OPTIONS = [
  { id: "high", label: "High ≥7",  match: (c: ClipApiResponse) => (c.score ?? 0) >= 7 },
  { id: "mid",  label: "Mid 4–7",  match: (c: ClipApiResponse) => (c.score ?? 0) >= 4 && (c.score ?? 0) < 7 },
  { id: "low",  label: "Low <4",   match: (c: ClipApiResponse) => (c.score ?? 0) < 4 },
];
const PUBLISHED_OPTIONS = [
  { id: "posted",   label: "Posted" },
  { id: "queued",   label: "Queued" },
  { id: "unposted", label: "Not posted" },
];
type SortMode = "newest" | "oldest" | "score_desc" | "score_asc" | "duration_desc";

// Helper: toggle id in set
function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

const PLATFORM_DOT_COLOR: Record<string, string> = {
  tiktok: "bg-rose-400", reels: "bg-purple-400", instagram: "bg-purple-400",
  shorts: "bg-red-400", youtube: "bg-red-400", twitter: "bg-sky-400",
  linkedin: "bg-blue-400", facebook: "bg-indigo-400",
};

export function ClipsPage() {
  const [clips, setClips] = useState<ClipApiResponse[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [durations, setDurations] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<Set<string>>(new Set());
  const [minViralityScore, setMinViralityScore] = useState(0);
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(true);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestResponse | null>(null);
  const [suggestingTags, setSuggestingTags] = useState(false);
  const [tagSuggestError, setTagSuggestError] = useState<string | null>(null);
  const [tagSuggestClipId, setTagSuggestClipId] = useState<string | null>(null);
  const [savingTags, setSavingTags] = useState(false);
  const [savedTagClipId, setSavedTagClipId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalClips, setTotalClips] = useState(0);
  const perPage = 24;
  const [editClip, setEditClip] = useState<ClipApiResponse | null>(null);
  const [failedPostBanner, setFailedPostBanner] = useState<string | null>(null);
  const [upscalingId, setUpscalingId] = useState<string | null>(null);
  async function handleSaveAiSuggestions(clip: ClipApiResponse, suggestions: TagSuggestResponse) {
    setSavingTags(true);
    try {
      await videoApi.patchClip(clip.id, {
        tags: suggestions.primary_hashtags.map((t) => t.replace(/^#/, "")),
        platform_copy: Object.fromEntries(
          Object.entries(suggestions.platforms).map(([k, v]) => [k, { description: v.description, tags: v.tags }])
        ),
      });
      setSavedTagClipId(clip.id);
    } catch {
      // silently fail — user can retry
    } finally {
      setSavingTags(false);
    }
  }

  async function handleSuggestTags(clip: ClipApiResponse) {
    const topic = clip.clip_metadata?.ai_title ?? clip.title ?? "video content";
    const niche = clip.clip_metadata?.niche ?? clip.clip_metadata?.topic ?? undefined;
    const extra_context = clip.caption_srt
      ? clip.caption_srt.replace(/^\d+\n[\d:,]+ --> [\d:,]+\n/gm, "").replace(/\n{2,}/g, " ").trim().slice(0, 2000)
      : undefined;
    setSuggestingTags(true);
    setTagSuggestError(null);
    setTagSuggestions(null);
    setTagSuggestClipId(clip.id);
    try {
      const result = await agentApi.suggestTags({ topic, niche, extra_context });
      setTagSuggestions(result);
    } catch (e: unknown) {
      setTagSuggestError(e instanceof Error ? e.message : "Failed to suggest tags");
    } finally {
      setSuggestingTags(false);
    }
  }



  // Highlight clip + show banner when navigated from failed post notification
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clipParam = params.get("clip");
    if (clipParam) {
      setSelectedId(clipParam);
      setFailedPostBanner("This clip failed to post. Check status below and reschedule when ready.");
      // Clean URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete("clip");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [clipsResp, postsResp] = await Promise.all([
          videoApi.listClips(page, perPage, minViralityScore > 0 ? minViralityScore : undefined, sort === "score_desc" ? "score" : undefined),
          platformApi.listPosts({ per_page: 20 }),
        ]);
        const allClips = Array.isArray(clipsResp.items) ? clipsResp.items : [];
        setClips(allClips);
        setTotalClips(typeof clipsResp.total === "number" ? clipsResp.total : allClips.length);
        setPosts(Array.isArray(postsResp.items) ? postsResp.items : []);
        setSelectedId((current) => current ?? (allClips.at(0)?.id ?? null));
      } catch {
        setClips([]);
        setTotalClips(0);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [page, minViralityScore, sort]);

  // Ref-based SSE subscriptions — keyed by video_id so we never double-subscribe or loop
  const sseSourcesRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    const pendingVideoIds = new Set(
      clips
        .filter((c) => c.status === "pending_upload" || c.status === "uploading")
        .map((c) => String(c.video_id))
    );

    // Close sources for video IDs that are no longer pending
    for (const [vid, es] of sseSourcesRef.current) {
      if (!pendingVideoIds.has(vid)) {
        es.close();
        sseSourcesRef.current.delete(vid);
      }
    }

    // Open new sources for newly pending video IDs
    const authToken = token.get();
    if (!authToken) return;

    for (const videoId of pendingVideoIds) {
      if (sseSourcesRef.current.has(videoId)) continue; // already subscribed

      const url = `${VIDEO_SSE_BASE}/progress/${videoId}?token=${encodeURIComponent(authToken)}`;
      const es = new EventSource(url);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "keepalive") return;

          if (data.event === "clip_upload_complete") {
            setClips((prev) =>
              prev.map((c) =>
                c.id === data.clip_id
                  ? { ...c, status: "ready", storage_url: data.media_url, thumbnail_url: data.thumbnail_url ?? c.thumbnail_url }
                  : c
              )
            );
          } else if (data.event === "clip_upload_failed") {
            setClips((prev) =>
              prev.map((c) =>
                c.id === data.clip_id ? { ...c, status: "upload_failed" } : c
              )
            );
          }
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        es.close();
        sseSourcesRef.current.delete(videoId);
      };

      sseSourcesRef.current.set(videoId, es);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useMemo(() => clips.map((c) => `${c.id}:${c.status}`).join(","), [clips])]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const es of sseSourcesRef.current.values()) es.close();
      sseSourcesRef.current.clear();
    };
  }, []);

  const postedClipIds = useMemo(() => buildPostedClipIds(posts), [posts]);
  const scheduledClipIds = useMemo(() => buildScheduledClipIds(posts), [posts]);
  const postsByClipId = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const post of posts) {
      if (!post.clip_id) continue;
      const list = map.get(post.clip_id) ?? [];
      list.push(post);
      map.set(post.clip_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return map;
  }, [posts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clips.filter((c) => {
      if (q && !((c.title ?? "").toLowerCase().includes(q) || (c.platform ?? "").toLowerCase().includes(q))) return false;
      if (platforms.size > 0 && !PLATFORM_OPTIONS.filter((o) => platforms.has(o.id)).some((o) => o.match(c))) return false;
      if (statuses.size > 0 && !STATUS_OPTIONS.filter((o) => statuses.has(o.id)).some((o) => o.match(c))) return false;
      if (durations.size > 0 && !DURATION_OPTIONS.filter((o) => durations.has(o.id)).some((o) => o.match(c))) return false;
      if (scores.size > 0 && !SCORE_OPTIONS.filter((o) => scores.has(o.id)).some((o) => o.match(c))) return false;
      if (published.size > 0) {
        const isPosted = postedClipIds.has(c.id);
        const isQueued = scheduledClipIds.has(c.id);
        const pass = (published.has("posted") && isPosted) || (published.has("queued") && isQueued) || (published.has("unposted") && !isPosted && !isQueued);
        if (!pass) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === "score_desc") return (b.score ?? 0) - (a.score ?? 0);
      if (sort === "score_asc") return (a.score ?? 0) - (b.score ?? 0);
      if (sort === "duration_desc") return (b.duration_ms ?? 0) - (a.duration_ms ?? 0);
      return 0;
    });
  }, [clips, search, platforms, statuses, durations, scores, published, sort, postedClipIds, scheduledClipIds]);

  const drawer = clips.find((c) => c.id === selectedId) ?? null;
  const drawerPosted = drawer ? postedClipIds.has(drawer.id) : false;
  const drawerScheduled = drawer ? scheduledClipIds.has(drawer.id) : false;
  const drawerPost = drawer
    ? (postsByClipId.get(drawer.id) ?? [])[0] ?? null
    : null;
  const activeFilterCount = [platforms.size, statuses.size, durations.size, scores.size, published.size, search !== "" ? 1 : 0, minViralityScore > 0 ? 1 : 0].reduce((a, b) => a + b, 0);
  function clearFilters() { setPlatforms(new Set()); setStatuses(new Set()); setDurations(new Set()); setScores(new Set()); setPublished(new Set()); setSearch(""); setMinViralityScore(0); setPage(1); }

  return (
    <>
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[18px] border border-white/[.07] bg-[#0b1018] shadow-[0_18px_80px_rgba(0,0,0,.28)]">
        {/* Header */}
        <div className="border-b border-white/[.06] bg-[#090e16]/95 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="min-w-0 lg:mr-2 lg:min-w-[140px]">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[20px] font-bold tracking-[-.02em]">Clips</h1>
              <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2 py-0.5 text-xs font-medium text-zinc-500">{loading ? "…" : `${filtered.length}${filtered.length !== clips.length ? `/${clips.length}` : ""}`}</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">Search, review, and publish shorts.</p>
          </div>
          <div className="relative min-w-0 max-w-none flex-1 lg:min-w-[240px] lg:max-w-[520px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="h-10 w-full rounded-[11px] border border-white/[.07] bg-white/[.035] pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#ff3d6a]/30 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20 transition" placeholder="Search clips…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition cursor-pointer"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12"/></svg></button>}
          </div>
          <button onClick={() => setShowFilters((v) => !v)} className={cn("flex h-10 items-center gap-2 rounded-[11px] border px-3 text-xs font-semibold transition cursor-pointer", showFilters || activeFilterCount > 0 ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-rose-100" : "border-white/[.07] bg-white/[.025] text-zinc-400 hover:text-zinc-200")}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M3 5h18M6 12h12M10 19h4"/></svg>
            Filters
            {activeFilterCount > 0 && <span className="rounded-full bg-[#ff3d6a] px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span>}
          </button>
          <div className="flex rounded-[11px] border border-white/[.07] bg-white/[.025] p-1">
            {(["grid", "list"] as const).map((v) => <button key={v} onClick={() => setViewMode(v)} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition cursor-pointer", viewMode === v ? "bg-white/[.06] text-white" : "text-zinc-500 hover:text-zinc-300")}>{v === "grid" ? "Grid" : "List"}</button>)}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="h-10 rounded-[11px] border border-white/[.07] bg-white/[.025] px-3 text-xs font-semibold text-zinc-400 focus:outline-none transition cursor-pointer">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="score_desc">Highest score</option>
            <option value="score_asc">Lowest score</option>
            <option value="duration_desc">Longest first</option>
          </select>

          <Button size="sm" className="h-10 rounded-[11px] bg-[#ff3d6a] px-4 text-white hover:bg-[#e8304f]" onClick={() => window.location.href = "/studio"}>+ New video</Button>
          </div>
          {activeFilterCount > 0 && !showFilters && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
              <span>{activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active</span>
              <button onClick={clearFilters} className="font-semibold text-rose-300/80 hover:text-rose-200">Clear all</button>
            </div>
          )}
        </div>



        {/* Failed post banner */}
        {failedPostBanner && (
          <div className="flex items-center gap-3 border-b border-red-500/20 bg-red-500/[.07] px-5 py-3">
            <span className="text-lg">⚠️</span>
            <p className="flex-1 text-[12px] font-semibold text-red-300">{failedPostBanner}</p>
            <button onClick={() => setFailedPostBanner(null)} className="text-red-400/60 hover:text-red-300 transition cursor-pointer text-sm">✕</button>
          </div>
        )}

        {/* Filter bar — collapsed by default to keep the workspace calm */}
        {showFilters && (
          <div className="border-b border-white/[.06] bg-[#0b1018] px-3 py-3 sm:px-5 sm:py-4">
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
              <FilterGroup label="Platform">{PLATFORM_OPTIONS.map((f) => <Chip key={f.id} active={platforms.has(f.id)} onClick={() => setPlatforms((p) => toggle(p, f.id))}>{f.label}</Chip>)}</FilterGroup>
              <FilterGroup label="Status">{STATUS_OPTIONS.map((f) => <Chip key={f.id} active={statuses.has(f.id)} onClick={() => setStatuses((s) => toggle(s, f.id))}>{f.label}</Chip>)}</FilterGroup>
              <FilterGroup label="Duration">{DURATION_OPTIONS.map((f) => <Chip key={f.id} active={durations.has(f.id)} onClick={() => setDurations((d) => toggle(d, f.id))}>{f.label}</Chip>)}</FilterGroup>
              <FilterGroup label="Published">{PUBLISHED_OPTIONS.map((f) => <Chip key={f.id} active={published.has(f.id)} onClick={() => setPublished((p) => toggle(p, f.id))}>{f.label}</Chip>)}{activeFilterCount > 0 && <button onClick={clearFilters} className="text-xs font-semibold text-zinc-500 hover:text-rose-300">Clear all</button>}</FilterGroup>
              <FilterGroup label={<span className="flex items-center justify-between w-full">Min Virality Score <span className={cn("font-semibold", minViralityScore > 0 ? "text-[#ff3d6a]" : "text-zinc-500")}>{minViralityScore > 0 ? `≥${minViralityScore}/10` : "Any"}</span></span>}>
                <div className="flex w-full flex-col gap-1.5 pt-1">
                  <input type="range" min={0} max={10} step={1} value={minViralityScore}
                    onChange={(e) => { setMinViralityScore(Number(e.target.value)); setPage(1); }}
                    className="h-[3px] w-full cursor-pointer appearance-none rounded-full bg-white/[.08] accent-[#ff3d6a]"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-600">
                    <span>Any</span><span>Balanced</span><span>Viral only</span>
                  </div>
                </div>
              </FilterGroup>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="grid min-w-0 flex-1 xl:grid-cols-[minmax(0,1fr)_420px]" style={{ alignItems: "start" }}>
          <div className="min-w-0 p-3 sm:p-4 xl:p-5">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center">
                <div className="text-4xl opacity-20">✂</div>
                <p className="font-display text-[15px] font-semibold text-zinc-400">{clips.length === 0 ? "No clips yet" : "No clips match filters"}</p>
                <p className="text-xs text-zinc-600">{clips.length === 0 ? "Upload a video and run the pipeline to generate clips." : "Try adjusting your search or filters."}</p>
                {activeFilterCount > 0 && <button onClick={clearFilters} className="mt-2 text-xs font-semibold text-[#ff3d6a] hover:underline cursor-pointer">Clear all filters</button>}
              </div>
            ) : viewMode === "grid" ? (
              <VirtualizedGrid
                items={filtered}
                keyForItem={(clip) => clip.id}
                estimateRowHeight={430}
                columns={[{ minWidth: 768, columns: 3 }]}
                renderItem={(clip, i) => (
                  <div className="relative">
                    <UniversalClipCard
                      clip={clip}
                      active={clip.id === selectedId}
                      onClick={() => setSelectedId(clip.id)}
                      delay={(i % 12) * 35}
                      isPosted={postedClipIds.has(clip.id)}
                      isScheduled={scheduledClipIds.has(clip.id)}
                      posts={postsByClipId.get(clip.id) ?? []}
                    />

                  </div>
                )}
              />
            ) : (
              <VirtualizedList
                items={filtered}
                keyForItem={(clip) => clip.id}
                estimateRowHeight={92}
                className="overflow-hidden rounded-[16px] border border-white/[.06] bg-white/[.012]"
                renderItem={(clip) => {
                  const isPosted = postedClipIds.has(clip.id);
                  const isScheduled = scheduledClipIds.has(clip.id);
                  const platCfg = CARD_PLAT_CFG[clip.platform?.toLowerCase() ?? ""] ?? null;
                  const score = clip.score ?? 0;
                  const scorePct = Math.min(100, Math.round(score * 10));
                  const scoreColor = score >= 7 ? "#34d399" : score >= 4 ? "#fbbf24" : "#f87171";
                  const aiCaption = clip.clip_metadata?.platforms?.[clip.platform ?? ""]?.description ?? clip.clip_metadata?.ai_title ?? null;
                  const hashtags = clip.clip_metadata?.platforms?.[clip.platform ?? ""]?.tags ?? [];
                  const mostRecentPost = (postsByClipId.get(clip.id) ?? [])[0];
                  return (
                    <button onClick={() => setSelectedId(clip.id)} className={cn("w-full flex items-start gap-3 px-3 py-3.5 text-left transition hover:bg-white/[.025] cursor-pointer sm:gap-4 sm:px-5 sm:py-4", selectedId === clip.id ? "bg-[#ff3d6a]/[.035] border-l-[3px] border-l-[#ff3d6a]/60" : "border-l-[3px] border-l-transparent")}>
                      <div className="relative h-16 w-[42px] shrink-0 overflow-hidden rounded-[7px] bg-white/[.04]">
                        {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="h-full w-full bg-gradient-to-br from-rose-600/40 to-violet-700/40" />}
                        {isPosted && <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/55 backdrop-blur-[1px]"><svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M20 6 9 17l-5-5"/></svg></div>}
                        {!isPosted && isScheduled && <div className="absolute inset-0 flex items-center justify-center bg-blue-500/50 backdrop-blur-[1px]"><svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
                          <p className="flex-1 truncate text-[13px] font-semibold leading-[1.3]">{clip.title ?? "Untitled clip"}</p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge variant={clip.status === "ready" ? "ready" : ["pending_upload","uploading"].includes(clip.status) ? "warn" : clip.status === "upload_failed" ? "error" : clip.status === "processing" ? "warn" : "muted"}>{clip.status === "pending_upload" ? "queued" : clip.status === "upload_failed" ? "failed" : clip.status}</Badge>
                            {isPosted && <span className="rounded-full bg-amber-500/20 px-1.5 py-px text-[9px] font-bold text-amber-400">Live</span>}
                            {!isPosted && isScheduled && <span className="rounded-full bg-blue-500/15 px-1.5 py-px text-[9px] font-bold text-blue-400">Queued</span>}
                          </div>
                        </div>

                        {aiCaption && <p className="truncate text-[11px] text-zinc-500 leading-[1.4]">{aiCaption}</p>}

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                            {platCfg && <span className="h-1.5 w-1.5 rounded-full shrink-0 inline-block" style={{ background: platCfg.color }} />}
                            <span className="capitalize">{clip.platform ?? "—"}</span>
                          </span>
                          <span className="text-zinc-700">·</span>
                          <span className="text-[11px] text-zinc-500">{formatDuration(clip.duration_ms)}</span>
                          {hashtags.length > 0 && <>
                            <span className="text-zinc-700">·</span>
                            <span className="text-[11px] text-zinc-600">{hashtags.length} tag{hashtags.length !== 1 ? "s" : ""}</span>
                          </>}
                          {mostRecentPost && <>
                            <span className="text-zinc-700">·</span>
                            <span className="text-[11px]" style={{ color: mostRecentPost.status === "posted" ? "#34d399" : mostRecentPost.status === "failed" ? "#f87171" : "#60a5fa" }}>
                              {mostRecentPost.status === "posted" && mostRecentPost.posted_at
                                ? new Date(mostRecentPost.posted_at).toLocaleDateString([], { month: "short", day: "numeric" })
                                : mostRecentPost.status === "failed" ? "failed"
                                : `due ${new Date(mostRecentPost.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                            </span>
                          </>}
                          <span className="text-zinc-700">·</span>
                          <span className="text-[11px] text-zinc-600">{new Date(clip.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>

                          <div className="w-full flex items-center gap-2 shrink-0 sm:ml-auto sm:w-auto">
                            <div className="h-1 w-20 rounded-full bg-white/[.06] overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${scorePct}%`, background: scoreColor }} />
                            </div>
                            <span className="font-mono text-[11px] font-bold w-7 text-right" style={{ color: scoreColor }}>{clip.score != null ? clip.score.toFixed(1) : "--"}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                }}
              />
            )}
            <Pagination
              page={page}
              perPage={perPage}
              total={totalClips}
              itemLabel="clips"
              onPageChange={(next) => {
                setPage(next);
                setSelectedId(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="mt-4 rounded-[14px] border border-white/[.06] bg-white/[.012]"
            />
          </div>

          {/* Clip details sidebar */}
          <div className="hidden border-l border-white/[.07] bg-[#0b101a] xl:flex xl:flex-col" style={{ position: "sticky", top: 0, height: "calc(100vh - 180px)", overflowY: "auto" }}>
            {drawer ? (() => {
              const platformKey = drawer.platform ?? "shorts";
              const platformContent = drawer.clip_metadata?.platforms?.[platformKey] ?? drawer.clip_metadata?.platforms?.shorts ?? null;
              const allPlatformEntries = Object.entries(drawer.clip_metadata?.platforms ?? {});
              const primaryDescription = platformContent?.description ?? drawer.clip_metadata?.ai_title ?? drawer.title ?? "";
              const primaryTags = platformContent?.tags ?? [];
              const clipPosts = posts.filter((p) => p.clip_id === drawer.id).sort((a,b) => new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
              const clipStart = drawer.start_ms != null ? formatDuration(drawer.start_ms) : "--:--";
              const clipEnd = drawer.end_ms != null ? formatDuration(drawer.end_ms) : "--:--";
              const score = drawer.score ?? 0;
              const scorePct = Math.min(100, Math.round(score * 10));
              const scoreColor = score >= 7 ? "#34d399" : score >= 4 ? "#fbbf24" : "#f87171";
              const captionLineCount = drawer.caption_srt ? drawer.caption_srt.split(/\n\n+/).filter(Boolean).length : 0;
              const cleanCaptionPreview = drawer.caption_srt
                ? drawer.caption_srt
                    .split("\n")
                    .filter((line) => line && !/^\d+$/.test(line) && !line.includes("-->"))
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .slice(0, 220)
                : "";
              const PLAT_CFG: Record<string, { color: string; icon: string }> = {
                youtube:{color:"#FF0000",icon:"▶"},shorts:{color:"#FF0000",icon:"▶"},
                tiktok:{color:"#69C9D0",icon:"♪"},reels:{color:"#E1306C",icon:"◈"},
                instagram:{color:"#E1306C",icon:"◈"},twitter:{color:"#1DA1F2",icon:"𝕏"},
                facebook:{color:"#1877F2",icon:"f"},linkedin:{color:"#0A66C2",icon:"in"},
              };
              return (
              <div className="flex flex-col overflow-y-auto">
                <div className="border-b border-white/[.06] bg-gradient-to-b from-white/[.025] to-transparent p-4">
                  <div className="grid gap-4 md:grid-cols-[176px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[176px_minmax(0,1fr)]">
                    <div className="mx-auto w-full max-w-[176px]"><ShortsPlayer key={drawer.id} clip={drawer} /></div>

                    <div className="min-w-0 space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="min-w-0 text-[16px] font-bold leading-[1.25] tracking-[-.01em] text-white line-clamp-3">{drawer.clip_metadata?.ai_title ?? drawer.title ?? "Untitled clip"}</h2>
                          <Badge variant={drawer.status === "ready" ? "ready" : ["pending_upload","uploading"].includes(drawer.status) ? "warn" : drawer.status === "upload_failed" ? "error" : drawer.status === "processing" ? "warn" : "muted"}>{drawer.status === "pending_upload" ? "queued" : drawer.status === "upload_failed" ? "failed" : drawer.status}</Badge>
                        </div>
                        {primaryDescription && <p className="line-clamp-3 text-[12px] leading-5 text-zinc-400">{primaryDescription}</p>}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-[10px] border border-white/[.06] bg-white/[.025] p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-[.12em] text-zinc-600">Score</p>
                          <div className="mt-1 flex items-end gap-2">
                            <span className="font-display text-[22px] font-black leading-none" style={{ color: scoreColor }}>{drawer.score != null ? drawer.score.toFixed(1) : "--"}</span>
                            <div className="mb-1 h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ width: `${scorePct}%`, background: scoreColor }} /></div>
                          </div>
                        </div>
                        <div className="rounded-[10px] border border-white/[.06] bg-white/[.025] p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-[.12em] text-zinc-600">Duration</p>
                          <p className="mt-1 font-display text-[22px] font-black leading-none text-white">{formatDuration(drawer.duration_ms)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        {([["Platform", drawer.platform ?? "—"], ["Format", "9:16"], ["Timeline", `${clipStart}–${clipEnd}`], ["Created", new Date(drawer.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })]] as [string,string][]).map(([label, value]) => (
                          <div key={label} className="rounded-[9px] border border-white/[.05] bg-white/[.018] px-2.5 py-2">
                            <p className="text-[9px] font-bold uppercase tracking-[.1em] text-zinc-600">{label}</p>
                            <p className="mt-0.5 truncate font-semibold text-zinc-200 capitalize">{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {/* AI Tag Suggestions */}
                  {(() => {
                    const isSuggestingThisClip = suggestingTags && tagSuggestClipId === drawer.id;
                    const suggestionsForClip = tagSuggestions && tagSuggestClipId === drawer.id ? tagSuggestions : null;
                    const displayPrimaryTags = suggestionsForClip
                      ? suggestionsForClip.primary_hashtags.map((t) => t.replace(/^#/, ""))
                      : primaryTags;
                    const displayPlatformEntries: [string, { description: string; tags: string[] }][] = suggestionsForClip
                      ? Object.entries(suggestionsForClip.platforms)
                      : allPlatformEntries;
                    return (
                      <>
                        <section className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-[.13em] text-zinc-600">Primary hashtags</p>
                            <div className="flex items-center gap-1.5">
                              {displayPrimaryTags.length > 0 && <span className="text-[10px] text-zinc-600">{displayPrimaryTags.length}</span>}
                              <button
                                onClick={() => handleSuggestTags(drawer)}
                                disabled={isSuggestingThisClip}
                                className="flex items-center gap-1 rounded-full border border-[#ff3d6a]/30 bg-[#ff3d6a]/10 px-2 py-0.5 text-[9px] font-bold text-rose-300 transition hover:bg-[#ff3d6a]/20 disabled:opacity-50"
                              >
                                {isSuggestingThisClip ? (
                                  <><span className="inline-block h-2 w-2 animate-spin rounded-full border border-rose-300 border-t-transparent" /> Searching...</>
                                ) : (
                                  <>✦ AI Suggest</>
                                )}
                              </button>
                              {suggestionsForClip && (
                                <button
                                  onClick={() => handleSaveAiSuggestions(drawer, suggestionsForClip)}
                                  disabled={savingTags}
                                  className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                  {savingTags ? (
                                    <><span className="inline-block h-2 w-2 animate-spin rounded-full border border-emerald-300 border-t-transparent" /> Saving...</>
                                  ) : savedTagClipId === drawer.id ? (
                                    <>✓ Saved</>
                                  ) : (
                                    <>↓ Save</>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                          {tagSuggestError && tagSuggestClipId === drawer.id && (
                            <p className="mb-2 text-[10px] text-red-400">{tagSuggestError}</p>
                          )}
                          {displayPrimaryTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {displayPrimaryTags.slice(0, 12).map((tag) => <span key={tag} className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 px-2 py-1 text-[10px] font-semibold text-rose-200">#{tag}</span>)}
                            </div>
                          ) : !isSuggestingThisClip && (
                            <p className="text-[10px] text-zinc-600">No tags yet — click AI Suggest to generate trending hashtags.</p>
                          )}
                        </section>

                        {displayPlatformEntries.length > 0 && (
                          <section className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[.13em] text-zinc-600">Platform copy</p>
                            <div className="space-y-2">
                              {displayPlatformEntries.slice(0, 6).map(([platform, content]) => {
                                const pcfg = PLAT_CFG[platform.toLowerCase()] ?? {color:"#ff3d6a",icon:"↗"};
                                return <PlatformCopyCard key={platform} platform={platform} content={content} pcfg={pcfg} />;
                              })}
                            </div>
                          </section>
                        )}
                      </>
                    );
                  })()}

                  {clipPosts.length > 0 && (
                    <section className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[.13em] text-zinc-600">Published / scheduled</p>
                      <div className="space-y-1.5">
                        {clipPosts.map((p) => {
                          const pcfg = PLAT_CFG[p.platform?.toLowerCase() ?? ""] ?? {color:"#ff3d6a",icon:"↗"};
                          const isLive = p.status==="posted", isQ=["scheduled","pending","processing"].includes(p.status), isFail=p.status==="failed";
                          return (
                            <div key={p.id} className="flex items-center gap-2 rounded-[9px] border px-2.5 py-2" style={{borderColor:isLive?"rgba(52,211,153,.2)":isQ?"rgba(96,165,250,.18)":isFail?"rgba(248,113,113,.18)":"rgba(255,255,255,.06)",background:isLive?"rgba(52,211,153,.05)":isQ?"rgba(96,165,250,.04)":"rgba(255,255,255,.015)"}}>
                              <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-black text-white" style={{background:pcfg.color}}>{pcfg.icon}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[12px] font-bold capitalize" style={{color:pcfg.color}}>{p.platform}</span>
                                  {isLive&&<span className="rounded-full bg-amber-500/20 px-1.5 py-px text-[8px] font-bold text-amber-400">✓ Live</span>}
                                  {isQ&&<span className="rounded-full bg-blue-500/15 px-1.5 py-px text-[8px] font-bold text-blue-400">Queued</span>}
                                  {isFail&&<span className="rounded-full bg-red-500/15 px-1.5 py-px text-[8px] font-bold text-red-400">Failed</span>}
                                </div>
                                <p className="truncate text-[10px] text-zinc-600">{isLive&&p.posted_at?new Date(p.posted_at).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):isQ?new Date(p.scheduled_at).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):isFail?(p.last_error??"—"):new Date(p.created_at).toLocaleString([],{month:"short",day:"numeric"})}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  <section className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[.13em] text-zinc-600">Assets</p>
                      <span className="text-[10px] text-zinc-600">{captionLineCount} captions</span>
                    </div>
                    {cleanCaptionPreview && <p className="mb-2 line-clamp-3 text-[11px] leading-4 text-zinc-500">{cleanCaptionPreview}…</p>}
                    <div className="grid grid-cols-2 gap-1.5">
                      {drawer.storage_url && <a className="rounded-[8px] border border-white/[.06] bg-white/[.025] px-2 py-1.5 text-center text-[10px] font-semibold text-zinc-300 hover:bg-white/[.05]" href={drawer.storage_url} target="_blank" rel="noreferrer">Open video</a>}
                      {drawer.thumbnail_url && <a className="rounded-[8px] border border-white/[.06] bg-white/[.025] px-2 py-1.5 text-center text-[10px] font-semibold text-zinc-300 hover:bg-white/[.05]" href={drawer.thumbnail_url} target="_blank" rel="noreferrer">Open thumbnail</a>}
                    </div>
                    <div className="mt-2 space-y-1 text-[9px] text-zinc-700">
                      <p className="truncate">Clip ID: {drawer.id}</p>
                      <p className="truncate">Video ID: {drawer.video_id}</p>
                    </div>
                  </section>



                  <div className="sticky bottom-0 space-y-2 bg-[#0b101a]/95 pt-1 backdrop-blur">
                    <Button className="w-full h-9 bg-[#ff3d6a] hover:bg-[#e8304f] text-white text-[13px] font-semibold" onClick={() => setPublishOpen(true)}>
                      {drawerPosted ? "Publish again" : drawerScheduled ? "Reschedule" : "Publish"}
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button className="h-8 text-[12px]" variant="secondary" onClick={() => setEditClip(drawer)}>Edit clip</Button>
                      <Button
                        className="h-8 text-[12px]"
                        variant="ghost"
                        disabled={!drawer?.storage_url}
                        onClick={() => { if (drawer?.storage_url) void downloadUrl(drawer.storage_url, safeFilename(drawer.title, "mp4")); }}
                      >
                        Download
                      </Button>
                    </div>
                    <Button
                      className="w-full h-8 text-[12px]"
                      variant="secondary"
                      disabled={upscalingId === drawer.id || !drawer.storage_url}
                      onClick={async () => {
                        setUpscalingId(drawer.id);
                        try {
                          const updated = await videoApi.upscaleClip(drawer.id, "4K");
                          setClips((prev) => prev.map((c) => c.id === updated.id ? updated : c));
                        } finally {
                          setUpscalingId(null);
                        }
                      }}
                    >
                      {upscalingId === drawer.id ? "Upscaling…" : drawer.upscaled_storage_url ? "⬆ Upscaled ✓" : "⬆ Upscale 4K"}
                    </Button>
                  </div>
                </div>
              </div>
              );
            })() : <div className="flex h-full items-center justify-center text-xs text-zinc-600">Select a clip</div>}
          </div>
        </div>
      </div>
      {publishOpen && drawer && <PublishModal clip={drawer} onClose={() => setPublishOpen(false)} />}
      {editClip && (
        <VideoEditor
          clip={editClip}
          onClose={() => setEditClip(null)}
          onPost={() => { setSelectedId(editClip.id); setPublishOpen(true); setEditClip(null); }}
        />
      )}
    </>
  );
}


