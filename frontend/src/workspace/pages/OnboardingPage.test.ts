import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  onboarding: {
    connect: vi.fn(),
    niche: vi.fn(),
    goal: vi.fn(),
    plan: vi.fn(),
    finalize: vi.fn(),
    skip: vi.fn(),
  },
  billingApi: {
    plans: vi.fn(),
  },
}));

vi.mock("@/lib/router", () => ({
  navigate: vi.fn(),
}));

vi.mock("@/stores/auth", () => ({
  applyTokenAndRedirect: vi.fn(),
}));

import { onboarding } from "@/lib/api";
import { navigate } from "@/lib/router";
import { applyTokenAndRedirect } from "@/stores/auth";
import { submitFinalize, submitSkip } from "@/workspace/pages/OnboardingPage";

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).localStorage = {
    removeItem: vi.fn(),
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  };
});

describe("submitFinalize (final Submit entry point)", () => {
  it("invokes applyTokenAndRedirect with the finalize token after plan+finalize succeed", async () => {
    (onboarding.plan as any).mockResolvedValue({});
    (onboarding.finalize as any).mockResolvedValue({ access_token: "finalize-token" });

    await submitFinalize("pro", "/billing?upgrade=pro");

    expect(onboarding.plan).toHaveBeenCalledWith("free");
    expect(onboarding.finalize).toHaveBeenCalled();
    expect(applyTokenAndRedirect).toHaveBeenCalledWith(
      "finalize-token",
      "/billing?upgrade=pro",
      navigate,
    );
  });
});

describe("submitSkip (global Skip entry point)", () => {
  it("invokes applyTokenAndRedirect with the skip token after skip succeeds", async () => {
    (onboarding.skip as any).mockResolvedValue({ access_token: "skip-token" });

    await submitSkip();

    expect(onboarding.skip).toHaveBeenCalled();
    expect(applyTokenAndRedirect).toHaveBeenCalledWith("skip-token", "/", navigate);
  });

  it("propagates the error and does not call applyTokenAndRedirect when skip() fails", async () => {
    (onboarding.skip as any).mockRejectedValue(new Error("skip failed"));

    await expect(submitSkip()).rejects.toThrow("skip failed");

    expect(applyTokenAndRedirect).not.toHaveBeenCalled();
  });
});
