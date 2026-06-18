import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { nav, groups } from "./data";
import type { PageKey } from "./types";
import { useAuth, logout } from "@/stores/auth";
import { usePlan } from "@/hooks/usePlan";
import { navigate } from "@/lib/router";
import { NotificationBell } from "./components/NotificationBell";
import { ToastContainer } from "./components/ToastContainer";
import { connectSSE, fetchUnreadCount } from "@/stores/notifications";
import { Icons } from "@/components/icons";
import { ViraloLogo, ViraloIcon } from "@/components/ViraloLogo";

type ActiveKey = PageKey | "dashboard";

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  studio: "Video Studio", clips: "Clips", projects: "Projects", upload: "Uploader",
  brainstorm: "Brainstorm", workflows: "Workflow Builder", scheduler: "Scheduler",
  analytics: "Analytics", trending: "Trending", integrations: "Integrations",
  settings: "Settings", onboarding: "Onboarding", ranking: "Video Ranking",
};

/* ─── Sidebar ─── */
function Sidebar({ active, collapsed, onCollapse, isPro }: { active: ActiveKey; collapsed: boolean; onCollapse: () => void; isPro: boolean }) {
  const navGroups = groups.map((g) => ({ label: g, items: nav.filter((n) => n.group === g) }));

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-white/[.055] bg-[#0e1420] transition-[width] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] lg:flex",
        collapsed ? "w-[62px]" : "w-[216px]"
      )}
    >
      {/* Brand */}
      <div className="flex h-[62px] flex-none items-center gap-2.5 px-3.5">
        <ViraloLogo size={30} wordmark collapsed={collapsed} textSize="text-[16px]" />
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
            <ViraloIcon size={17} />
          </span>
          <span className={cn("transition-[opacity,width] duration-300", collapsed ? "w-0 overflow-hidden opacity-0 pointer-events-none" : "flex-1 opacity-100")}>
            Dashboard
          </span>
        </a>

        {navGroups.map((group) => (
          <div key={group.label}>
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
      {!collapsed && !isPro && (
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

function MobileNav({ active }: { active: ActiveKey }) {
  const items: Array<{ key: ActiveKey; label: string; href: string; icon: keyof typeof Icons }> = [
    { key: "dashboard", label: "Home", href: "/", icon: "Bolt" },
    { key: "studio", label: "Studio", href: "/studio", icon: "Video" },
    { key: "clips", label: "Clips", href: "/clips", icon: "Film" },
    { key: "analytics", label: "Analytics", href: "/analytics", icon: "Chart" },
    { key: "settings", label: "Settings", href: "/settings", icon: "Gear" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[.07] bg-[#080b12]/92 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-[520px] grid-cols-5 gap-1">
        {items.map((item) => {
          const Ico = Icons[item.icon];
          const isActive = item.key === active;
          return (
            <a
              key={item.key}
              href={item.href}
              onClick={(e) => { e.preventDefault(); navigate(item.href); }}
              className={cn(
                "flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-[10.5px] font-semibold transition",
                isActive
                  ? "bg-[#ff3d6a]/12 text-[#ff7a9a] ring-1 ring-[#ff3d6a]/20"
                  : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
              )}
            >
              <Ico size={17} />
              <span className="truncate">{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/* ─── Shell ─── */
export function Shell({ active, children }: { active: ActiveKey; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { user } = useAuth();
  const { isAtLeast } = usePlan();

  useEffect(() => {
    fetchUnreadCount();
    const cleanup = connectSSE();
    return cleanup;
  }, []);

  // Update document title
  useEffect(() => {
    document.title = active === "dashboard" ? "Viralo" : `${PAGE_LABELS[active] ?? active} | Viralo`;
  }, [active]);

  const title = PAGE_LABELS[active] ?? active;
  const sideW = collapsed ? 62 : 216;
  const shellStyle = { "--sidebar-width": `${sideW}px` } as CSSProperties;
  const initials = (user?.full_name ?? user?.email ?? "U").charAt(0).toUpperCase();
  const isPro = isAtLeast("pro");

  return (
    <div className="relative min-h-screen" style={shellStyle}>
      <ToastContainer />
      <Sidebar active={active} collapsed={collapsed} onCollapse={() => setCollapsed((c) => !c)} isPro={isPro} />
      <MobileNav active={active} />

      {/* Topbar */}
      <header
        className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-white/[.055] bg-[#080b12]/82 px-3 backdrop-blur-xl transition-[padding-left] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] sm:px-4 lg:pl-[calc(var(--sidebar-width)+28px)] lg:pr-7"
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-zinc-500 lg:gap-1.5">
          <div className="lg:hidden">
            <ViraloIcon size={28} />
          </div>
          <span className="cursor-pointer" onClick={() => {}}>Viralo</span>
          <Icons.ChevronR size={11} className="hidden sm:block" />
          <span className="font-medium text-zinc-300">{title}</span>
        </div>

        <div className="relative mx-0 hidden max-w-[480px] flex-1 sm:block lg:mx-5">
          <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
            <Icons.Search size={14} />
          </span>
          <input
            aria-label="Search videos, workflows…"
            className="w-full rounded-[9px] border border-white/[.07] bg-white/[.04] px-9 py-2 text-[12.5px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_4px_rgba(255,61,106,.08)]"
            placeholder="Search videos, workflows…"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[5px] border border-white/[.07] bg-[#141926] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500">⌘K</kbd>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <NotificationBell />
          <button
            aria-label="Help"
            className="grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-white/[.08] text-zinc-400 transition hover:border-white/[.13] hover:bg-[#141926] hover:text-zinc-200"
          >
            <Icons.Help size={15} />
          </button>
          <div className="relative">
            <div
              onClick={() => setAvatarOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-2.5 rounded-full border border-white/[.08] bg-[#0e1420] py-1 pl-1 pr-1 transition hover:border-white/[.13] hover:bg-[#141926] sm:pr-2.5"
            >
              <div className="grid h-7 w-7 flex-none place-items-center rounded-full bg-gradient-to-br from-[#ff4d78] to-[#ff8040] font-display text-[12px] font-bold text-white">{initials}</div>
              <div className="hidden sm:block">
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
        className="relative z-[1] px-3 pb-24 pt-5 transition-[margin-left] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] sm:px-4 sm:pt-7 lg:ml-[var(--sidebar-width)] lg:pb-7"
      >
        <div className="mx-auto w-full max-w-[1240px] space-y-5 sm:space-y-6">{children}</div>
      </main>
    </div>
  );
}
