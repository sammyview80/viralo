import { useEffect } from "react";
import { Dashboard } from "@/components/dashboard";
import { routeToPage, WorkspacePage } from "@/components/workspace-pages";
import { LoginPage } from "@/app/auth/LoginPage";
import { RegisterPage } from "@/app/auth/RegisterPage";
import { lazy, Suspense } from "react";
import { OAuthCallbackPage } from "@/workspace/pages/OAuthCallbackPage";
const OnboardingPage = lazy(() => import("@/workspace/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
import { useAuth, hydrate } from "@/stores/auth";
import { usePathname } from "@/lib/router";
import { ViraloIcon } from "@/components/ViraloLogo";

const AUTH_ROUTES = ["/login", "/register"];

export default function App() {
  const { user, ready } = useAuth();
  const path = usePathname();

  useEffect(() => { hydrate(); }, []);

  /* ── Splash while restoring session ── */
  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#080b12]">
        <ViraloIcon size={40} />
        <div className="h-5 w-5 rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
      </div>
    );
  }

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

  /* ── Onboarding gate: step 0 means fresh user ── */
  if (user.onboarding_step === 0) {
    return <Suspense fallback={null}><OnboardingPage /></Suspense>;
  }

  /* ── Billing success legacy redirect (/billing/success?session_id=...) ── */
  if (path === "/billing/success") {
    const sp = new URLSearchParams(window.location.search);
    const sid = sp.get("session_id") ?? "";
    window.location.replace(`/billing?success=1&session_id=${sid}`);
    return null;
  }

  /* ── Billing page ── */
  if (path === "/billing" || path.startsWith("/billing")) return <WorkspacePage page="billing" />;

  /* ── Upload page (not in sidebar) and project detail ── */
  if (path === "/upload" || /^\/projects\/[^/]+$/.test(path)) return <WorkspacePage page="upload" />;

  /* ── Workspace pages ── */
  const page = routeToPage(path);
  if (page) return <WorkspacePage page={page} />;

  /* ── Dashboard ── */
  return <Dashboard />;
}
