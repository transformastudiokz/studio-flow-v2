import { describe, expect, it } from "vitest";
import {
  isFreeWorkshopMembership,
  isPaidWorkshopPass,
  isWorkshopSession,
  subscriptionIsValidOn,
} from "./workshop-access";

const subscription = (overrides = {}) => ({
  id: "sub-1",
  visits_remaining: 3,
  is_active: true,
  start_date: "2026-08-01",
  end_date: "2026-08-31",
  plan: { plan_format: "group", product_kind: "fitness" },
  ...overrides,
});

describe("workshop access", () => {
  it.each(["group", "individual", "split"])("allows active %s memberships for free", (planFormat) => {
    expect(isFreeWorkshopMembership(subscription({ plan: { plan_format: planFormat, product_kind: "fitness" } }))).toBe(true);
  });

  it("does not treat the workshop pass as a free membership", () => {
    const pass = subscription({ plan: { plan_format: "group", product_kind: "workshop" } });
    expect(isFreeWorkshopMembership(pass)).toBe(false);
    expect(isPaidWorkshopPass(pass)).toBe(true);
  });

  it("checks remaining visits and inclusive dates", () => {
    expect(subscriptionIsValidOn(subscription(), "2026-08-31")).toBe(true);
    expect(subscriptionIsValidOn(subscription({ visits_remaining: 0 }), "2026-08-10")).toBe(false);
    expect(subscriptionIsValidOn(subscription(), "2026-09-01")).toBe(false);
  });

  it("recognizes both the durable kind and legacy class name", () => {
    expect(isWorkshopSession({ session_kind: "workshop" })).toBe(true);
    expect(isWorkshopSession({ session_kind: "fitness", class_type: { name: "Мастер-класс" } })).toBe(true);
  });
});
