// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { VideoResponse } from "@/lib/api";

const { progressStream, listAccounts } = vi.hoisted(() => ({
  progressStream: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("@/lib/router", () => ({
  navigate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  videoApi: {
    progressStream,
    get: vi.fn(),
    retry: vi.fn(),
  },
  platformApi: { listAccounts },
  token: { get: vi.fn(() => "test-token") },
  API_BASES: { video: "http://test" },
}));

import { ProcessingView } from "./ProcessingView";

const processingVideo: VideoResponse = {
  id: "video-1",
  title: "Why the Universe is Expanding Faster Than Expected",
  source_type: "youtube_url",
  status: "processing",
  pipeline_step: "download",
  pipeline_pct: 5,
  storage_url: null,
  thumbnail_url: null,
  duration_sec: 600,
  celery_task_id: "task-abc123",
  clip_config: null,
  error_message: null,
  metadata: null,
  created_at: "2026-08-06T04:00:00.000Z",
};

describe("ProcessingView mobile layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    listAccounts.mockResolvedValue([]);
    progressStream.mockResolvedValue({
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    sessionStorage.clear();
  });

  it("keeps processing actions inside viewport-width containers on mobile", async () => {
    await act(async () => {
      root.render(
        <ProcessingView
          video={processingVideo}
          onDone={() => {}}
          onCancel={() => {}}
          onNewUpload={() => {}}
        />,
      );
    });

    const view = container.querySelector('[data-testid="processing-view"]');
    const actions = container.querySelector('[data-testid="processing-actions"]');
    const strip = container.querySelector('[data-testid="processing-video-strip"]');

    expect(view?.className).toContain("overflow-x-hidden");
    expect(view?.className).toContain("min-w-0");
    expect(view?.className).toContain("max-w-full");

    expect(actions?.className).toContain("grid");
    expect(actions?.className).toContain("grid-cols-2");
    expect(actions?.className).toContain("sm:flex");

    expect(strip?.className).toContain("min-w-0");
    expect(strip?.className).toContain("overflow-hidden");

    const buttons = Array.from(actions?.querySelectorAll("button") ?? []);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Projects", "Cancel", "New upload"]);
    expect(buttons.every((b) => b.className.includes("w-full"))).toBe(true);
    expect(buttons[2]?.className).toContain("col-span-2");
  });
});
