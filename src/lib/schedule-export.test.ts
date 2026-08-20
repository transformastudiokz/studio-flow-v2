import { describe, expect, it } from "vitest";
import { buildScheduleExportModel, formatSessionTextForExport, isGroupSessionForExport } from "@/lib/schedule-export";
import type { ScheduleSession } from "@/lib/schedule";

const session = (overrides: Partial<ScheduleSession> = {}): ScheduleSession => ({
  id: crypto.randomUUID(),
  class_type_id: "type-1",
  coach_id: "coach-1",
  start_time: "2026-08-20T13:10:00.000Z",
  end_time: "2026-08-20T14:10:00.000Z",
  capacity: 12,
  room: "Большой зал",
  booking_status: "open",
  booking_closed_reason: null,
  is_cancelled: false,
  is_client_visible: true,
  session_kind: "fitness",
  class_type: { id: "type-1", name: "Пилатес", color: null },
  coach: { id: "coach-1", name: "Нурханова Тумар" },
  bookings: [],
  ...overrides,
});

describe("schedule Excel export", () => {
  it("exports every session except individual classes", () => {
    expect(isGroupSessionForExport(session({ booking_status: "closed" }))).toBe(true);
    expect(isGroupSessionForExport(session({ is_client_visible: false }))).toBe(true);
    expect(isGroupSessionForExport(session({ is_cancelled: true }))).toBe(true);
    expect(isGroupSessionForExport(session({ booking_status: "cancelled" }))).toBe(true);
    expect(isGroupSessionForExport(session({ session_kind: "rental" }))).toBe(true);
    expect(isGroupSessionForExport(session({ class_type: { id: "i", name: "Индивидуальное занятие", color: null } }))).toBe(false);
    expect(isGroupSessionForExport(session({ class_type: { id: "s", name: "Сплит-тренировка", color: null } }))).toBe(true);
    expect(isGroupSessionForExport(session({ class_type: { id: "w", name: "Мастер-класс", color: null } }))).toBe(true);
  });

  it("marks closed, cancelled and workshop sessions in the printed text", () => {
    expect(formatSessionTextForExport(session({ booking_status: "closed" }))).toContain("ЗАПИСЬ ЗАКРЫТА");
    expect(formatSessionTextForExport(session({ booking_status: "cancelled", is_cancelled: true }))).toContain("ОТМЕНЕНО");
    expect(formatSessionTextForExport(session({ class_type: { id: "w", name: "Мастер-класс", color: null } }))).toContain("МАСТЕР-КЛАСС");
  });

  it("groups starts within one hour and keeps chronological order", () => {
    const later = session({ id: "later", start_time: "2026-08-20T13:20:00.000Z" });
    const earlier = session({ id: "earlier", start_time: "2026-08-20T13:10:00.000Z" });
    const model = buildScheduleExportModel(
      [later, earlier],
      new Date("2026-08-16T19:00:00.000Z"),
      new Date("2026-08-22T19:00:00.000Z"),
    );

    expect(model.hours).toEqual([18]);
    expect(model.cells.get("2026-08-20:18")?.map((item) => item.id)).toEqual(["earlier", "later"]);
    expect(model.filename).toBe("Расписание_Balance_Studio_2026-08-17_2026-08-23.xlsx");
  });
});
