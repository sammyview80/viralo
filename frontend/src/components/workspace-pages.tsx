import { nav } from "@/workspace/data";
import type { PageKey } from "@/workspace/types";
import { AnalyticsPage } from "@/workspace/pages/AnalyticsPage";
import { BrainstormPage } from "@/workspace/pages/BrainstormPage";
import { ClipsPage } from "@/workspace/pages/ClipsPage";
import { IntegrationsPage } from "@/workspace/pages/IntegrationsPage";
import { OnboardingPage } from "@/workspace/pages/OnboardingPage";
import { ProjectsPage } from "@/workspace/pages/ProjectsPage";
import { SchedulerPage } from "@/workspace/pages/SchedulerPage";
import { SettingsPage } from "@/workspace/pages/SettingsPage";
import { StudioPage } from "@/workspace/pages/StudioPage";
import { TrendingPage } from "@/workspace/pages/TrendingPage";
import { UploadPage } from "@/workspace/pages/UploadPage";
import { WorkflowsPage } from "@/workspace/pages/WorkflowsPage";

const pages: Record<PageKey, React.ReactNode> = {
  studio: <StudioPage />,
  clips: <ClipsPage />,
  projects: <ProjectsPage />,
  upload: <UploadPage />,
  brainstorm: <BrainstormPage />,
  workflows: <WorkflowsPage />,
  scheduler: <SchedulerPage />,
  integrations: <IntegrationsPage />,
  onboarding: <OnboardingPage />,
  analytics: <AnalyticsPage />,
  trending: <TrendingPage />,
  settings: <SettingsPage />,
};

export function WorkspacePage({ page }: { page: PageKey }) {
  return pages[page];
}

export function routeToPage(pathname: string): PageKey | null {
  return nav.find((p) => p.href === pathname)?.key ?? null;
}
