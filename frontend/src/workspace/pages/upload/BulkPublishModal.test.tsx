// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ClipApiResponse } from "@/lib/api";

const { listAccounts, schedulePost, publishNow } = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  schedulePost: vi.fn(),
  publishNow: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  platformApi: { listAccounts, schedulePost, publishNow },
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

    const submit = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Schedule"));
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const actions = container.querySelector('[data-testid="bulk-publish-actions"]');
    const doneButton = Array.from(actions?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Done",
    );
    expect(doneButton).toBeTruthy();
    expect(doneButton?.className).toContain("col-span-2");
  });

  it("post-now mode calls schedulePost then publishNow, in that order", async () => {
    const callOrder: string[] = [];
    schedulePost.mockImplementation(async () => {
      callOrder.push("schedulePost");
      return { id: "post-1" };
    });
    publishNow.mockImplementation(async () => {
      callOrder.push("publishNow");
      return {};
    });
    await act(async () => {
      root.render(<BulkPublishModal clips={clips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const postNowBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Post now",
    );
    await act(async () => {
      postNowBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const submit = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Post") && b.textContent?.includes("now"));
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(schedulePost).toHaveBeenCalledTimes(1);
    expect(publishNow).toHaveBeenCalledWith("post-1");
    expect(callOrder).toEqual(["schedulePost", "publishNow"]);
  });

  it("schedule mode is unaffected (regression) — does not call publishNow", async () => {
    schedulePost.mockResolvedValue({ id: "post-2" });
    await act(async () => {
      root.render(<BulkPublishModal clips={clips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const submit = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Schedule"));
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(schedulePost).toHaveBeenCalledTimes(1);
    expect(publishNow).not.toHaveBeenCalled();
  });

  it("surfaces error when publishNow fails after schedulePost succeeds", async () => {
    schedulePost.mockResolvedValue({ id: "post-3" });
    publishNow.mockRejectedValue(new Error("celery down"));
    await act(async () => {
      root.render(<BulkPublishModal clips={clips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const postNowBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Post now",
    );
    await act(async () => {
      postNowBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const submit = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Post") && b.textContent?.includes("now"));
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const errorEl = container.querySelector(".text-red-400");
    expect(errorEl?.textContent).toContain("celery down");
    expect(errorEl?.textContent).toContain("Post saved but not enqueued");
  });

  it("mixed groups: FIRST post-now group fails, later scheduled + post-now groups still process — proves continue-on-error, not fail-fast", async () => {
    const mixedClips: ClipApiResponse[] = [
      { id: "clip-1", title: "Clip One" } as ClipApiResponse,
      { id: "clip-2", title: "Clip Two" } as ClipApiResponse,
      { id: "clip-3", title: "Clip Three" } as ClipApiResponse,
    ];

    schedulePost.mockImplementation(async ({ clip_id }: { clip_id: string }) => ({ id: `post-${clip_id}` }));
    // The FAILING group is clip-1, which is processed FIRST. A fail-fast implementation
    // would stop here and never reach clip-2/clip-3 — this is the case Codex flagged.
    publishNow.mockImplementation(async (postId: string) => {
      if (postId === "post-clip-1") throw new Error("provider rejected");
      return {};
    });

    await act(async () => {
      root.render(<BulkPublishModal clips={mixedClips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const getGroup = (slotNum: number) => {
      const span = Array.from(container.querySelectorAll("span")).find((s) =>
        s.textContent?.includes(`Slot ${slotNum}`),
      );
      return span?.closest('div[class*="rounded-[14px]"]') as HTMLElement;
    };
    const clickClipInGroup = (group: HTMLElement, label: string) => {
      const btn = Array.from(group.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    const clickPostNowInGroup = (group: HTMLElement) => {
      const btn = Array.from(group.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Post now");
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    // Group 1 (slot 1, processed FIRST) starts with all 3 clips. Deselect clip-2 and clip-3,
    // keep clip-1, set it to "post now" — this is the group that will fail.
    await act(async () => {
      clickClipInGroup(getGroup(1), "Clip Two");
      clickClipInGroup(getGroup(1), "Clip Three");
      clickPostNowInGroup(getGroup(1));
    });

    // Add group 2 (processed AFTER the failing group), assign clip-2, "schedule for later".
    const addSlotBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Add time slot"),
    );
    await act(async () => {
      addSlotBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      clickClipInGroup(getGroup(2), "Clip Two");
    });

    // Add group 3 (also AFTER the failing group), assign clip-3, "post now" — this one succeeds.
    await act(async () => {
      addSlotBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      clickClipInGroup(getGroup(3), "Clip Three");
      clickPostNowInGroup(getGroup(3));
    });

    const submit = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Schedule") || b.textContent?.includes("Post"));
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Proof of continuation: groups 2 and 3 (after the failing group 1) were still fully processed.
    expect(schedulePost).toHaveBeenCalledTimes(3);
    expect(schedulePost).toHaveBeenCalledWith(expect.objectContaining({ clip_id: "clip-2" }));
    expect(schedulePost).toHaveBeenCalledWith(expect.objectContaining({ clip_id: "clip-3" }));
    // publishNow attempted for both post-now groups (clip-1 fails, clip-3 succeeds); never for the scheduled-only clip-2.
    expect(publishNow).toHaveBeenCalledTimes(2);
    expect(publishNow).toHaveBeenCalledWith("post-clip-1");
    expect(publishNow).toHaveBeenCalledWith("post-clip-3");

    const errorEl = container.querySelector(".text-red-400");
    expect(errorEl?.textContent).toContain("Clip One");
    expect(errorEl?.textContent).toContain("provider rejected");
    // The succeeded groups (clip-2 scheduled, clip-3 post-now) must be called out as already done,
    // not implicated in the clip-1 failure.
    expect(errorEl?.textContent).toContain("Clip Two");
    expect(errorEl?.textContent).toContain("Clip Three");
    expect(errorEl?.textContent).toContain("does NOT need retrying");
    expect(errorEl?.textContent).not.toMatch(/Clip Three.*provider rejected/);

    // Retry-safety: the failed clip's submit button must relabel to a scoped retry, not a full resubmit.
    const retryBtn = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Retry"));
    expect(retryBtn?.textContent).toContain("Retry 1 failed clip");

    // Clicking retry must NOT call schedulePost again for clip-1 (it already has a real post_id) —
    // only publishNow is retried for it.
    await act(async () => {
      retryBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(schedulePost).toHaveBeenCalledTimes(3); // unchanged — no new schedulePost calls on retry
    expect(publishNow).toHaveBeenCalledTimes(3); // one more retry attempt for post-clip-1
  });

  it("retry after publishNow failure: schedulePost is not called again for that clip, only publishNow is retried", async () => {
    const clip = [{ id: "clip-9", title: "Clip Nine" } as ClipApiResponse];
    schedulePost.mockResolvedValue({ id: "post-clip-9" });
    publishNow.mockRejectedValueOnce(new Error("provider rejected")).mockResolvedValueOnce({});

    await act(async () => {
      root.render(<BulkPublishModal clips={clip} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const postNowBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Post now",
    );
    await act(async () => {
      postNowBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const clickSubmit = async () => {
      const btn = Array.from(
        container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
      ).find((b) => b.textContent?.includes("Post") || b.textContent?.includes("Retry"));
      await act(async () => {
        btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await clickSubmit(); // fails at publishNow
    expect(schedulePost).toHaveBeenCalledTimes(1);
    expect(publishNow).toHaveBeenCalledTimes(1);

    await clickSubmit(); // retry — should reuse the existing post_id, only re-call publishNow
    expect(schedulePost).toHaveBeenCalledTimes(1);
    expect(publishNow).toHaveBeenCalledTimes(2);
    expect(publishNow).toHaveBeenNthCalledWith(2, "post-clip-9");
  });

  it("counts a schedulePost-level failure toward the retry count (not just publishNow failures)", async () => {
    const mixedClips: ClipApiResponse[] = [
      { id: "clip-1", title: "Clip One" } as ClipApiResponse,
      { id: "clip-2", title: "Clip Two" } as ClipApiResponse,
    ];
    schedulePost.mockImplementation(async ({ clip_id }: { clip_id: string }) => {
      if (clip_id === "clip-1") throw new Error("network error");
      return { id: `post-${clip_id}` };
    });

    await act(async () => {
      root.render(<BulkPublishModal clips={mixedClips} onClose={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const submit = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Schedule"));
    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both clip-1 (schedulePost failed) and clip-2 (succeeded) were attempted.
    expect(schedulePost).toHaveBeenCalledTimes(2);
    // The retry count must include the schedulePost-level failure, not just publishNow ones.
    const retryBtn = Array.from(
      container.querySelector('[data-testid="bulk-publish-actions"]')?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.includes("Retry"));
    expect(retryBtn?.textContent).toContain("Retry 1 failed clip");
  });
});
