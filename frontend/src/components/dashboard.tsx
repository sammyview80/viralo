import type { ComponentType, HTMLAttributes } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/query";
import { cn } from "@/lib/utils";
import {
  platformApi,
  videoApi,
  type AnalyticsOverview,
  type ClipApiResponse,
  type ScheduledPost,
  type VideoResponse,
} from "@/lib/api";
import { navigate } from "@/lib/router";
import { Shell } from "@/workspace/Shell";

type IconProps = HTMLAttributes<HTMLSpanElement>;

function icon(label: string): ComponentType<IconProps> {
  const Icon = ({ className, ...props }: IconProps) => (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center justify-center font-bold leading-none", className)}
      {...props}
    >
      {label}
    </span>
  );
  Icon.displayName = `Icon${label}`;
  return Icon;
}

const ChevronRight = icon(">");
const CircleDot = icon("o");
const Clapperboard = icon("#");
const Flame = icon("^");
const Film = icon("=");
const Inbox = icon("_");
const MoreHorizontal = icon("...");
const Play = icon(">");
const Sparkles = icon("+");
const TrendingUp = icon("^");
const Upload = icon("^");
const WandSparkles = icon("*");

const workflows = [
  {
    name: "Daily TikTok from Reddit trending",
    last: "23 min ago",
    icon: Flame,
    tone: "text-orange-200 bg-orange-400/10 border-orange-300/20",
    on: true,
  },
  {
    name: "YouTube to 3 Shorts + captions",
    last: "1 hr ago",
    icon: Film,
    tone: "text-rose-200 bg-rose-400/10 border-rose-300/20",
    on: true,
  },
  {
    name: "Comment digest to Slack",
    last: "Yesterday",
    icon: Inbox,
    tone: "text-sky-200 bg-sky-400/10 border-sky-300/20",
    on: false,
  },
];

const chartBars = [42, 55, 38, 70, 64, 82, 74, 93, 88, 106, 98, 118, 110, 132, 126, 149, 136, 158];

const GRAD_POOL = [
  "from-[#ff3d6a] to-[#ff7a3d]",
  "from-[#3daaff] to-[#7b66ff]",
  "from-[#22c55e] to-[#3daaff]",
  "from-[#a855f7] to-[#3daaff]",
  "from-[#f59e0b] to-[#ef4444]",
];

function Platform({ id, size = "sm" }: { id: string; size?: "xs" | "sm" }) {
  const map: Record<string, [string, string]> = {
    tt: ["♪", "bg-zinc-950 text-white border-c-border"],
    ig: ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white border-c-border"],
    yt: ["▶", "bg-red-500 text-white border-red-300/20"],
    tw: ["𝕏", "bg-zinc-100 text-zinc-950 border-white/20"],
    tiktok: ["♪", "bg-zinc-950 text-white border-c-border"],
    instagram: ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white border-c-border"],
    youtube: ["▶", "bg-red-500 text-white border-red-300/20"],
    twitter: ["𝕏", "bg-zinc-100 text-zinc-950 border-white/20"],
  };
  const [label, cls] = map[id] ?? map.tt;
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-[5px] border font-bold leading-none",
        size === "xs" ? "h-[18px] w-[18px] text-[8px]" : "h-7 w-7 text-xs",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ready = status === "Ready" || status === "completed" || status === "ready";
  const label = ready ? "Ready" : status === "processing" ? "Processing" : status;
  return (
    <Badge variant={ready ? "ready" : "warn"}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-300" : "bg-amber-300")} />
      {label}
    </Badge>
  );
}

function formatDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function formatScheduledDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = d.toDateString() === now.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const date = isToday ? "Today" : isTomorrow ? "Tomorrow" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return { date, time };
}

function StatStrip() {
  const { data, loading, error } = useQuery<AnalyticsOverview>(
    "dashboard:analytics:overview",
    () => platformApi.analyticsOverview("7d"),
  );

  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);

  const stats: [string, string, string, string][] = (data || error)
    ? [
        ["Views", "this week", data ? fmt(data.total_views) : "0", error ? "Fetch error" : ""],
        ["Engagement", "rate", data ? `${data.engagement_rate.toFixed(1)}%` : "0%", error ? "Fetch error" : ""],
        ["Likes", "total", data ? fmt(data.total_likes) : "0", error ? "Fetch error" : ""],
        ["Posts", "published", data ? String(data.posts_count) : "0", error ? "Fetch error" : ""],
      ]
    : [
        ["Views", "this week", "—", ""],
        ["Engagement", "rate", "—", ""],
        ["Likes", "total", "—", ""],
        ["Posts", "published", "—", ""],
      ];

  return (
    <div className="grid overflow-hidden rounded-[14px] border border-c-border bg-surface-1 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(([label, sub, val, errHint], index) => (
        <div key={label} className="relative border-c-border p-6 sm:border-r sm:last:border-r-0">
          <div className="mb-2.5 flex gap-1 text-[10.5px] font-semibold uppercase tracking-[.1em] text-c-text-muted">
            {label} <em className="font-normal normal-case tracking-normal opacity-60">{sub}</em>
            {errHint && (
              <span className="ml-1 text-red-500/80" title={errHint}>⚠</span>
            )}
          </div>
          {loading ? (
            <Skeleton className="mb-2.5 h-9 w-24" />
          ) : (
            <div className={cn("mb-2.5 font-display text-3xl font-bold leading-none tracking-[-.03em]", error ? "text-c-text-muted" : "")}>{val}</div>
          )}
          {loading ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <div className="flex items-center gap-2 text-[10.5px]">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 font-semibold text-emerald-300">
                <TrendingUp className="h-2.5 w-2.5" />
                live
              </span>
              <span className="text-c-text-muted">7-day period</span>
            </div>
          )}
          {index === 3 ? <span className="sr-only">end</span> : null}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-[13px] font-semibold text-c-text-secondary">{title}</h3>
      {action ? (
        <a className="inline-flex items-center gap-1 text-[11.5px] font-medium text-c-text-muted hover:text-c-text-secondary">
          {action}
          <ChevronRight className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function VideoListSkeleton() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[52px_1fr_auto] items-center gap-3.5 px-2 py-2.5 border-b border-c-border last:border-0">
          <Skeleton className="h-[34px] w-[52px] rounded-[7px]" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function VideoList() {
  const { data, loading } = useQuery(
    "dashboard:videos:recent",
    () => videoApi.list(1, 5),
  );

  const videos = data?.items ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-c-text-secondary">Recent videos</h3>
        <a onClick={() => navigate("/clips")} className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-c-text-muted hover:text-c-text-secondary">
          Open library <ChevronRight className="h-3 w-3" />
        </a>
      </div>
      {loading ? (
        <VideoListSkeleton />
      ) : videos.length === 0 ? (
        <p className="py-4 text-center text-sm text-c-text-muted">No videos yet</p>
      ) : (
        <div>
          {videos.map((video: VideoResponse, index: number) => {
            const grad = GRAD_POOL[index % GRAD_POOL.length];
            return (
              <div
                key={video.id}
                onClick={() => navigate(`/projects/${video.id}`)}
                className={cn(
                  "grid cursor-pointer grid-cols-[52px_1fr_auto] items-center gap-3.5 px-2 py-2.5 transition hover:bg-surface-1 rounded-lg",
                  index < videos.length - 1 && "border-b border-c-border",
                )}
              >
                <div className={cn("relative grid h-[34px] w-[52px] place-items-center overflow-hidden rounded-[7px] bg-gradient-to-br", grad)}>
                  {video.thumbnail_url ? (
                    <img src={video.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <Play className="h-2.5 w-2.5 fill-white" />
                  )}
                  {video.duration_sec ? (
                    <span className="absolute bottom-0.5 right-1 font-mono text-[8px] font-semibold text-white/85">
                      {formatDuration(video.duration_sec)}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{video.title ?? "Untitled"}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-c-text-muted">
                    <span>{formatRelative(video.created_at)}</span>
                  </div>
                </div>
                <StatusBadge status={video.status} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Workflows() {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-c-text-secondary">Automations</h3>
        <a onClick={() => navigate("/workflows")} className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-c-text-muted hover:text-c-text-secondary">
          Manage <ChevronRight className="h-3 w-3" />
        </a>
      </div>
      <div>
        {workflows.map((workflow, index) => (
          <div
            key={workflow.name}
            className={cn(
              "grid grid-cols-[34px_1fr_auto] items-center gap-3 px-2 py-2.5",
              index < workflows.length - 1 && "border-b border-c-border",
            )}
          >
            <div className={cn("grid h-[34px] w-[34px] place-items-center rounded-[9px] border", workflow.tone)}>
              <workflow.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{workflow.name}</div>
              <div className="mt-0.5 text-[11px] text-c-text-muted">Last run {workflow.last}</div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={cn("min-w-5 text-[11px] font-semibold", workflow.on ? "text-emerald-300" : "text-c-text-muted")}>
                {workflow.on ? "On" : "Off"}
              </span>
              <div className={cn("h-5 w-9 rounded-full border p-0.5 transition", workflow.on ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/25" : "border-c-border bg-surface-3")}>
                <div className={cn("h-4 w-4 rounded-full bg-white transition", workflow.on && "translate-x-4 bg-[#ff3d6a]")} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ViralityCard() {
  const { data, loading } = useQuery(
    "dashboard:clips:top",
    () => videoApi.listClips(1, 1, undefined, "score"),
  );

  const clip: ClipApiResponse | null = data?.items?.[0] ?? null;
  const score = clip?.clip_metadata?.viral_score ?? clip?.score ?? null;
  const title = clip?.clip_metadata?.ai_title ?? clip?.title ?? "—";
  const circumference = 2 * Math.PI * 34;
  const dashOffset = score != null ? circumference * (1 - score / 100) : circumference;

  return (
    <Card className="border-[#ff3d6a]/15 bg-[linear-gradient(135deg,rgba(255,61,106,.07),rgba(255,61,106,.02)_60%,transparent)] p-5">
      <div className="grid items-center gap-5 sm:grid-cols-[66px_1fr_auto]">
        <div className="relative grid h-[94px] w-[66px] place-items-center overflow-hidden rounded-[10px] border border-c-border bg-gradient-to-br from-[#ff3d6a] via-[#ff7a3d] to-[#3daaff]">
          {clip?.thumbnail_url ? (
            <img src={clip.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <div className="grid h-7 w-7 place-items-center rounded-full bg-white/90">
            <Play className="h-3 w-3 fill-zinc-950 text-zinc-950" />
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#ff3d6a]">Top performer</div>
          {loading ? (
            <>
              <Skeleton className="mb-3 h-10 w-3/4" />
              <Skeleton className="h-8 w-48" />
            </>
          ) : (
            <>
              <h2 className="mb-3 font-display text-sm font-bold leading-snug">{title}</h2>
              <div className="flex gap-2">
                <Button size="sm">
                  <Sparkles className="h-3 w-3" />
                  Remix
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate("/analytics")}>
                  Analytics
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="relative h-[76px] w-[76px]">
          {loading ? (
            <Skeleton className="h-[76px] w-[76px] rounded-full" />
          ) : (
            <>
              <svg className="-rotate-90" height="76" width="76">
                <circle cx="38" cy="38" fill="none" r="34" stroke="var(--c-border)" strokeWidth="5.5" />
                <circle
                  cx="38"
                  cy="38"
                  fill="none"
                  r="34"
                  stroke="#ff3d6a"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  strokeWidth="5.5"
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center font-display text-lg font-bold">
                {score != null ? Math.round(score) : "—"}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function UsageBars() {
  const quotas = [
    ["Videos generated", "7", "50", "14%", "bg-[#ff3d6a]"],
    ["Cloud storage", "4.2GB", "20GB", "21%", "bg-[#3daaff]"],
    ["Brainstorm", "3", "10", "30%", "bg-[#22c55e]"],
  ];
  return (
    <Card className="p-5">
      <SectionTitle title="Usage this month" />
      <div className="space-y-4">
        {quotas.map(([label, used, total, width, color]) => (
          <div key={label}>
            <div className="mb-2 flex justify-between">
              <span className="text-xs font-medium text-c-text-secondary">{label}</span>
              <span className="font-mono text-[11px] text-c-text-muted">
                {used}
                <span className="opacity-60"> / {total}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={cn("h-full rounded-full", color)} style={{ width }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function UpcomingPostsSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-[9px] border border-c-border bg-surface-2 p-2.5">
          <Skeleton className="h-7 w-7 rounded-[5px]" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

function UpcomingPosts() {
  const { data, loading } = useQuery(
    "dashboard:posts:upcoming",
    () => platformApi.listPosts({ status: "pending", per_page: 5 }),
  );

  const posts = data?.items ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-c-text-secondary">Upcoming posts</h3>
        <a onClick={() => navigate("/scheduler")} className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-c-text-muted hover:text-c-text-secondary">
          Calendar <ChevronRight className="h-3 w-3" />
        </a>
      </div>
      {loading ? (
        <UpcomingPostsSkeleton />
      ) : posts.length === 0 ? (
        <p className="py-4 text-center text-sm text-c-text-muted">No scheduled posts</p>
      ) : (
        <div className="space-y-2">
          {posts.map((post: ScheduledPost) => {
            const { date, time } = formatScheduledDate(post.scheduled_at);
            return (
              <div key={post.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-[9px] border border-c-border bg-surface-2 p-2.5">
                <Platform id={post.platform} />
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium">{post.caption ?? "—"}</div>
                  <div className="mt-0.5 text-[11px] text-c-text-muted">{date}</div>
                </div>
                <div className="font-mono text-[11.5px] font-semibold text-c-text-secondary">{time}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ChartCard() {
  const max = Math.max(...chartBars);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Audience growth</CardTitle>
          <p className="mt-1 text-xs text-c-text-muted">Views, engagement and follower lift across active channels.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/analytics")}>
          Export
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex h-[230px] items-end gap-2 border-b border-c-border pb-4">
          {chartBars.map((value, index) => (
            <div
              key={index}
              className="flex-1 rounded-t-md bg-gradient-to-t from-[#ff3d6a]/55 to-[#ff7a3d] opacity-85 transition hover:opacity-100"
              style={{ height: `${(value / max) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            ["1.8M", "total views"],
            ["91.4K", "new followers"],
            ["6.8%", "avg engagement"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-[10px] border border-c-border bg-surface-2 p-3">
              <div className="font-display text-xl font-bold tracking-tight">{value}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[.1em] text-c-text-muted">{label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StudioPanel() {
  return (
    <Card className="overflow-hidden">
      <div>
        <div className="flex items-center justify-between gap-8 p-4 sm:p-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 px-3 py-1 text-[11px] font-semibold text-rose-200">
              <WandSparkles className="h-3 w-3" />
              Creator studio
            </div>
            <h1 className="max-w-[680px] font-display text-3xl font-extrabold tracking-tight text-balance sm:text-5xl">
              Turn any idea into viral short videos.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">
              Plan hooks, generate scripts, produce clips, schedule posts and monitor performance from one focused workspace.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Button onClick={() => navigate("/studio")}>
              <Clapperboard className="h-4 w-4" />
              New video
            </Button>
            <Button variant="secondary" onClick={() => navigate("/upload")}>
              <Upload className="h-4 w-4" />
              Upload source
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function DashboardContent() {
  return (
    <div className="space-y-6">
      {/* <StudioPanel /> */}
      <StatStrip />
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4 sm:space-y-6">
          <ViralityCard />
          <ChartCard />
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <VideoList />
            <Workflows />
          </div>
        </div>
        <div className="space-y-4 sm:space-y-6">
          <UsageBars />
          <UpcomingPosts />
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-c-text-secondary">AI agents</h3>
              <a onClick={() => navigate("/brainstorm")} className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-c-text-muted hover:text-c-text-secondary">
                Open <ChevronRight className="h-3 w-3" />
              </a>
            </div>
            <div className="space-y-3">
              {["Trend scout", "Hook critic", "Script writer", "Caption editor"].map((agent, index) => (
                <div key={agent} onClick={() => navigate("/brainstorm")} className="flex cursor-pointer items-center justify-between rounded-[9px] border border-c-border bg-surface-2 p-3 transition hover:bg-surface-2">
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-surface-3 text-c-text-secondary">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium">{agent}</div>
                      <div className="text-[11px] text-c-text-muted">{index === 0 ? "Running" : "Ready"}</div>
                    </div>
                  </div>
                  <MoreHorizontal className="h-4 w-4 text-c-text-muted" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  return (
    <Shell active="dashboard">
      <DashboardContent />
    </Shell>
  );
}
