// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ClipApiResponse } from "@/lib/api";
import { ClipDetailModal } from "./ClipCard";

vi.mock("@/lib/utils", () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" "),
  safeFilename: (name: string | null | undefined, ext: string) => `${name ?? "clip"}.${ext}`,
  downloadBlob: vi.fn(),
  downloadUrl: vi.fn(),
  stripSrtTimecodes: (s: string) => s,
}));

function makeClip(): ClipApiResponse {
  return {
    id: "clip-1",
    video_id: "video-1",
    title: "Test clip",
    start_ms: 0,
    end_ms: 30_000,
    duration_ms: 30_000,
    platform: "shorts",
    score: 8.2,
    status: "ready",
    storage_url: "https://example.com/clip.mp4",
    thumbnail_url: "https://example.com/thumb.jpg",
    caption_srt: null,
    clip_metadata: {
      ai_title: "Test clip",
      platforms: {
        shorts: { description: "Short description", tags: ["viral", "fyp"] },
      },
    },
    upload_attempts: null,
    upload_error: null,
    upscaled_storage_url: null,
    created_at: "2026-01-01T00:00:00Z",
    scheduled_posts: [],
  };
}

describe("ClipDetailModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("exposes dialog semantics and labelled title", async () => {
    await act(async () => {
      root.render(<ClipDetailModal clip={makeClip()} onClose={() => {}} />);
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("clip-detail-title");

    const title = container.querySelector("#clip-detail-title");
    expect(title?.textContent).toBe("Test clip");
  });

  it("uses stacked mobile shell and md+ two-column grid without inline grid columns", async () => {
    await act(async () => {
      root.render(<ClipDetailModal clip={makeClip()} onClose={() => {}} />);
    });

    const shell = container.querySelector('[data-testid="clip-detail-modal"]');
    expect(shell).toBeTruthy();
    expect(shell?.className).toContain("flex-col");
    expect(shell?.className).toContain("md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]");
    expect(shell?.getAttribute("style") ?? "").not.toContain("gridTemplateColumns");
  });

  it("renders focus-safe tabs with tab/tabpanel wiring", async () => {
    await act(async () => {
      root.render(<ClipDetailModal clip={makeClip()} onClose={() => {}} />);
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute("aria-label")).toBe("Clip details");

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.id)).toEqual([
      "clip-detail-tab-info",
      "clip-detail-tab-copy",
      "clip-detail-tab-assets",
    ]);

    const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    expect(selected?.id).toBe("clip-detail-tab-info");
    expect(selected?.getAttribute("tabindex")).toBe("0");
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "-1")).toHaveLength(2);

    const infoPanel = container.querySelector("#clip-detail-panel-info");
    expect(infoPanel?.getAttribute("role")).toBe("tabpanel");
    expect(infoPanel?.getAttribute("aria-labelledby")).toBe("clip-detail-tab-info");
    expect(container.querySelector("#clip-detail-panel-copy")).toBeNull();

    const copyTab = tabs.find((t) => t.id === "clip-detail-tab-copy");
    await act(async () => {
      copyTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(copyTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#clip-detail-panel-copy")?.getAttribute("role")).toBe("tabpanel");
    expect(container.querySelector("#clip-detail-panel-info")).toBeNull();
  });
});
