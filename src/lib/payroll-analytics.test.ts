import { describe, expect, it } from "vitest";
import { buildPayrollAnalytics, type PayrollBooking, type PayrollCoach, type PayrollSession, type PayrollSubscription } from "./payroll-analytics";

const coaches: PayrollCoach[] = [
  { id: "coach-1", name: "Иванова Анна", rate_per_client: 1000, aggregator_rate_per_client: 700, profile: { first_name: "Анна", last_name: "Иванова" } },
  { id: "coach-2", name: "Петрова Мария", rate_per_client: 900, aggregator_rate_per_client: 600 },
];

const bookingHistory: PayrollBooking[] = [
  { id: "b1", session_id: "s1", user_id: "client-1", status: "completed", created_at: "2026-08-01T09:00:00Z" },
  { id: "b2", session_id: "s2", user_id: "client-2", status: "cancelled", created_at: "2026-08-01T10:00:00Z" },
  { id: "b3", session_id: "s2", user_id: "client-2", status: "completed", created_at: "2026-08-02T10:00:00Z" },
];

const sessions: PayrollSession[] = [
  {
    id: "s1", coach_id: "coach-1", start_time: "2026-08-02T05:00:00Z", end_time: "2026-08-02T06:00:00Z",
    booking_status: "open", is_cancelled: false, session_kind: "fitness",
    bookings: [bookingHistory[0]], onefit_bookings: [{ is_active: true, source_status: "confirmed" }, { is_active: true, source_status: "queued" }],
  },
  {
    id: "s2", coach_id: "coach-2", start_time: "2026-08-03T05:00:00Z", end_time: "2026-08-03T06:00:00Z",
    booking_status: "open", is_cancelled: false, session_kind: "fitness",
    bookings: [bookingHistory[2]], onefit_bookings: [],
  },
  {
    id: "s3", coach_id: "coach-1", start_time: "2026-08-04T05:00:00Z", end_time: "2026-08-04T06:00:00Z",
    booking_status: "cancelled", is_cancelled: true, session_kind: "fitness", bookings: [], onefit_bookings: [],
  },
];

const subscriptions: PayrollSubscription[] = [{
  id: "sub-1", user_id: "client-1", visits_total: 8, start_date: "2026-08-02", created_at: "2026-08-02T07:00:00Z",
  first_payment_at: "2026-08-02T07:00:00Z", net_paid: 35750, plan: { name: "8 занятий", visits_count: 8 },
}];

describe("buildPayrollAnalytics", () => {
  it("counts completed CRM visits, confirmed OneFit visits and purchases after a first booking", () => {
    const result = buildPayrollAnalytics({ coaches, sessions, bookingHistory, subscriptions, now: new Date("2026-08-31T00:00:00Z") });
    const anna = result.rows.find((row) => row.id === "coach-1")!;
    expect(anna).toMatchObject({
      name: "Анна Иванова",
      sessionCount: 1,
      crmVisits: 1,
      onefitVisits: 1,
      totalVisits: 2,
      trialStars: 1,
      purchasesAfterTrial: 1,
      conversionRate: 100,
      payment: 1700,
    });
  });

  it("does not turn a second booking into a new star when the first booking was cancelled", () => {
    const result = buildPayrollAnalytics({ coaches, sessions, bookingHistory, subscriptions, now: new Date("2026-08-31T00:00:00Z") });
    const maria = result.rows.find((row) => row.id === "coach-2")!;
    expect(maria.trialStars).toBe(0);
    expect(maria.crmVisits).toBe(1);
  });

  it("excludes cancelled and future sessions and calculates aggregate averages", () => {
    const result = buildPayrollAnalytics({ coaches, sessions, bookingHistory, subscriptions, now: new Date("2026-08-02T08:00:00Z") });
    expect(result.totals.sessionCount).toBe(1);
    expect(result.totals.totalVisits).toBe(2);
    expect(result.averageSessionsPerCoach).toBe(1);
    expect(result.averageCrmPerSession).toBe(1);
    expect(result.averageOnefitPerSession).toBe(1);
  });

  it("does not count an absent CRM booking or a queued and inactive OneFit booking as attendance", () => {
    const booking: PayrollBooking = { id: "absence", session_id: "session", user_id: "client", status: "absent", created_at: "2026-08-01T06:00:00Z" };
    const result = buildPayrollAnalytics({
      coaches: [coaches[0]],
      sessions: [{
        id: "session",
        coach_id: "coach-1",
        start_time: "2026-08-01T07:00:00Z",
        end_time: "2026-08-01T08:00:00Z",
        booking_status: "open",
        is_cancelled: false,
        session_kind: "fitness",
        bookings: [booking],
        onefit_bookings: [
          { is_active: true, source_status: "queued" },
          { is_active: false, source_status: "confirmed" },
        ],
      }],
      bookingHistory: [booking],
      subscriptions: [],
      now: new Date("2026-08-02T00:00:00Z"),
    });
    expect(result.totals.crmVisits).toBe(0);
    expect(result.totals.onefitVisits).toBe(0);
    expect(result.totals.trialStars).toBe(1);
  });

  it("does not attribute a regular subscription purchased before the first class", () => {
    const earlySubscription: PayrollSubscription = {
      ...subscriptions[0],
      first_payment_at: "2026-08-02T05:00:00Z",
      created_at: "2026-08-02T05:00:00Z",
    };
    const result = buildPayrollAnalytics({ coaches, sessions, bookingHistory, subscriptions: [earlySubscription], now: new Date("2026-08-31T00:00:00Z") });
    expect(result.rows.find((row) => row.id === "coach-1")?.purchasesAfterTrial).toBe(0);
  });

  it("does not count a fully refunded subscription as a purchase", () => {
    const refundedSubscription: PayrollSubscription = { ...subscriptions[0], net_paid: 0 };
    const result = buildPayrollAnalytics({ coaches, sessions, bookingHistory, subscriptions: [refundedSubscription], now: new Date("2026-08-31T00:00:00Z") });
    expect(result.rows.find((row) => row.id === "coach-1")?.purchasesAfterTrial).toBe(0);
  });
});
