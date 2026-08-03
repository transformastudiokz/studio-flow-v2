import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  getClientStatus,
  getClientStatusForBooking,
  type SubscriptionSummary,
} from "@/lib/client-status";

const subscription = (overrides: Partial<SubscriptionSummary> = {}): SubscriptionSummary => ({
  user_id: "client-1",
  visits_remaining: 3,
  end_date: null,
  is_active: true,
  plan: { name: "8 занятий" },
  ...overrides,
});

describe("client membership indicators", () => {
  it("shows red when there is no active membership", () => {
    expect(getClientStatus([]).membership).toBe("inactive");
    expect(getClientStatus([subscription({ visits_remaining: 0 })]).membership).toBe("inactive");
  });

  it("shows orange when a regular membership has one or two visits", () => {
    expect(getClientStatus([subscription({ visits_remaining: 1 })]).membership).toBe("ending");
    expect(getClientStatus([subscription({ visits_remaining: 2 })]).membership).toBe("ending");
  });

  it("shows green when a regular membership has more than two visits", () => {
    expect(getClientStatus([subscription({ visits_remaining: 3 })]).membership).toBe("active");
  });

  it("keeps an active trial membership green", () => {
    expect(
      getClientStatus([
        subscription({ visits_remaining: 1, plan: { name: "Пробное занятие" } }),
      ]).membership,
    ).toBe("active");
  });

  it("puts the star only on the first booking in the client history", () => {
    const baseStatus = {
      ...getClientStatus([subscription()]),
      firstBookingId: "booking-1",
    };

    expect(getClientStatusForBooking(baseStatus, "booking-1")?.isFirstVisit).toBe(true);
    expect(getClientStatusForBooking(baseStatus, "booking-2")?.isFirstVisit).toBe(false);
  });

  it("keeps the first trial booking green after its only visit was reserved", () => {
    const baseStatus = {
      ...getClientStatus([
        subscription({ visits_remaining: 0, plan: { name: "Пробное занятие" } }),
      ]),
      firstBookingId: "booking-1",
    };

    const firstBookingStatus = getClientStatusForBooking(baseStatus, "booking-1");
    expect(firstBookingStatus?.isFirstVisit).toBe(true);
    expect(firstBookingStatus?.membership).toBe("active");
  });
});
