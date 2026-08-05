// @vitest-environment node
import { describe, expect, it } from "vitest";
import { datetimeLocalToUtcIso, utcIsoToDatetimeLocal } from "./datetimeLocal";

describe("datetimeLocal", () => {
  it("round-trips local wall clock through UTC ISO", () => {
    const local = "2026-08-05T14:30";
    const utc = datetimeLocalToUtcIso(local);
    expect(utc.endsWith("Z")).toBe(true);
    expect(utcIsoToDatetimeLocal(utc)).toBe(local);
  });

  it("preserves picked local time (not UTC mis-parse)", () => {
    const utc = datetimeLocalToUtcIso("2026-01-15T09:00");
    const back = new Date(utc);
    const local = new Date(2026, 0, 15, 9, 0, 0, 0);
    expect(back.getTime()).toBe(local.getTime());
  });
});
