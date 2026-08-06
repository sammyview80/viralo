// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ClipApiResponse, ScheduledPostSummary, VideoResponse } from "@/lib/api";

const { listPosts } = vi.hoisted(() => ({
  listPosts: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  videoApi: { retry: vi.fn() },
  platformApi: { listPosts },
}));

vi.mock("../../components/VirtualizedCollection", () => ({
  VirtualizedGrid: ({ items, renderItem }: { items: ClipApiResponse[]; renderItem: (item: ClipApiResponse, i: number) => React.ReactNode }) => (
    <div data-testid="clip-grid">{items.map((item, i) => <div key={item.id}>{renderItem(item, i)}</div>)}</div>
  ),
}));

vi.mock("./ClipCard", () => ({
  ClipCard: () => <div data-testid="clip-card" />,
  ClipDetailModal: () => null,
}));

vi.mock("./BulkPublishModal", () => ({
  BulkPublishModal: () => null,
}));

import { ResultsView } from "./ResultsView";

function makePost(overrides: Partial<ScheduledPostSummary> & Pick<ScheduledPostSummary, "id" | "clip_id" | "status">): ScheduledPostSummary {
  return {
    platform: "tiktok",
    scheduled_at: "2026-01-01T00:00:00Z",
    posted_at: overrides.status === "posted" ? "2026-01-02T00:00:00Z" : null,
    created_at: "2026-01-01T00:00:00Z",
    last_error: null,
    ...overrides,
  };
}

function makeClip(id: string, scheduled_posts: ScheduledPostSummary[]): ClipApiResponse {
  return {
    id,
    video_id: "video-1",
    title: `Clip ${id}`,
    start_ms: 0,
    end_ms: 30_000,
    duration_ms: 30_000,
    platform: "shorts",
    score: 8,
    status: "ready",
    storage_url: null,
    thumbnail_url: null,
    caption_srt: null,
    clip_metadata: null,
    upload_attempts: null,
    upload_error: null,
    upscaled_storage_url: null,
    created_at: "2026-01-01T00:00:00Z",
    scheduled_posts,
  };
}

const video: VideoResponse = {
  id: "video-1",
  title: "Test video",
  status: "done",
  source_type: "upload",
  pipeline_step: null,
  pipeline_pct: 100,
  storage_url: null,
  thumbnail_url: null,
  duration_sec: 120,
  celery_task_id: null,
  clip_config: null,
  error_message: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
};

describe("ResultsView posted counts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("derives project-scoped badge counts from clip scheduled_posts and does not fetch global posts", async () => {
    const clips = [
      makeClip("clip-posted", [makePost({ id: "post-1", clip_id: "clip-posted", status: "posted" })]),
      makeClip("clip-queued", [makePost({ id: "post-2", clip_id: "clip-queued", status: "scheduled" })]),
    ];

    await act(async () => {
      root.render(
        <ResultsView
          video={video}
          clips={clips}
          onBack={() => {}}
        />,
      );
    });

    const postedBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Posted"));
    const queuedBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Queued"));

    expect(postedBtn?.textContent).toContain("1");
    expect(queuedBtn?.textContent).toContain("1");
    expect(listPosts).not.toHaveBeenCalled();
  });
});
