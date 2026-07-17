import type { PageKey } from "./types";
import type { IconKey } from "@/components/icons";

export const nav: Array<{
  key: PageKey;
  label: string;
  href: string;
  icon: IconKey;
  badge?: string;
  group: "Create" | "Measure" | "Account";
}> = [
  { key: "studio",       label: "Studio",       href: "/studio",       icon: "Video",    badge: "AI",  group: "Create" },
  { key: "series",       label: "Series",        href: "/series",       icon: "Sparkle",  badge: "NEW", group: "Create" },
  { key: "clips",        label: "Clips",         href: "/clips",        icon: "Film",                   group: "Create" },
  { key: "projects",     label: "Projects",      href: "/projects",     icon: "Rocket",                 group: "Create" },
  { key: "brainstorm",   label: "Brainstorm",    href: "/brainstorm",   icon: "Brain",    badge: "3",   group: "Create" },
  { key: "workflows",    label: "Workflows",     href: "/workflows",    icon: "Branch",                 group: "Create" },
  { key: "ranking",      label: "Video Ranking", href: "/ranking",      icon: "Chart",                  group: "Create" },
  { key: "scheduler",    label: "Scheduler",     href: "/scheduler",    icon: "Calendar",               group: "Create" },
  { key: "trending",     label: "Trending",      href: "/trending",     icon: "Flame",    badge: "🔥",  group: "Measure" },
  { key: "integrations", label: "Integrations",  href: "/integrations", icon: "Globe",                  group: "Account" },
  { key: "channels",     label: "Channels",      href: "/channels",     icon: "Video",                  group: "Account" },
  { key: "onboarding",   label: "Onboarding",    href: "/onboarding",   icon: "Bolt",                   group: "Account" },
  { key: "billing",      label: "Billing",       href: "/billing",      icon: "CreditCard",             group: "Account" },
  { key: "settings",     label: "Settings",      href: "/settings",     icon: "Gear",                   group: "Account" },
];

export const groups = ["Create", "Measure", "Account"] as const;

export const platforms = [
  ["tt", "TikTok", "♪", "bg-zinc-950"],
  ["ig", "Reels", "◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400"],
  ["yt", "Shorts", "▶", "bg-red-500"],
  ["tw", "X", "X", "bg-zinc-100 text-zinc-950"],
] as const;
