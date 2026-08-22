import { addDays, addMinutes, format, parseISO, startOfWeek } from "date-fns";

export const STUDIO_ROOMS = ["Большой зал", "Малый зал"] as const;
export type StudioRoom = (typeof STUDIO_ROOMS)[number];

export const SCHEDULE_START_HOUR = 7;
export const SCHEDULE_END_HOUR = 22;
export const HOUR_HEIGHT = 88;

export type BookingStatus = "booked" | "completed" | "absent" | "cancelled" | "late_cancel";
export type SessionBookingStatus = "open" | "closed" | "cancelled";

export type ScheduleClient = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email?: string | null;
};

export type ScheduleBooking = {
  id: string;
  status: BookingStatus | string;
  user_id: string;
  created_at?: string | null;
  user: ScheduleClient | null;
  clientStatus?: import("@/lib/client-status").ClientStatus;
  isTransferred?: boolean;
  access_type?: import("@/lib/workshop-access").WorkshopAccessType | string | null;
  eligibility_subscription_id?: string | null;
};

export type ScheduleSession = {
  id: string;
  class_type_id: string;
  coach_id: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  room: string | null;
  booking_status: SessionBookingStatus;
  booking_closed_reason: string | null;
  public_description?: string | null;
  is_client_visible?: boolean | null;
  is_cancelled?: boolean | null;
  session_kind?: "fitness" | "rental" | "workshop";
  class_type: { id: string; name: string; color: string | null; duration_min?: number | null } | null;
  coach: { id: string; name: string } | null;
  bookings: ScheduleBooking[];
  onefit_bookings?: Array<{ id: string; client_name: string; source_status: string; is_active: boolean }>;
  firstBookingCount?: number;
  repeatBookingCount?: number;
  rental_booking?: {
    id: string;
    renter_id: string;
    service_id: string;
    agreed_price: number;
    rental_status: string;
    notes: string | null;
    renter?: ScheduleClient | null;
    financials?: Array<{ paid_amount: number; debt_amount: number; payment_status: "paid" | "partial" | "unpaid" }>;
  } | null;
};

export const normalizeRoom = (room?: string | null): StudioRoom =>
  room === "Малый зал" ? "Малый зал" : "Большой зал";

export const formatCoachShortName = (name?: string | null) => {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Без тренера";
  return `${parts[1]} ${parts[0].slice(0, 1).toLocaleUpperCase("ru-RU")}.`;
};

export const scheduleStartHour = (iso: string) => parseISO(iso).getHours();

export const occupiesPlace = (status: string) =>
  !["cancelled", "late_cancel", "absent"].includes(status);

export const showsFirstBookingIndicator = (status: string) =>
  !["cancelled", "late_cancel"].includes(status);

/** Cancelled bookings stay in history, but are not participants of the session. */
export const showsInSessionParticipants = (status: string) =>
  !["cancelled", "late_cancel"].includes(status);

export const activeBookings = (session: Pick<ScheduleSession, "bookings">) =>
  (session.bookings || []).filter((booking) => occupiesPlace(booking.status));

export const sessionBookingCount = (session: Pick<ScheduleSession, "bookings" | "onefit_bookings">) =>
  activeBookings(session).length + (session.onefit_bookings || []).filter((booking) => booking.is_active).length;

export const resolveAvailableRoom = (
  requestedRoom: string,
  overlappingRooms: Array<string | null>,
): StudioRoom | null => {
  const requested = normalizeRoom(requestedRoom);
  const occupied = new Set(overlappingRooms.map(normalizeRoom));
  if (!occupied.has(requested)) return requested;
  if (requested === "Большой зал" && !occupied.has("Малый зал")) return "Малый зал";
  return null;
};

export const sessionMinutesFromStart = (iso: string) => {
  const date = parseISO(iso);
  return date.getHours() * 60 + date.getMinutes() - SCHEDULE_START_HOUR * 60;
};

export const sessionPosition = (session: Pick<ScheduleSession, "start_time" | "end_time">) => {
  const start = parseISO(session.start_time);
  const end = parseISO(session.end_time);
  const startMinutes = Math.max(0, sessionMinutesFromStart(session.start_time));
  const durationMinutes = Math.max(30, (end.getTime() - start.getTime()) / 60_000);

  return {
    top: (startMinutes / 60) * HOUR_HEIGHT,
    height: Math.max(48, (durationMinutes / 60) * HOUR_HEIGHT - 4),
  };
};

export const sessionsOverlap = (
  left: Pick<ScheduleSession, "start_time" | "end_time">,
  right: Pick<ScheduleSession, "start_time" | "end_time">,
) => parseISO(left.start_time) < parseISO(right.end_time) && parseISO(right.start_time) < parseISO(left.end_time);

export const sessionConflict = (
  candidate: Pick<ScheduleSession, "id" | "start_time" | "end_time" | "room" | "coach_id" | "booking_status">,
  sessions: Array<Pick<ScheduleSession, "id" | "start_time" | "end_time" | "room" | "coach_id" | "booking_status">>,
) => sessions.find((existing) => {
  if (existing.id === candidate.id || existing.booking_status === "cancelled") return false;
  if (!sessionsOverlap(candidate, existing)) return false;
  const sameRoom = normalizeRoom(existing.room) === normalizeRoom(candidate.room);
  const sameCoach = Boolean(candidate.coach_id && existing.coach_id === candidate.coach_id);
  return sameRoom || sameCoach;
});

export const shiftSessionToWeek = (session: ScheduleSession, targetWeekDate: Date) => {
  const sourceWeek = startOfWeek(parseISO(session.start_time), { weekStartsOn: 1 });
  const targetWeek = startOfWeek(targetWeekDate, { weekStartsOn: 1 });
  const dayOffset = Math.round(
    (parseISO(format(parseISO(session.start_time), "yyyy-MM-dd")).getTime() - sourceWeek.getTime()) / 86_400_000,
  );
  const sourceStart = parseISO(session.start_time);
  const duration = parseISO(session.end_time).getTime() - sourceStart.getTime();
  const targetDay = addDays(targetWeek, dayOffset);
  const targetStart = new Date(
    targetDay.getFullYear(),
    targetDay.getMonth(),
    targetDay.getDate(),
    sourceStart.getHours(),
    sourceStart.getMinutes(),
  );

  return {
    class_type_id: session.class_type_id,
    coach_id: session.coach_id,
    start_time: targetStart.toISOString(),
    end_time: addMinutes(targetStart, duration / 60_000).toISOString(),
    capacity: session.capacity,
    room: normalizeRoom(session.room),
    booking_status: "open" as const,
    is_cancelled: false,
    booking_closed_reason: null,
    public_description: session.public_description || null,
    is_client_visible: session.is_client_visible !== false,
    session_kind: session.session_kind || "fitness",
  };
};

export const normalizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};
