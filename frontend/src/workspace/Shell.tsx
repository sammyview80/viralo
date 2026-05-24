import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { groups, nav } from "./data";
import type { PageKey } from "./types";
import { useAuth, logout } from "@/stores/auth";
import { navigate } from "@/lib/router";

type ActiveKey = PageKey | "dashboard";

/* ─── Inline SVG icons ─── */
type IconProps = { size?: number; className?: string };

function Icon({ d, size = 18, children, ...rest }: IconProps & { d?: string; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {d ? <path d={d} /> : children}
    </svg>
  );
}

const Icons = {
  Bolt:     (p: IconProps) => <Icon {...p} d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />,
  Video:    (p: IconProps) => <Icon {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></Icon>,
  Film:     (p: IconProps) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></Icon>,
  Rocket:   (p: IconProps) => <Icon {...p}><path d="M4.5 16.5a4.5 4.5 0 0 0 3 3l1.5-3-1.5-1.5z" /><path d="M14 7s3-4 7-4c0 4-4 7-4 7l-3 3-3-3z" /><path d="M14 13l-3-3-7 7 3 3z" /></Icon>,
  Brain:    (p: IconProps) => <Icon {...p}><path d="M9 3a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 3.5 9 2.5 2.5 0 0 0 5 11.4 2.5 2.5 0 0 0 4 13.5 2.5 2.5 0 0 0 6.5 16 2.5 2.5 0 0 0 9 18.5 2.5 2.5 0 0 0 12 21V3a3 3 0 0 0-3 0z" /><path d="M15 3a3 3 0 0 1 3 3v.5A2.5 2.5 0 0 1 20.5 9 2.5 2.5 0 0 1 19 11.4 2.5 2.5 0 0 1 20 13.5 2.5 2.5 0 0 1 17.5 16 2.5 2.5 0 0 1 15 18.5 2.5 2.5 0 0 1 12 21" /></Icon>,
  Branch:   (p: IconProps) => <Icon {...p}><circle cx="6" cy="3" r="2" /><circle cx="6" cy="21" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 5v14M18 8a6 6 0 0 1-6 6H6" /></Icon>,
  Calendar: (p: IconProps) => <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></Icon>,
  Chart:    (p: IconProps) => <Icon {...p}><path d="M3 21h18M5 17V9M10 17V5M15 17v-7M20 17v-5" /></Icon>,
  Flame:    (p: IconProps) => <Icon {...p} d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 1 3-3z" />,
  Gear:     (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>,
  Globe:    (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>,
  ChevronR: (p: IconProps) => <Icon {...p} d="M9 6l6 6-6 6" />,
  ChevronL: (p: IconProps) => <Icon {...p} d="M15 6l-6 6 6 6" />,
  Sparkle:  (p: IconProps) => <Icon {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></Icon>,
  Search:   (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Icon>,
  Bell:     (p: IconProps) => <Icon {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></Icon>,
  Help:     (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4" /><path d="M12 17h0" /></Icon>,
};

/* ─── Nav config ─── */
const NAV_GROUPS: Array<{
  label: typeof groups[number];
  items: Array<{ key: PageKey; label: string; href: string; icon: keyof typeof Icons; badge?: string }>;
}> = [
  {
    label: "Create",
    items: [
      { key: "studio",     label: "Studio",     href: "/studio",     icon: "Video",    badge: "AI" },
      { key: "clips",      label: "Clips",      href: "/clips",      icon: "Film" },
      { key: "upload",     label: "Uploader",   href: "/upload",     icon: "Rocket" },
      { key: "brainstorm", label: "Brainstorm", href: "/brainstorm", icon: "Brain",    badge: "3" },
      { key: "workflows",  label: "Workflows",  href: "/workflows",  icon: "Branch" },
      { key: "scheduler",  label: "Scheduler",  href: "/scheduler",  icon: "Calendar" },
    ],
  },
  {
    label: "Measure",
    items: [
      { key: "analytics", label: "Analytics", href: "/analytics", icon: "Chart" },
      { key: "trending",  label: "Trending",  href: "/trending",  icon: "Flame",  badge: "🔥" },
    ],
  },
  {
    label: "Account",
    items: [
      { key: "integrations", label: "Integrations", href: "/integrations", icon: "Globe" },
      { key: "settings",     label: "Settings",     href: "/settings",     icon: "Gear" },
    ],
  },
];

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  studio: "Video Studio", clips: "Clips", upload: "Uploader",
  brainstorm: "Brainstorm", workflows: "Workflow Builder", scheduler: "Scheduler",
  analytics: "Analytics", trending: "Trending", integrations: "Integrations",
  settings: "Settings", onboarding: "Onboarding",
};

/* ─── Sidebar ─── */
function Sidebar({ active, collapsed, onCollapse }: { active: ActiveKey; collapsed: boolean; onCollapse: () => void }) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-white/[.055] bg-[#0e1420] transition-[width] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] lg:flex",
        collapsed ? "w-[62px]" : "w-[216px]"
      )}
    >
      {/* Brand */}
      <div className="flex h-[62px] flex-none items-center gap-2.5 px-3.5">
        <div className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-gradient-to-br from-[#ff4d78] to-[#ff8040] shadow-[0_4px_14px_rgba(255,61,106,.18),inset_0_1px_0_rgba(255,255,255,.2)]">
          <Icons.Bolt size={15} className="text-white" />
        </div>
        <span
          className={cn(
            "font-display text-[16px] font-bold tracking-[-0.01em] transition-[opacity,width] duration-300",
            collapsed ? "w-0 overflow-hidden opacity-0 pointer-events-none" : "w-20 opacity-100"
          )}
        >
          viralo
        </span>
        {!collapsed && (
          <button
            onClick={onCollapse}
            className="ml-auto grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] border border-transparent text-zinc-500 transition-[background,border,color] hover:border-white/[.07] hover:bg-[#141926] hover:text-zinc-200"
            title="Collapse sidebar"
          >
            <Icons.ChevronL size={13} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto px-2 pb-2">
        {/* Dashboard home */}
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); navigate("/"); }}
          className={cn(
            "relative mb-0.5 flex items-center gap-2.5 overflow-hidden rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-[background,color]",
            collapsed ? "justify-center" : "",
            active === "dashboard"
              ? "bg-white/[.04] text-white before:absolute before:left-[-8px] before:top-2.5 before:bottom-2.5 before:w-[2.5px] before:rounded-r before:bg-[#ff3d6a]"
              : "text-zinc-300 hover:bg-[#141926] hover:text-white"
          )}
        >
          <span className={cn("flex-none transition-opacity", active === "dashboard" ? "opacity-100" : "opacity-75")}>
            <Icons.Bolt size={17} />
          </span>
          <span className={cn("transition-[opacity,width] duration-300", collapsed ? "w-0 overflow-hidden opacity-0 pointer-events-none" : "flex-1 opacity-100")}>
            Dashboard
          </span>
        </a>

        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {/* Section label */}
            <div
              className={cn(
                "px-2.5 pb-[5px] pt-4 text-[9.5px] font-bold uppercase tracking-[.14em] text-zinc-600 transition-[opacity,height,padding] duration-200 whitespace-nowrap overflow-hidden",
                collapsed ? "h-3.5 pt-2 pb-0 opacity-0" : ""
              )}
            >
              {group.label}
            </div>

            {group.items.map((item) => {
              const Ico = Icons[item.icon];
              const isActive = item.key === active;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  onClick={(e) => { e.preventDefault(); navigate(item.href); }}
                  className={cn(
                    "relative mb-0.5 flex items-center gap-2.5 overflow-hidden rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-[background,color]",
                    collapsed ? "justify-center px-2.5" : "",
                    isActive
                      ? "bg-white/[.04] text-white before:absolute before:left-[-8px] before:top-2.5 before:bottom-2.5 before:w-[2.5px] before:rounded-r before:bg-[#ff3d6a]"
                      : "text-zinc-300 hover:bg-[#141926] hover:text-white"
                  )}
                >
                  <span className={cn("flex-none transition-opacity", isActive ? "opacity-100" : "opacity-75 group-hover:opacity-100")}>
                    <Ico size={17} />
                  </span>
                  <span className={cn("flex-1 transition-[opacity,width] duration-300", collapsed ? "w-0 overflow-hidden opacity-0 pointer-events-none" : "opacity-100")}>
                    {item.label}
                  </span>
                  {item.badge && (
                    <span
                      className={cn(
                        "flex-none rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-[.02em] transition-[opacity,width] duration-300",
                        collapsed ? "w-0 overflow-hidden opacity-0 pointer-events-none" : "opacity-100",
                        isActive ? "bg-[#ff3d6a]/15 text-[#ff3d6a]" : "bg-white/[.06] text-zinc-400"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        ))}

        {/* Expand button when collapsed */}
        {collapsed && (
          <button
            onClick={onCollapse}
            className="mt-auto flex items-center justify-center rounded-[8px] px-2.5 py-2 text-zinc-500 transition hover:bg-[#141926] hover:text-zinc-200"
          >
            <Icons.ChevronR size={17} />
          </button>
        )}
      </nav>

      {/* Upgrade footer */}
      {!collapsed && (
        <div className="flex-none border-t border-white/[.055] p-2">
          <div className="overflow-hidden rounded-[12px] border border-[rgba(255,61,90,.25)] bg-gradient-to-br from-[rgba(255,61,90,.18)] to-[rgba(255,122,61,.08)] p-3.5">
            <h4 className="font-display text-[12.5px] font-semibold">Upgrade to Pro</h4>
            <p className="mt-0.5 text-[11px] leading-5 text-zinc-400">Unlimited videos, voice cloning &amp; agency tools.</p>
            <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_3px_14px_rgba(255,61,106,.2),inset_0_1px_0_rgba(255,255,255,.18)] transition hover:shadow-[0_5px_22px_rgba(255,61,106,.36),inset_0_1px_0_rgba(255,255,255,.18)]">
              <Icons.Sparkle size={12} />
              Get Pro
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ─── Shell ─── */
export function Shell({ active, children }: { active: ActiveKey; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { user } = useAuth();
  const title = PAGE_LABELS[active] ?? active;
  const sideW = collapsed ? 62 : 216;
  const initials = (user?.full_name ?? user?.email ?? "U").charAt(0).toUpperCase();

  return (
    <div className="relative min-h-screen">
      <Sidebar active={active} collapsed={collapsed} onCollapse={() => setCollapsed((c) => !c)} />

      {/* Topbar */}
      <header
        className="sticky top-0 z-10 flex h-14 items-center border-b border-white/[.055] bg-[#080b12]/75 px-4 backdrop-blur transition-[padding-left] duration-300 ease-[cubic-bezier(.4,.1,.2,1)]"
        style={{ paddingLeft: `calc(${sideW}px + 28px)`, paddingRight: 28 }}
      >
        <div className="flex items-center gap-1.5 text-[12px] text-zinc-500">
          <span className="cursor-pointer" onClick={() => {}}>Viralo</span>
          <Icons.ChevronR size={11} />
          <span className="font-medium text-zinc-300">{title}</span>
        </div>

        <div className="relative mx-5 flex-1 max-w-[480px]">
          <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
            <Icons.Search size={14} />
          </span>
          <input
            className="w-full rounded-[9px] border border-white/[.07] bg-white/[.04] px-9 py-2 text-[12.5px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_4px_rgba(255,61,106,.08)]"
            placeholder="Search videos, workflows…"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[5px] border border-white/[.07] bg-[#141926] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500">⌘K</kbd>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button className="relative grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-white/[.08] text-zinc-400 transition hover:border-white/[.13] hover:bg-[#141926] hover:text-zinc-200">
            <Icons.Bell size={15} />
            <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full bg-[#ff3d6a] shadow-[0_0_8px_rgba(255,61,106,.8),0_0_0_2px_#080b12]" />
          </button>
          <button className="grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-white/[.08] text-zinc-400 transition hover:border-white/[.13] hover:bg-[#141926] hover:text-zinc-200">
            <Icons.Help size={15} />
          </button>
          <div className="relative">
            <div
              onClick={() => setAvatarOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-2.5 rounded-full border border-white/[.08] bg-[#0e1420] py-1 pl-1 pr-2.5 transition hover:border-white/[.13] hover:bg-[#141926]"
            >
              <div className="grid h-7 w-7 flex-none place-items-center rounded-full bg-gradient-to-br from-[#ff4d78] to-[#ff8040] font-display text-[12px] font-bold text-white">{initials}</div>
              <div>
                <b className="block text-[12px] font-semibold leading-[1.2]">{user?.full_name ?? user?.email ?? "User"}</b>
                <span className="block text-[10.5px] text-zinc-500">Pro plan</span>
              </div>
            </div>
            {avatarOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-[11px] border border-white/[.10] bg-[#141926] shadow-[0_16px_40px_rgba(0,0,0,.5)]">
                <a href="/settings" onClick={(e) => { e.preventDefault(); setAvatarOpen(false); navigate("/settings"); }}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-zinc-300 transition hover:bg-white/[.05] hover:text-white">
                  ⚙ Settings
                </a>
                <div className="mx-3 border-t border-white/[.07]" />
                <button onClick={() => { setAvatarOpen(false); logout(); }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-red-400 transition hover:bg-red-400/[.08]">
                  ↩ Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main
        className="relative z-[1] px-4 py-7 transition-[margin-left] duration-300 ease-[cubic-bezier(.4,.1,.2,1)]"
        style={{ marginLeft: sideW }}
      >
        <div className="mx-auto max-w-[1240px] space-y-6">{children}</div>
      </main>
    </div>
  );
}
