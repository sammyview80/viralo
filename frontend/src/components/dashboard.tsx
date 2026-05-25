import type { ComponentType, HTMLAttributes } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

const videos = [
  {
    title: "5 morning habits that changed my life",
    status: "Ready",
    date: "12 min ago",
    dur: "0:47",
    plats: ["tt", "ig", "yt"],
    grad: "from-[#ff3d6a] to-[#ff7a3d]",
  },
  {
    title: "Why your last 3 hooks flopped and the fix",
    status: "Processing",
    date: "32 min ago",
    dur: "1:08",
    plats: ["tt", "ig"],
    grad: "from-[#3daaff] to-[#7b66ff]",
  },
  {
    title: "The $0 setup every creator should steal",
    status: "Ready",
    date: "2 hr ago",
    dur: "0:58",
    plats: ["yt", "tt", "tw"],
    grad: "from-[#22c55e] to-[#3daaff]",
  },
];

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

const upcoming = [
  { plat: "tt", cap: "5 morning habits that changed my life", date: "Today", time: "09:00" },
  { plat: "ig", cap: "Why your last 3 hooks flopped", date: "Today", time: "15:30" },
  { plat: "yt", cap: "The $0 setup every creator should steal", date: "Tomorrow", time: "08:15" },
];

const chartBars = [42, 55, 38, 70, 64, 82, 74, 93, 88, 106, 98, 118, 110, 132, 126, 149, 136, 158];

function Platform({ id, size = "sm" }: { id: string; size?: "xs" | "sm" }) {
  const map: Record<string, [string, string]> = {
    tt: ["♪", "bg-zinc-950 text-white border-white/10"],
    ig: ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white border-white/10"],
    yt: ["▶", "bg-red-500 text-white border-red-300/20"],
    tw: ["𝕏", "bg-zinc-100 text-zinc-950 border-white/20"],
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
  const ready = status === "Ready";
  return (
    <Badge variant={ready ? "ready" : "warn"}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-300" : "bg-amber-300")} />
      {status}
    </Badge>
  );
}


function StatStrip() {
  const stats = [
    ["Views", "this week", "482K", "+18%"],
    ["Engagement", "rate", "7.2%", "+2%"],
    ["Followers", "gained", "+3.8K", "+13%"],
    ["Virality", "average", "68", "+8%"],
  ];
  return (
    <div className="grid overflow-hidden rounded-[14px] border border-white/[.06] bg-[#0e121b] sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(([label, sub, val, delta], index) => (
        <div key={label} className="border-white/[.06] p-6 sm:border-r sm:last:border-r-0">
          <div className="mb-2.5 flex gap-1 text-[10.5px] font-semibold uppercase tracking-[.1em] text-zinc-500">
            {label} <em className="font-normal normal-case tracking-normal opacity-60">{sub}</em>
          </div>
          <div className="mb-2.5 font-display text-3xl font-bold leading-none tracking-[-.03em]">{val}</div>
          <div className="flex items-center gap-2 text-[10.5px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 font-semibold text-emerald-300">
              <TrendingUp className="h-2.5 w-2.5" />
              {delta}
            </span>
            <span className="text-zinc-600">vs last week</span>
          </div>
          {index === 3 ? <span className="sr-only">end</span> : null}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-[13px] font-semibold text-zinc-300">{title}</h3>
      {action ? (
        <a className="inline-flex items-center gap-1 text-[11.5px] font-medium text-zinc-500 hover:text-zinc-300">
          {action}
          <ChevronRight className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function VideoList() {
  return (
    <Card className="p-5">
      <SectionTitle title="Recent videos" action="Open library" />
      <div>
        {videos.map((video, index) => (
          <div
            key={video.title}
            className={cn(
              "grid grid-cols-[52px_1fr_auto] items-center gap-3.5 px-2 py-2.5",
              index < videos.length - 1 && "border-b border-white/[.05]",
            )}
          >
            <div className={cn("relative grid h-[34px] w-[52px] place-items-center overflow-hidden rounded-[7px] bg-gradient-to-br", video.grad)}>
              <Play className="h-2.5 w-2.5 fill-white" />
              <span className="absolute bottom-0.5 right-1 font-mono text-[8px] font-semibold text-white/85">
                {video.dur}
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{video.title}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span>{video.date}</span>
                <span className="opacity-40">·</span>
                <span className="flex gap-1">
                  {video.plats.map((p) => (
                    <Platform key={p} id={p} size="xs" />
                  ))}
                </span>
              </div>
            </div>
            <StatusBadge status={video.status} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Workflows() {
  return (
    <Card className="p-5">
      <SectionTitle title="Automations" action="Manage" />
      <div>
        {workflows.map((workflow, index) => (
          <div
            key={workflow.name}
            className={cn(
              "grid grid-cols-[34px_1fr_auto] items-center gap-3 px-2 py-2.5",
              index < workflows.length - 1 && "border-b border-white/[.05]",
            )}
          >
            <div className={cn("grid h-[34px] w-[34px] place-items-center rounded-[9px] border", workflow.tone)}>
              <workflow.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{workflow.name}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">Last run {workflow.last}</div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={cn("min-w-5 text-[11px] font-semibold", workflow.on ? "text-emerald-300" : "text-zinc-600")}>
                {workflow.on ? "On" : "Off"}
              </span>
              <div className={cn("h-5 w-9 rounded-full border p-0.5 transition", workflow.on ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/25" : "border-white/10 bg-white/[.04]")}>
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
  return (
    <Card className="border-[#ff3d6a]/15 bg-[linear-gradient(135deg,rgba(255,61,106,.07),rgba(255,61,106,.02)_60%,transparent)] p-5">
      <div className="grid items-center gap-5 sm:grid-cols-[66px_1fr_auto]">
        <div className="relative grid h-[94px] w-[66px] place-items-center overflow-hidden rounded-[10px] border border-white/10 bg-gradient-to-br from-[#ff3d6a] via-[#ff7a3d] to-[#ffb347]">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-white/90">
            <Play className="h-3 w-3 fill-zinc-950 text-zinc-950" />
          </div>
          <div className="absolute bottom-1 left-1 flex items-center gap-1 text-[8.5px] font-semibold">
            <CircleDot className="h-2 w-2" />
            412K
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#ff3d6a]">Top performer</div>
          <h2 className="mb-3 font-display text-sm font-bold leading-snug">5 morning habits that changed my life</h2>
          <div className="mb-3 flex gap-5">
            {[
              ["412.8K", "views"],
              ["38.2K", "likes"],
              ["11.4%", "eng."],
            ].map(([value, label]) => (
              <div key={label}>
                <div className="font-display text-sm font-bold">{value}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[.07em] text-zinc-600">{label}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm">
              <Sparkles className="h-3 w-3" />
              Remix
            </Button>
            <Button size="sm" variant="ghost">
              Analytics
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="relative h-[76px] w-[76px]">
          <svg className="-rotate-90" height="76" width="76">
            <circle cx="38" cy="38" fill="none" r="34" stroke="rgba(255,255,255,.06)" strokeWidth="5.5" />
            <circle
              cx="38"
              cy="38"
              fill="none"
              r="34"
              stroke="#ff3d6a"
              strokeDasharray="213.6"
              strokeDashoffset="47"
              strokeLinecap="round"
              strokeWidth="5.5"
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center font-display text-lg font-bold">78</div>
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
              <span className="text-xs font-medium text-zinc-300">{label}</span>
              <span className="font-mono text-[11px] text-zinc-500">
                {used}
                <span className="opacity-60"> / {total}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]">
              <div className={cn("h-full rounded-full", color)} style={{ width }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function UpcomingPosts() {
  return (
    <Card className="p-5">
      <SectionTitle title="Upcoming posts" action="Calendar" />
      <div className="space-y-2">
        {upcoming.map((post) => (
          <div key={post.cap} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-[9px] border border-white/[.055] bg-white/[.025] p-2.5">
            <Platform id={post.plat} />
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium">{post.cap}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{post.date}</div>
            </div>
            <div className="font-mono text-[11.5px] font-semibold text-zinc-300">{post.time}</div>
          </div>
        ))}
      </div>
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
          <p className="mt-1 text-xs text-zinc-500">Views, engagement and follower lift across active channels.</p>
        </div>
        <Button variant="ghost" size="sm">
          Export
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex h-[230px] items-end gap-2 border-b border-white/[.06] pb-4">
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
            <div key={label} className="rounded-[10px] border border-white/[.06] bg-white/[.025] p-3">
              <div className="font-display text-xl font-bold tracking-tight">{value}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[.1em] text-zinc-600">{label}</div>
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
      <div className="grid lg:grid-cols-[1.05fr_.95fr]">
        <div className="p-4 sm:p-6">
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
          <div className="mt-6 flex flex-wrap gap-3">
            <Button>
              <Clapperboard className="h-4 w-4" />
              New video
            </Button>
            <Button variant="secondary">
              <Upload className="h-4 w-4" />
              Upload source
            </Button>
          </div>
        </div>
        <div className="relative min-h-[260px] border-t border-white/[.06] bg-[#111725] p-4 sm:p-6 lg:border-l lg:border-t-0">
          <div className="absolute right-8 top-8 h-24 w-24 rounded-full bg-[#3daaff]/15 blur-3xl" />
          <div className="relative mx-auto max-w-[280px] rounded-[22px] border border-white/10 bg-zinc-950 p-2 shadow-2xl">
            <div className="aspect-[9/16] overflow-hidden rounded-[16px] bg-gradient-to-br from-[#ff3d6a] via-[#ff7a3d] to-[#3daaff] p-4">
              <div className="flex justify-between text-[10px] font-semibold text-white/80">
                <span>00:47</span>
                <span>9:16</span>
              </div>
              <div className="mt-20 rounded-xl bg-black/25 p-3 backdrop-blur sm:mt-28">
                <div className="text-lg font-black leading-5">5 habits that changed my mornings</div>
                <div className="mt-2 h-1.5 w-24 rounded-full bg-white/70" />
                <div className="mt-1.5 h-1.5 w-16 rounded-full bg-white/50" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="h-12 rounded-lg bg-white/20" />
                <div className="h-12 rounded-lg bg-white/30" />
                <div className="h-12 rounded-lg bg-white/15" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function Dashboard() {
  return (
    <Shell active="dashboard">
      <StudioPanel />
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
            <SectionTitle title="AI agents" />
            <div className="space-y-3">
              {["Trend scout", "Hook critic", "Script writer", "Caption editor"].map((agent, index) => (
                <div key={agent} className="flex items-center justify-between rounded-[9px] border border-white/[.055] bg-white/[.025] p-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/[.05] text-zinc-300">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium">{agent}</div>
                      <div className="text-[11px] text-zinc-500">{index === 0 ? "Running" : "Ready"}</div>
                    </div>
                  </div>
                  <MoreHorizontal className="h-4 w-4 text-zinc-600" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

