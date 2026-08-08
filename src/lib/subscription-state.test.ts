import { describe, expect, it } from "vitest";
import { getSubscriptionState } from "@/lib/subscription-state";

describe("subscription state", () => {
  it("treats the end date as inclusive", () => {
    expect(getSubscriptionState({ activation_date: "2026-07-01", end_date: "2026-07-30", visits_total: 12, visits_remaining: 2, is_active: true }, "2026-07-30")).toBe("active");
    expect(getSubscriptionState({ activation_date: "2026-07-01", end_date: "2026-07-30", visits_total: 12, visits_remaining: 2, is_active: true }, "2026-07-31")).toBe("expired");
  });

  it("ends a subscription when no visits remain", () => {
    expect(getSubscriptionState({ activation_date: "2026-08-01", end_date: "2026-09-01", visits_total: 8, visits_remaining: 0, is_active: true }, "2026-08-08")).toBe("used");
  });

  it("distinguishes a purchased subscription from an active one", () => {
    expect(getSubscriptionState({ activation_date: null, end_date: null, visits_total: 8, visits_remaining: 8, is_active: true }, "2026-08-08")).toBe("purchased");
  });
});
