import { useState, useEffect, useRef } from "react";
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
import { CommandPalette, openCommandPalette } from "./components/CommandPalette";
import { settingsApi } from "@/lib/api";
import { useTheme } from "@/hooks/useTheme";

type ActiveKey = PageKey | "dashboard";

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  studio: "Video Studio", "lyric-video": "Lyric Video", clips: "Clips", projects: "Projects", upload: "Uploader",
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
        "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-c-border bg-surface-0 transition-[width] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] lg:flex",
        collapsed ? "w-[62px]" : "w-[216px]"
      )}
    >
      {/* Brand */}
      <div className={cn("flex h-[62px] flex-none items-center px-3.5", collapsed ? "justify-center px-0" : "gap-2.5")}>
        <ViraloLogo size={30} wordmark collapsed={collapsed} textSize="text-[16px]" />
        {!collapsed && (
          <button
            onClick={onCollapse}
            className="ml-auto grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] border border-transparent text-c-text-muted transition-[background,border,color] hover:border-c-border hover:bg-surface-2 hover:text-c-text"
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
            "relative mb-0.5 flex items-center overflow-hidden rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-[background,color]",
            collapsed ? "justify-center gap-0" : "gap-2.5",
            active === "dashboard"
              ? "bg-surface-2 text-c-text before:absolute before:left-[-8px] before:top-2.5 before:bottom-2.5 before:w-[2.5px] before:rounded-r before:bg-brand"
              : "text-c-text-secondary hover:bg-surface-2 hover:text-c-text"
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
                "px-2.5 pb-[5px] pt-4 text-[9.5px] font-bold uppercase tracking-[.14em] text-c-text-muted transition-[opacity,height,padding] duration-200 whitespace-nowrap overflow-hidden",
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
                    "relative mb-0.5 flex items-center overflow-hidden rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-[background,color]",
                    collapsed ? "justify-center gap-0" : "gap-2.5",
                    isActive
                      ? "bg-surface-2 text-c-text before:absolute before:left-[-8px] before:top-2.5 before:bottom-2.5 before:w-[2.5px] before:rounded-r before:bg-brand"
                      : "text-c-text-secondary hover:bg-surface-2 hover:text-c-text"
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
                        isActive ? "bg-brand/15 text-brand" : "bg-surface-3 text-c-text-muted"
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
            className="mt-auto flex items-center justify-center rounded-[8px] px-2.5 py-2 text-c-text-muted transition hover:bg-surface-2 hover:text-c-text"
          >
            <Icons.ChevronR size={17} />
          </button>
        )}
      </nav>

      {/* Upgrade footer */}
      {!collapsed && !isPro && (
        <div className="flex-none border-t border-c-border p-2">
          <div className="overflow-hidden rounded-[12px] border border-[rgba(255,61,90,.25)] bg-gradient-to-br from-[rgba(255,61,90,.18)] to-[rgba(255,122,61,.08)] p-3.5">
            <h4 className="font-display text-[12.5px] font-semibold">Upgrade to Pro</h4>
            <p className="mt-0.5 text-[11px] leading-5 text-zinc-400">Unlimited videos, voice cloning &amp; agency tools.</p>
            <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-brand px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_3px_14px_rgba(255,61,106,.2),inset_0_1px_0_rgba(255,255,255,.18)] transition hover:shadow-[0_5px_22px_rgba(255,61,106,.36),inset_0_1px_0_rgba(255,255,255,.18)]">
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
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  // Bottom bar: Home + first 4 Create items + More = 6 slots
  const createItems = nav.filter((n) => n.group === "Create").slice(0, 4);
  const moreActive = !createItems.some((i) => i.key === active) && active !== "dashboard";
  const allGroups = groups.map((g) => ({ label: g, items: nav.filter((n) => n.group === g) }));

  // Escape-to-close + focus restore for More sheet
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    sheetRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      moreBtnRef.current?.focus();
    };
  }, [moreOpen]);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-c-border bg-surface-0 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-[560px] grid-cols-6 gap-1">
          <a
            key="dashboard"
            href="/"
            onClick={(e) => { e.preventDefault(); navigate("/"); }}
            className={cn(
              "flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-[10.5px] font-semibold transition",
              active === "dashboard"
                ? "bg-brand/12 text-[#ff7a9a] ring-1 ring-[#ff3d6a]/20"
                : "text-c-text-muted hover:bg-surface-2 hover:text-c-text"
            )}
          >
            <Icons.Bolt size={17} />
            <span className="truncate">Home</span>
          </a>
          {createItems.map((item) => {
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
                    ? "bg-brand/12 text-[#ff7a9a] ring-1 ring-[#ff3d6a]/20"
                    : "text-c-text-muted hover:bg-surface-2 hover:text-c-text"
                )}
              >
                <Ico size={17} />
                <span className="truncate">{item.label}</span>
              </a>
            );
          })}
          <button
            ref={moreBtnRef}
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-[10.5px] font-semibold transition",
              moreActive
                ? "bg-brand/12 text-[#ff7a9a] ring-1 ring-[#ff3d6a]/20"
                : "text-c-text-muted hover:bg-surface-2 hover:text-c-text"
            )}
          >
            <Icons.Branch size={17} />
            <span className="truncate">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="All pages">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setMoreOpen(false)} />
          {/* Sheet */}
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-[16px] border-t border-c-border bg-surface-0 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 outline-none"
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-surface-3" />
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-[13px] font-semibold text-c-text">All pages</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-full text-c-text-muted hover:bg-surface-2 hover:text-c-text"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {/* Dashboard link inside the sheet */}
            <div className="px-2 pb-1">
              <a
                href="/"
                onClick={(e) => { e.preventDefault(); setMoreOpen(false); navigate("/"); }}
                className={cn(
                  "flex items-center gap-2.5 rounded-[8px] px-2.5 py-2.5 text-[13px] font-medium transition",
                  active === "dashboard" ? "bg-surface-2 text-c-text" : "text-c-text-secondary hover:bg-surface-2 hover:text-c-text"
                )}
              >
                <Icons.Bolt size={17} />
                <span className="flex-1">Dashboard</span>
              </a>
            </div>
            {allGroups.map((group) => (
              <div key={group.label} className="px-2 pb-2">
                <div className="px-2.5 pb-1 pt-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-c-text-muted">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Ico = Icons[item.icon];
                  const isActive = item.key === active;
                  return (
                    <a
                      key={item.key}
                      href={item.href}
                      onClick={(e) => { e.preventDefault(); setMoreOpen(false); navigate(item.href); }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[8px] px-2.5 py-2.5 text-[13px] font-medium transition",
                        isActive ? "bg-surface-2 text-c-text" : "text-c-text-secondary hover:bg-surface-2 hover:text-c-text"
                      )}
                    >
                      <Ico size={17} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold text-c-text-muted">{item.badge}</span>
                      )}
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Shell ─── */
export function Shell({ active, children, fullBleed = false }: { active: ActiveKey; children: React.ReactNode; fullBleed?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { user } = useAuth();
  const { isAtLeast } = usePlan();
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    fetchUnreadCount();
    const cleanup = connectSSE();
    return cleanup;
  }, []);

  useEffect(() => {
    settingsApi.getBrandKit().then(kit => {
      const root = document.documentElement;
      if (kit.primary_color) root.style.setProperty("--brand", kit.primary_color);
      if (kit.font) root.style.setProperty("--brand-font", kit.font);
    }).catch(() => {});
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
    <div className="relative min-h-dvh" style={shellStyle}>
      <CommandPalette />
      <ToastContainer />
      <Sidebar active={active} collapsed={collapsed} onCollapse={() => setCollapsed((c) => !c)} isPro={isPro} />
      <MobileNav active={active} />

      {/* Topbar */}
      <header
        className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-c-border bg-surface-0 px-3 transition-[padding-left] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] sm:px-4 lg:pl-[calc(var(--sidebar-width)+28px)] lg:pr-7"
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-c-text-muted lg:gap-1.5">
          <div className="lg:hidden">
            <ViraloIcon size={28} />
          </div>
          <span className="cursor-pointer" onClick={() => {}}>Viralo</span>
          <Icons.ChevronR size={11} className="hidden sm:block" />
          <span className="font-medium text-c-text-secondary">{title}</span>
        </div>

        <div className="relative mx-0 hidden max-w-[480px] flex-1 sm:block lg:mx-5">
          <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-c-text-muted pointer-events-none">
            <Icons.Search size={14} />
          </span>
          <input
            aria-label="Search videos, workflows…"
            readOnly
            onClick={openCommandPalette}
            className="w-full cursor-pointer rounded-[9px] border border-c-border bg-surface-2 px-9 py-2 text-[12.5px] font-medium text-c-text placeholder-c-text-muted outline-none transition hover:border-c-border-hover"
            placeholder="Search videos, workflows…"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[5px] border border-c-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-c-text-muted">⌘K</kbd>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex h-7 w-[52px] flex-none items-center rounded-full border border-c-border bg-surface-2 px-[3px] transition-[background,border] hover:border-c-border-hover"
          >
            <span
              className={cn(
                "flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface-0 shadow-sm transition-[transform,background] duration-200",
                theme === "light" ? "translate-x-[22px]" : "translate-x-0"
              )}
            >
              {theme === "dark"
                ? <Icons.Moon size={11} className="text-c-text-secondary" />
                : <Icons.Sun size={11} className="text-brand" />}
            </span>
          </button>
          <NotificationBell />
          <div className="relative">
            <div
              onClick={() => setAvatarOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-2.5 rounded-full border border-c-border bg-surface-2 py-1 pl-1 pr-1 transition hover:border-c-border-hover hover:bg-surface-3 sm:pr-2.5"
            >
              <div className="grid h-7 w-7 flex-none place-items-center rounded-full bg-gradient-to-br from-[#ff4d78] to-[#ff8040] font-display text-[12px] font-bold text-white">{initials}</div>
              <div className="hidden sm:block">
                <b className="block text-[12px] font-semibold leading-[1.2] text-c-text">{user?.full_name ?? user?.email ?? "User"}</b>
                <span className="block text-[10.5px] capitalize text-c-text-muted">{user?.plan ?? "free"} plan</span>
              </div>
            </div>
            {avatarOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-[11px] border border-c-border bg-surface-2 shadow-[0_16px_40px_rgba(0,0,0,.2)]">
                <a href="/settings" onClick={(e) => { e.preventDefault(); setAvatarOpen(false); navigate("/settings"); }}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-c-text-secondary transition hover:bg-surface-3 hover:text-c-text">
                  ⚙ Settings
                </a>
                <div className="mx-3 border-t border-c-border" />
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
        className={cn(
          "relative z-[1] flex min-h-0 flex-col transition-[margin-left] duration-300 ease-[cubic-bezier(.4,.1,.2,1)] lg:ml-[var(--sidebar-width)]",
          fullBleed ? "overflow-y-auto" : "overflow-y-auto px-3 pt-5 sm:px-4 sm:pt-6 lg:pb-6"
        )}
        style={{
          // Use dvh for dynamic viewport (handles mobile browser chrome). 
          // Subtract header (3.5rem=56px) + bottom nav clearance.
          height: "calc(100dvh - 3.5rem - max(env(safe-area-inset-bottom, 16px), 64px))",
        }}
      >
        {fullBleed
          ? <div className="flex h-full min-h-0 w-full flex-1 flex-col">{children}</div>
          : <div className="mx-auto flex w-full flex-1 flex-col max-w-[1240px] space-y-5 sm:space-y-6">{children}</div>}
      </main>
    </div>
  );
}
