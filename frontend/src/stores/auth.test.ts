import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  auth: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  },
  token: {
    get: vi.fn(() => "tok"),
    set: vi.fn(),
    clear: vi.fn(),
    hasSession: vi.fn(() => true),
  },
}));

import { auth as api, token } from "@/lib/api";
import { applyTokenAndRedirect } from "@/stores/auth";

describe("applyTokenAndRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores token, refreshes user, then SPA-navigates in order (Submit/Skip completion path)", async () => {
    const order: string[] = [];
    (token.set as any).mockImplementation(() => order.push("token.set"));
    (api.me as any).mockImplementation(async () => {
      order.push("refreshUser");
      return { id: "u1", email: "a@b.com", full_name: null, tenant_id: "t1", is_verified: true, onboarding_step: null, plan: "free" };
    });
    const spaNavigate = vi.fn(() => order.push("spaNavigate"));
    const hardNavigate = vi.fn();

    await applyTokenAndRedirect("new-token", "/", spaNavigate, hardNavigate);

    expect(order).toEqual(["token.set", "refreshUser", "spaNavigate"]);
    expect(token.set).toHaveBeenCalledWith("new-token");
    expect(spaNavigate).toHaveBeenCalledWith("/");
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("falls back to hard navigation when refresh fails, without SPA-navigating on stale state", async () => {
    (api.me as any).mockRejectedValue(new Error("network error"));
    const spaNavigate = vi.fn();
    const hardNavigate = vi.fn();

    await applyTokenAndRedirect("new-token", "/", spaNavigate, hardNavigate);

    expect(token.set).toHaveBeenCalledWith("new-token");
    expect(spaNavigate).not.toHaveBeenCalled();
    expect(hardNavigate).toHaveBeenCalledWith("/");
  });
});
