import { describe, expect, it } from "vitest";
import {
  formatCoachShortName,
  normalizePhone,
  normalizeRoom,
  occupiesPlace,
  resolveAvailableRoom,
  scheduleStartHour,
  sessionConflict,
  sessionsOverlap,
} from "./schedule";

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "one",
  start_time: "2026-08-10T10:00:00.000Z",
  end_time: "2026-08-10T11:00:00.000Z",
  room: "Большой зал",
  coach_id: "coach-1",
  booking_status: "open" as const,
  ...overrides,
});

describe("schedule business rules", () => {
  it("allows adjacent sessions and detects real overlap", () => {
    expect(sessionsOverlap(session(), session({ id: "two", start_time: "2026-08-10T11:00:00.000Z", end_time: "2026-08-10T12:00:00.000Z" }))).toBe(false);
    expect(sessionsOverlap(session(), session({ id: "two", start_time: "2026-08-10T10:30:00.000Z", end_time: "2026-08-10T11:30:00.000Z" }))).toBe(true);
  });

  it("finds a room or trainer conflict but ignores cancelled sessions", () => {
    expect(sessionConflict(session({ id: "candidate", coach_id: "coach-2" }), [session()])?.id).toBe("one");
    expect(sessionConflict(session({ id: "candidate", room: "Малый зал" }), [session()])?.id).toBe("one");
    expect(sessionConflict(session({ id: "candidate", room: "Малый зал", coach_id: "coach-2" }), [session({ booking_status: "cancelled" })])).toBeUndefined();
  });

  it("counts only bookings that still occupy a place", () => {
    expect(occupiesPlace("booked")).toBe(true);
    expect(occupiesPlace("completed")).toBe(true);
    expect(occupiesPlace("cancelled")).toBe(false);
    expect(occupiesPlace("late_cancel")).toBe(false);
    expect(occupiesPlace("absent")).toBe(false);
  });

  it("normalizes rooms and Kazakhstan phone numbers", () => {
    expect(normalizeRoom(null)).toBe("Большой зал");
    expect(normalizeRoom("Малый зал")).toBe("Малый зал");
    expect(normalizePhone("8 (707) 123-45-67")).toBe("77071234567");
    expect(normalizePhone("7071234567")).toBe("77071234567");
  });

  it("shows the coach name with the surname initial in compact cards", () => {
    expect(formatCoachShortName("Нурханова Тумар Максатовна")).toBe("Тумар Н.");
    expect(formatCoachShortName("Ажар")).toBe("Ажар");
    expect(formatCoachShortName(null)).toBe("Без тренера");
  });

  it("places a session strictly in the hour when it starts", () => {
    expect(scheduleStartHour("2026-08-04T19:30:00")).toBe(19);
    expect(scheduleStartHour("2026-08-04T20:30:00")).toBe(20);
    expect(scheduleStartHour("2026-08-08T11:00:00")).toBe(11);
  });

  it("moves the second overlapping session to the small room", () => {
    expect(resolveAvailableRoom("Большой зал", ["Большой зал"])).toBe("Малый зал");
    expect(resolveAvailableRoom("Большой зал", ["Большой зал", "Малый зал"])).toBeNull();
    expect(resolveAvailableRoom("Большой зал", [])).toBe("Большой зал");
  });
});
