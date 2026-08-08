import { describe, expect, it } from "vitest";
import { calculateRemainingVisits, DEDUCTED_BOOKING_STATUSES } from "./subscription-usage";

describe("calculateRemainingVisits", () => {
  it("never restores more visits than the subscription contains", () => {
    expect(calculateRemainingVisits(8, 0, 9)).toBe(8);
  });

  it("derives the balance from charged bookings instead of incremental updates", () => {
    expect(calculateRemainingVisits(8, 2, 4)).toBe(6);
  });

  it("keeps unlimited subscriptions unchanged", () => {
    expect(calculateRemainingVisits(null, 12, null)).toBeNull();
  });

  it("does not spend a visit while the client is only booked", () => {
    expect(DEDUCTED_BOOKING_STATUSES).not.toContain("booked");
    expect(DEDUCTED_BOOKING_STATUSES).toEqual(["completed", "absent", "late_cancel"]);
  });
});
