// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ClipApiResponse } from "@/lib/api";

const { listAccounts, schedulePost } = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  schedulePost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  platformApi: { listAccounts, schedulePost },
}));

import { BulkPublishModal } from "./BulkPublishModal";

const clips: ClipApiResponse[] = [
  { id: "clip-1", title: "Clip One" } as ClipApiResponse,
];

describe("BulkPublishModal mobile layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    listAccounts.mockResolvedValue([
      { id: "acc-1", platform: "tiktok", platform_username: "test", is_active: true },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps panel and footer inside viewport-width containers on mobile", async () => {
    await act(async () => {
      root.render(<BulkPublishModal clips={clips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const panel = container.querySelector('[data-testid="bulk-publish-modal"]');
    const actions = container.querySelector('[data-testid="bulk-publish-actions"]');

    expect(panel?.className).toContain("min-w-0");
    expect(panel?.className).toContain("overflow-x-hidden");
    expect(panel?.className).toContain("max-w-full");

    expect(actions?.className).toContain("grid");
    expect(actions?.className).toContain("grid-cols-2");
    expect(actions?.className).toContain("sm:flex");
    expect(actions?.className).toContain("pb-[max(env(safe-area-inset-bottom),1rem)]");
  });

  it("shows a Done CTA in the success footer", async () => {
    schedulePost.mockResolvedValue({});
    await act(async () => {
      root.render(<BulkPublishModal clips={clips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const submit = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Schedule"),
    );
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const actions = container.querySelector('[data-testid="bulk-publish-actions"]');
    const doneButton = Array.from(actions?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Done",
    );
    expect(doneButton).toBeTruthy();
    expect(doneButton?.className).toContain("col-span-2");
  });
});
