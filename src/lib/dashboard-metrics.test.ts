import { describe, expect, it } from "vitest";
import {
  calculateBestRevenueDay,
  calculateFillRate,
  dashboardPercent,
} from "./dashboard-metrics";

describe("dashboard metrics", () => {
  it("does not call a loss-making day the best revenue day", () => {
    expect(calculateBestRevenueDay([
      { date: "2026-08-01", label: "1 авг", value: -3_500 },
      { date: "2026-08-02", label: "2 авг", value: 0 },
    ])).toBeNull();
  });

  it("selects the highest positive daily net revenue", () => {
    expect(calculateBestRevenueDay([
      { date: "2026-08-01", label: "1 авг", value: 10_000 },
      { date: "2026-08-02", label: "2 авг", value: 17_000 },
    ])?.date).toBe("2026-08-02");
  });

  it("caps visual studio occupancy at 100 percent", () => {
    expect(calculateFillRate(13, 12)).toBe(100);
    expect(calculateFillRate(6, 12)).toBe(50);
    expect(calculateFillRate(0, 0)).toBe(0);
  });

  it("returns stable funnel percentages", () => {
    expect(dashboardPercent(7, 10)).toBe(70);
    expect(dashboardPercent(1, 0)).toBe(0);
  });
});
