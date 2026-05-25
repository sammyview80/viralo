import type { PageKey } from "./types";

export const nav: Array<{
  key: PageKey;
  label: string;
  href: string;
  mark: string;
  group: "Create" | "Measure" | "Account";
}> = [
  { key: "studio", label: "Studio", href: "/studio", mark: "AI", group: "Create" },
  { key: "clips", label: "Clips", href: "/clips", mark: "9:16", group: "Create" },
  { key: "projects", label: "Projects", href: "/projects", mark: "PRJ", group: "Create" },
  { key: "brainstorm", label: "Brainstorm", href: "/brainstorm", mark: "3", group: "Create" },
  { key: "workflows", label: "Workflows", href: "/workflows", mark: "WF", group: "Create" },
  { key: "scheduler", label: "Scheduler", href: "/scheduler", mark: "CAL", group: "Create" },
  { key: "analytics", label: "Analytics", href: "/analytics", mark: "KPI", group: "Measure" },
  { key: "trending", label: "Trending", href: "/trending", mark: "HOT", group: "Measure" },
  { key: "integrations", label: "Integrations", href: "/integrations", mark: "API", group: "Account" },
  { key: "onboarding", label: "Onboarding", href: "/onboarding", mark: "GO", group: "Account" },
  { key: "settings", label: "Settings", href: "/settings", mark: "SET", group: "Account" },
];

export const groups = ["Create", "Measure", "Account"] as const;

export const platforms = [
  ["tt", "TikTok", "♪", "bg-zinc-950"],
  ["ig", "Reels", "◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400"],
  ["yt", "Shorts", "▶", "bg-red-500"],
  ["tw", "X", "X", "bg-zinc-100 text-zinc-950"],
] as const;

export const clips = [
  ["5 morning habits that changed my life", "ready", "0:47", "92", "412K", "from-[#ff3d6a] to-[#ff7a3d]", ["tt", "ig", "yt"]],
  ["Why your last 3 hooks flopped", "processing", "1:08", "84", "128K", "from-[#3daaff] to-[#7b66ff]", ["tt", "ig"]],
  ["The $0 setup every creator should steal", "ready", "0:58", "78", "96K", "from-[#22c55e] to-[#3daaff]", ["yt", "tw"]],
  ["Stop making this hook mistake", "draft", "0:39", "71", "42K", "from-[#a855f7] to-[#ff3d6a]", ["tt"]],
] as const;
