import { describe, expect, it } from "vitest";
import { canClientCancel, formatCancellationCutoff, parseCancellationMinutes } from "./cancellation";

describe("client cancellation rule", () => {
  it("uses the configured value without enforcing a hidden two-hour minimum", () => {
    expect(parseCancellationMinutes("30")).toBe(30);
    expect(canClientCancel("2026-08-08T12:00:00Z", 30, new Date("2026-08-08T11:30:00Z"))).toBe(true);
  });

  it("closes cancellation only after the configured boundary", () => {
    const start = "2026-08-08T12:00:00Z";
    expect(canClientCancel(start, 90, new Date("2026-08-08T10:30:00Z"))).toBe(true);
    expect(canClientCancel(start, 90, new Date("2026-08-08T10:31:00Z"))).toBe(false);
  });

  it("rejects a missing or invalid setting", () => {
    expect(parseCancellationMinutes(undefined)).toBeNull();
    expect(parseCancellationMinutes("-1")).toBeNull();
    expect(formatCancellationCutoff(120)).toBe("2 ч.");
    expect(formatCancellationCutoff(45)).toBe("45 мин.");
  });
});
