import { lazy, Suspense } from "react";
import { nav } from "@/workspace/data";
import type { PageKey } from "@/workspace/types";
import { PlanGate } from "@/components/PlanGate";
import { ViraloIcon } from "@/components/ViraloLogo";

const AnalyticsPage    = lazy(() => import("@/workspace/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const BrainstormPage   = lazy(() => import("@/workspace/pages/BrainstormPage").then((m) => ({ default: m.BrainstormPage })));
const ClipsPage        = lazy(() => import("@/workspace/pages/ClipsPage").then((m) => ({ default: m.ClipsPage })));
const ChannelsPage     = lazy(() => import("@/workspace/pages/ChannelsPage"));
const IntegrationsPage = lazy(() => import("@/workspace/pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const OnboardingPage   = lazy(() => import("@/workspace/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const ProjectsPage     = lazy(() => import("@/workspace/pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })));
const CalendarPage     = lazy(() => import("@/workspace/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const SettingsPage     = lazy(() => import("@/workspace/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const McpPage          = lazy(() => import("@/workspace/pages/McpPage").then((m) => ({ default: m.McpPage })));
const StudioPage       = lazy(() => import("@/workspace/pages/StudioPage").then((m) => ({ default: m.StudioPage })));
const LyricVideoPlanner = lazy(() => import("@/workspace/pages/studio/LyricVideoPlanner").then((m) => ({ default: m.LyricVideoPlanner })));
const SeriesPage       = lazy(() => import("@/workspace/pages/SeriesPage").then((m) => ({ default: m.SeriesPage })));
const SeriesCreatePage = lazy(() => import("@/workspace/pages/SeriesCreatePage").then((m) => ({ default: m.SeriesCreatePage })));
const TrendingPage     = lazy(() => import("@/workspace/pages/TrendingPage").then((m) => ({ default: m.TrendingPage })));
const UploadPage       = lazy(() => import("@/workspace/pages/UploadPage").then((m) => ({ default: m.UploadPage })));
import { Shell } from "@/workspace/Shell";

const WorkflowsPage    = lazy(() => import("@/workspace/pages/WorkflowsPage").then((m) => ({ default: m.WorkflowsPage })));
const BillingPage      = lazy(() => import("@/workspace/pages/BillingPage").then((m) => ({ default: m.BillingPage })));
const NotificationsPage = lazy(() => import("@/workspace/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const RankingPage      = lazy(() => import("@/workspace/pages/RankingPage").then((m) => ({ default: m.RankingPage })));

const pages: Record<PageKey, React.ReactNode> = {
  studio:        <StudioPage />,
  "lyric-video": <LyricVideoPlanner />,
  series:        <SeriesPage />,
  "series-create": <SeriesCreatePage />,
  clips:         <ClipsPage />,
  projects:      <ProjectsPage />,
  upload:        <UploadPage />,
  brainstorm:    <PlanGate feature="brainstorm"   minPlan="starter"><BrainstormPage /></PlanGate>,
  workflows:     <PlanGate feature="workflows"    minPlan="creator"><WorkflowsPage /></PlanGate>,
  calendar:      <CalendarPage />,
  integrations:  <PlanGate feature="integrations" minPlan="pro"><IntegrationsPage /></PlanGate>,
  channels:      <PlanGate feature="channels"     minPlan="creator"><ChannelsPage /></PlanGate>,
  onboarding:    <OnboardingPage />,
  analytics:     <AnalyticsPage />,
  trending:      <TrendingPage />,
  settings:      <SettingsPage />,
  mcp:           <McpPage />,
  billing:       <BillingPage />,
  ranking:       <RankingPage />,
  notifications: <NotificationsPage />,
};

const PageSkeleton = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-5 min-h-[60vh]">
    <ViraloIcon size={36} />
    <div className="h-5 w-5 rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
  </div>
);

export function WorkspacePage({ page }: { page: PageKey }) {
  if (page === "onboarding") return <Suspense fallback={null}><OnboardingPage /></Suspense>;

  return (
    <Shell active={page} fullBleed={page === "studio" || page === "projects" || page === "upload" || page === "clips"}>
      <Suspense fallback={<PageSkeleton />}>
        {pages[page]}
      </Suspense>
    </Shell>
  );
}

export function routeToPage(pathname: string): PageKey | null {
  return nav.find((p) => p.href === pathname)?.key ?? null;
}
