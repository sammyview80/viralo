import { lazy, Suspense } from "react";
import { nav } from "@/workspace/data";
import type { PageKey } from "@/workspace/types";
import { PlanGate } from "@/components/PlanGate";

const AnalyticsPage    = lazy(() => import("@/workspace/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const BrainstormPage   = lazy(() => import("@/workspace/pages/BrainstormPage").then((m) => ({ default: m.BrainstormPage })));
const ClipsPage        = lazy(() => import("@/workspace/pages/ClipsPage").then((m) => ({ default: m.ClipsPage })));
const ChannelsPage     = lazy(() => import("@/workspace/pages/ChannelsPage"));
const IntegrationsPage = lazy(() => import("@/workspace/pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const OnboardingPage   = lazy(() => import("@/workspace/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const ProjectsPage     = lazy(() => import("@/workspace/pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })));
const SchedulerPage    = lazy(() => import("@/workspace/pages/SchedulerPage").then((m) => ({ default: m.SchedulerPage })));
const SettingsPage     = lazy(() => import("@/workspace/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const StudioPage       = lazy(() => import("@/workspace/pages/StudioPage").then((m) => ({ default: m.StudioPage })));
const TrendingPage     = lazy(() => import("@/workspace/pages/TrendingPage").then((m) => ({ default: m.TrendingPage })));
const UploadPage       = lazy(() => import("@/workspace/pages/UploadPage").then((m) => ({ default: m.UploadPage })));
import { Shell } from "@/workspace/Shell";

const WorkflowsPage    = lazy(() => import("@/workspace/pages/WorkflowsPage").then((m) => ({ default: m.WorkflowsPage })));
const BillingPage           = lazy(() => import("@/workspace/pages/BillingPage").then((m) => ({ default: m.BillingPage })));
const NotificationsPage     = lazy(() => import("@/workspace/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const RankingPage           = lazy(() => import("@/workspace/pages/RankingPage").then((m) => ({ default: m.RankingPage })));
export const pages: Record<PageKey, React.ReactNode> = {
  studio:       <StudioPage />,
  clips:        <ClipsPage />,
  projects:     <ProjectsPage />,
  upload:       <UploadPage />,
  brainstorm:   <PlanGate feature="brainstorm"   minPlan="starter"><BrainstormPage /></PlanGate>,
  workflows:    <PlanGate feature="workflows"    minPlan="creator"><WorkflowsPage /></PlanGate>,
  scheduler:    <SchedulerPage />,
  integrations: <PlanGate feature="integrations" minPlan="pro"><IntegrationsPage /></PlanGate>,
  channels:     <PlanGate feature="channels"     minPlan="creator"><ChannelsPage /></PlanGate>,
  onboarding:   <OnboardingPage />,
  analytics:    <AnalyticsPage />,
  trending:     <TrendingPage />,
  settings:     <SettingsPage />,
  billing:      <BillingPage />,
  ranking:      <RankingPage />,
  notifications: <NotificationsPage />,
};

const PageSkeleton = () => (
  <div className="mx-auto max-w-[1240px] space-y-6 animate-pulse px-4 sm:px-0">
    <div className="flex items-center justify-between">
      <div className="h-8 w-48 bg-white/5 rounded-lg" />
      <div className="h-9 w-32 bg-white/5 rounded-lg" />
    </div>
    <div className="h-32 w-full bg-white/5 rounded-2xl" />
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="h-64 bg-white/5 rounded-2xl" />
      <div className="h-64 bg-white/5 rounded-2xl" />
    </div>
  </div>
);

export function WorkspacePage({ page }: { page: PageKey }) {
  if (page === "onboarding") return <Suspense fallback={null}><OnboardingPage /></Suspense>;

  return (
    <Shell active={page}>
      <Suspense fallback={<PageSkeleton />}>
        {pages[page]}
      </Suspense>
    </Shell>
  );
}

export function routeToPage(pathname: string): PageKey | null {
  return nav.find((p) => p.href === pathname)?.key ?? null;
}
