import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClipApiResponse, ScheduledPost } from "@/lib/api";

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "--:--";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PLATFORM_CFG: Record<string, { color: string; icon: string; label: string }> = {
  youtube: { color: "#FF0000", icon: "▶", label: "YouTube" },
  shorts: { color: "#FF0000", icon: "▶", label: "Shorts" },
  tiktok: { color: "#69C9D0", icon: "♪", label: "TikTok" },
  reels: { color: "#E1306C", icon: "◇", label: "Reels" },
  instagram: { color: "#E1306C", icon: "◈", label: "Instagram" },
  twitter: { color: "#1DA1F2", icon: "𝕏", label: "Twitter" },
  facebook: { color: "#1877F2", icon: "f", label: "Facebook" },
  linkedin: { color: "#0A66C2", icon: "in", label: "LinkedIn" },
};

export type ClipCardAction = "publish" | "trim" | "edit" | "transcript" | "download" | "preview" | "regenerate";

type ActionConfig = {
  id: ClipCardAction;
  label?: string;
  icon?: string;
  primary?: boolean;
  disabled?: boolean;
  onClick?: (clip: ClipApiResponse) => void;
};

export function UniversalClipCard({
  clip,
  delay = 0,
  active = false,
  selected = false,
  selectable = false,
  isPosted = false,
  isScheduled = false,
  posts = [],
  density = "comfortable",
  actions = [],
  onClick,
  onSelect,
  onClipChange,
}: {
  clip: ClipApiResponse;
  delay?: number;
  active?: boolean;
  selected?: boolean;
  selectable?: boolean;
  isPosted?: boolean;
  isScheduled?: boolean;
  posts?: ScheduledPost[];
  density?: "compact" | "comfortable";
  actions?: ActionConfig[];
  onClick?: (clip: ClipApiResponse) => void;
  onSelect?: (clip: ClipApiResponse) => void;
  onClipChange?: (clip: ClipApiResponse) => void;
}) {
  const [localClip, setLocalClip] = useState(clip);
  const [playing, setPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => setLocalClip(clip), [clip]);

  const durMs = localClip.duration_ms ?? ((localClip.end_ms ?? 0) - (localClip.start_ms ?? 0));
  const scoreValue = localClip.score ?? 0;
  const score = localClip.score != null ? localClip.score.toFixed(1) : "--";
  const scorePct = Math.min(100, Math.round(scoreValue * 10));
  const scoreColor = scoreValue >= 7 ? "#34d399" : scoreValue >= 4 ? "#fbbf24" : "#f87171";
  const platformKey = localClip.platform ?? "shorts";
  const platformContent = localClip.clip_metadata?.platforms?.[platformKey] ?? localClip.clip_metadata?.platforms?.shorts ?? null;
  const title = localClip.clip_metadata?.ai_title ?? localClip.title ?? "Untitled clip";
  const viralReason = localClip.clip_metadata?.viral_reason;
  const description = platformContent?.description ?? viralReason ?? null;
  const tags = platformContent?.tags ?? [];
  const clipStart = localClip.start_ms != null ? formatDuration(localClip.start_ms) : null;
  const clipEnd = localClip.end_ms != null ? formatDuration(localClip.end_ms) : null;
  const platCfg = PLATFORM_CFG[localClip.platform?.toLowerCase() ?? ""] ?? { color: "#ff3d6a", icon: "↗", label: localClip.platform ?? "Clip" };
  const hasVideo = Boolean(localClip.storage_url);
  const p = density === "compact" ? "p-3.5" : "p-4";

  const postedPlatforms = useMemo(() => Array.from(
    posts.reduce((map, post) => {
      const key = post.platform?.toLowerCase() ?? "";
      const existing = map.get(key);
      const rank = (s: string) => s === "posted" ? 2 : ["scheduled", "pending", "processing"].includes(s) ? 1 : 0;
      if (!existing || rank(post.status) > rank(existing.status)) map.set(key, post);
      return map;
    }, new Map<string, ScheduledPost>()).values()
  ), [posts]);

  function togglePlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setPlaying(true);
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  }

  function runAction(action: ActionConfig, e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    if (action.id === "preview") { togglePlay(e); return; }
    if (action.id === "transcript") { setShowTranscript((v) => !v); action.onClick?.(localClip); return; }
    action.onClick?.(localClip);
  }

  function defaultIcon(id: ClipCardAction) {
    return id === "publish" ? "↗" : id === "trim" ? "✂" : id === "edit" ? "✎" : id === "transcript" ? "☷" : id === "download" ? "↓" : id === "regenerate" ? "✦" : "▶";
  }

  const primaryAction = actions.find((a) => a.primary) ?? actions.find((a) => a.id === "publish");
  const secondaryActions = actions.filter((a) => a !== primaryAction);

  return (
    <article
      onClick={() => onClick?.(localClip)}
      className={cn(
        "group overflow-hidden rounded-[16px] border bg-[#0e1420] text-left transition hover:-translate-y-0.5 hover:border-white/[.13] hover:shadow-[0_18px_50px_rgba(0,0,0,.32)]",
        onClick && "cursor-pointer",
        active || selected ? "border-[#ff3d6a]/45 shadow-[0_0_0_1px_rgba(255,61,106,.12)]" : "border-white/[.07]"
      )}
      style={{ animation: `fadeUp .28s ${delay}ms cubic-bezier(.22,.8,.4,1) both` }}
    >
      <div className="relative aspect-video overflow-hidden bg-black">
        {hasVideo ? (
          <video ref={videoRef} src={localClip.storage_url!} poster={localClip.thumbnail_url ?? undefined} className="absolute inset-0 h-full w-full object-cover" playsInline preload="metadata" onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
        ) : localClip.thumbnail_url ? (
          <img src={localClip.thumbnail_url} alt={title} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-rose-600/35 via-violet-700/25 to-sky-600/25" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/20" />

        {selectable && (
          <button onClick={(e) => { e.stopPropagation(); onSelect?.(localClip); }} className={cn("absolute left-3 top-3 z-[2] grid h-7 w-7 place-items-center rounded-[8px] border text-[12px] font-black transition", selected ? "border-[#ff3d6a] bg-[#ff3d6a] text-white" : "border-white/20 bg-black/45 text-transparent hover:text-white")}>
            ✓
          </button>
        )}

        <div className={cn("absolute z-[1] grid h-7 w-7 place-items-center rounded-[8px] border border-white/10 bg-black/55 text-[12px] font-black text-white backdrop-blur", selectable ? "left-12 top-3" : "left-3 top-3")} style={{ color: platCfg.color }}>{platCfg.icon}</div>

        {(isPosted || isScheduled) && (
          <div className={cn("absolute right-3 top-3 z-[1] flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm", isPosted ? "bg-amber-500/90" : "bg-blue-500/80")}>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>{isPosted ? <path d="M20 6 9 17l-5-5"/> : <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>}</svg>
            <span>{isPosted ? "Live" : "Queued"}</span>
          </div>
        )}

        {/* Upload in-progress / failed overlays */}
        {(localClip.status === "pending_upload" || localClip.status === "uploading") && (
          <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-[2px]">
            <svg className="h-6 w-6 animate-spin text-white/80" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-[11px] font-semibold text-white/70">
              {localClip.status === "uploading" ? "Uploading…" : "Queued"}
            </span>
          </div>
        )}
        {localClip.status === "upload_failed" && (
          <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 bg-black/70">
            <span className="text-[22px]">⚠</span>
            <span className="text-[11px] font-bold text-red-400">Upload failed</span>
          </div>
        )}

        {hasVideo && (
          <button onClick={togglePlay} className="absolute inset-0 grid place-items-center">
            {!playing && <div className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur transition group-hover:scale-105">▶</div>}
          </button>
        )}

        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
          <div className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold capitalize text-white/90 backdrop-blur">{platCfg.label}</div>
          <div className="rounded-[7px] bg-black/65 px-2 py-1 font-mono text-[11px] font-bold text-white">{formatDuration(durMs)}</div>
        </div>
      </div>

      <div className={cn("space-y-3", p)}>
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 min-h-10 flex-1 text-[15px] font-bold leading-5 tracking-[-.01em] text-white">{title}</h3>
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.025] px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: scoreColor }} />
              <span className="font-mono text-[11px] font-bold" style={{ color: scoreColor }}>{score}</span>
            </div>
          </div>
          {description && <p className="line-clamp-2 min-h-9 text-[12px] leading-[1.45] text-zinc-500">{description}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
          <Badge variant={localClip.status === "ready" ? "ready" : ["pending_upload","uploading"].includes(localClip.status) ? "warn" : localClip.status === "upload_failed" ? "error" : localClip.status === "processing" ? "warn" : "muted"}>{localClip.status === "pending_upload" ? "queued" : localClip.status === "upload_failed" ? "failed" : localClip.status}</Badge>
          <span className="rounded-full bg-white/[.035] px-2 py-1">{tags.length} tags</span>
          <span className="rounded-full bg-white/[.035] px-2 py-1">{new Date(localClip.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          {clipStart && clipEnd && <span className="rounded-full bg-white/[.035] px-2 py-1 font-mono">{clipStart}–{clipEnd}</span>}
          <span className="rounded-full bg-white/[.035] px-2 py-1">9:16</span>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ width: `${scorePct}%`, background: scoreColor }} /></div>

        {(postedPlatforms.length > 0 || tags.length > 0) && (
          <div className="space-y-2 border-t border-white/[.06] pt-3">
            {postedPlatforms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {postedPlatforms.slice(0, 2).map((post) => {
                  const pcfg = PLATFORM_CFG[post.platform?.toLowerCase() ?? ""] ?? { color: "#ff3d6a", icon: "↗", label: post.platform ?? "Post" };
                  const isLive = post.status === "posted";
                  const isQ = ["scheduled", "pending", "processing"].includes(post.status);
                  return (
                    <span key={post.id} className="flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold" style={{ borderColor: `${pcfg.color}35`, background: `${pcfg.color}10`, color: pcfg.color }}>
                      <span>{pcfg.icon}</span><span>{pcfg.label}</span>{isLive && <span>✓</span>}{isQ && <span>⏱</span>}
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

        {showTranscript && localClip.caption_srt && (
          <div className="max-h-28 overflow-y-auto rounded-[9px] border border-white/[.07] bg-white/[.025] px-3 py-2 font-mono text-[10.5px] leading-[1.55] text-zinc-500">
            {localClip.caption_srt}
          </div>
        )}

        {actions.length > 0 && (
          <div className="flex items-center gap-2 border-t border-white/[.06] pt-3">
            {primaryAction && (
              <button onClick={(e) => runAction(primaryAction, e)} disabled={primaryAction.disabled} className="flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_2px_10px_rgba(255,61,106,.22)] transition hover:bg-[#ff527a] disabled:opacity-50">
                <span>{primaryAction.icon ?? defaultIcon(primaryAction.id)}</span>{primaryAction.label ?? primaryAction.id}
              </button>
            )}
            {secondaryActions.slice(0, 2).map((action) => (
              <button key={action.id} onClick={(e) => runAction(action, e)} disabled={action.disabled} className="min-h-8 rounded-[9px] border border-white/[.07] bg-white/[.025] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-400 transition hover:bg-white/[.06] hover:text-white disabled:opacity-50">
                <span>{action.icon ?? defaultIcon(action.id)}</span><span className="sr-only">{action.label ?? action.id}</span>
              </button>
            ))}
            {secondaryActions.length > 2 && (
              <div className="relative">
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }} className="min-h-8 rounded-[9px] border border-white/[.07] bg-white/[.025] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-400 transition hover:bg-white/[.06] hover:text-white">•••</button>
                {menuOpen && (
                  <div className="absolute bottom-full right-0 z-30 mb-2 w-40 overflow-hidden rounded-[10px] border border-white/[.08] bg-[#0d1420] shadow-2xl">
                    {secondaryActions.slice(2).map((action) => (
                      <button key={action.id} onClick={(e) => runAction(action, e)} disabled={action.disabled} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold text-zinc-400 hover:bg-white/[.05] hover:text-white disabled:opacity-50">
                        <span>{action.icon ?? defaultIcon(action.id)}</span>{action.label ?? action.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export { PLATFORM_CFG as CLIP_CARD_PLATFORM_CFG };
