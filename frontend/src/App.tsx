import { useEffect } from "react";
import { DashboardContent } from "@/components/dashboard";
import { routeToPage, WorkspacePage } from "@/components/workspace-pages";
import { LoginPage } from "@/app/auth/LoginPage";
import { RegisterPage } from "@/app/auth/RegisterPage";
import { lazy, Suspense } from "react";
import { OAuthCallbackPage } from "@/workspace/pages/OAuthCallbackPage";
import { useAuth, hydrate } from "@/stores/auth";
import { usePathname } from "@/lib/router";
import { ViraloIcon } from "@/components/ViraloLogo";
import { Shell } from "@/workspace/Shell";
import { VeroagenListPage } from "@/veroagen/ProjectListPage";
import { VeroagenWorkspacePage } from "@/veroagen/WorkspacePage";

const AUTH_ROUTES = ["/login", "/register"];

const Splash = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background">
    <ViraloIcon size={40} />
    <div className="h-5 w-5 rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
  </div>
);

export default function App() {
  const { user, ready } = useAuth();
  const path = usePathname();

  useEffect(() => { hydrate(); }, []);

  /* ── Splash while restoring session ── */
  if (!ready) return <Splash />;

  /* ── Authenticated user on auth pages → away ── */
  if (user && AUTH_ROUTES.includes(path)) {
    const dest = user.onboarding_step === 0 ? "/onboarding" : "/";
    window.location.replace(dest);
    return null;
  }

  /* ── Auth pages ── */
  if (path === "/login")         return <LoginPage />;
  if (path === "/register")      return <RegisterPage />;
  if (path === "/oauth/callback") return <OAuthCallbackPage />;

  /* ── Unauthenticated guard ── */
  if (!user) {
    window.location.replace("/login");
    return null;
  }

  /* ── Onboarding gate ── */
  if (user.onboarding_step === 0) return <WorkspacePage page="onboarding" />;

  /* ── Legacy billing redirect ── */
  if (path === "/billing/success") {
    const sp = new URLSearchParams(window.location.search);
    const sid = sp.get("session_id") ?? "";
    window.location.replace(`/billing?success=1&session_id=${sid}`);
    return null;
  }

  /* ── Workspace pages ── */
  if (path === "/billing" || path.startsWith("/billing")) return <WorkspacePage key="billing" page="billing" />;
  if (path === "/notifications") return <WorkspacePage key="notifications" page="notifications" />;
  if (path === "/upload" || /^\/projects\/[^/]+$/.test(path)) return <WorkspacePage key={path} page="upload" />;
  if (path === "/series/create") return <WorkspacePage key="series-create" page="series-create" />;
  if (path === "/veroagen") return <VeroagenListPage />;
  const veroagenMatch = path.match(/^\/veroagen\/([^/]+)$/);
  if (veroagenMatch) return <VeroagenWorkspacePage projectId={veroagenMatch[1]} />;

  const page = routeToPage(path);
  if (page) return <WorkspacePage key={page} page={page} />;

  /* ── Dashboard (Home) ── */
  if (path === "/") {
    return (
      <Shell active="dashboard">
        <DashboardContent />
      </Shell>
    );
  }

  // Default fallback (e.g. if routeToPage failed but user authenticated)
  return (
    <Shell active="dashboard">
      <DashboardContent />
    </Shell>
  );
}
