import { useEffect, useState } from "react";
import { LayoutDashboard, Users, DollarSign, CreditCard, Bell, LogOut } from "lucide-react";
import { navigate, usePathname } from "@/lib/router";
import { adminApi, adminToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ViraloLogo } from "@/components/ViraloLogo";

const TABS = [
  { key: "dashboard", label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { key: "users", label: "Users", href: "/admin/users", icon: Users },
  { key: "revenue", label: "Revenue", href: "/admin/revenue", icon: DollarSign },
  { key: "payments", label: "Payments", href: "/admin/payments", icon: CreditCard },
  { key: "notifications", label: "Notifications", href: "/admin/notifications", icon: Bell },
];

const UNREAD_POLL_MS = 30_000;

function isActive(pathname: string, href: string) {
  if (href === "/admin/users") return pathname === "/admin/users" || pathname.startsWith("/admin/users/");
  return pathname === href;
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      adminApi.unreadNotificationCount()
        .then((res) => { if (!cancelled) setUnreadCount(res.count); })
        .catch(() => {});
    }
    poll();
    const interval = setInterval(poll, UNREAD_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function handleLogout() {
    adminToken.clear();
    navigate("/admin");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[216px] flex-col border-r border-c-border bg-surface-0 lg:flex">
        <div className="flex h-[62px] flex-none items-center gap-2.5 px-3.5">
          <ViraloLogo size={30} wordmark textSize="text-[16px]" />
        </div>

        <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            const Icon = tab.icon;
            return (
              <a
                key={tab.key}
                href={tab.href}
                onClick={(e) => { e.preventDefault(); navigate(tab.href); }}
                className={cn(
                  "relative flex items-center gap-2.5 overflow-hidden rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-[background,color]",
                  active
                    ? "bg-surface-2 text-c-text before:absolute before:left-[-8px] before:top-2.5 before:bottom-2.5 before:w-[2.5px] before:rounded-r before:bg-brand"
                    : "text-c-text-secondary hover:bg-surface-2 hover:text-c-text"
                )}
              >
                <span className="relative">
                  <Icon size={16} className={active ? "opacity-100" : "opacity-75"} />
                  {tab.key === "notifications" && unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[#ff3d6a] px-[3px] text-[9px] font-bold leading-none text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
                {tab.label}
              </a>
            );
          })}
        </nav>

        <div className="border-t border-c-border p-2">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] font-medium text-c-text-secondary transition-[background,color] hover:bg-surface-2 hover:text-c-text"
          >
            <LogOut size={16} className="opacity-75" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-h-screen flex-1 px-6 py-8 sm:px-10 lg:pl-[240px]">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
