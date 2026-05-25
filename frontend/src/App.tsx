import { useEffect } from "react";
import { Dashboard } from "@/components/dashboard";
import { routeToPage, WorkspacePage } from "@/components/workspace-pages";
import { LoginPage } from "@/app/auth/LoginPage";
import { RegisterPage } from "@/app/auth/RegisterPage";
import { OnboardingPage } from "@/workspace/pages/OnboardingPage";
import { OAuthCallbackPage } from "@/workspace/pages/OAuthCallbackPage";
import { useAuth, hydrate } from "@/stores/auth";
import { usePathname } from "@/lib/router";

const AUTH_ROUTES = ["/login", "/register"];

export default function App() {
  const { user, ready } = useAuth();
  const path = usePathname();

  useEffect(() => { hydrate(); }, []);

  /* ── Splash while restoring session ── */
  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#080b12]">
        <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-gradient-to-br from-[#ff4d78] to-[#ff8040] shadow-[0_6px_24px_rgba(255,61,106,.35)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </div>
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
    return <OnboardingPage />;
  }

  /* ── Project detail: /projects/:id ── */
  if (/^\/projects\/[^/]+$/.test(path)) return <WorkspacePage page="upload" />;

  /* ── Workspace pages ── */
  const page = routeToPage(path);
  if (page) return <WorkspacePage page={page} />;

  /* ── Dashboard ── */
  return <Dashboard />;
}
