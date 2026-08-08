// Занятие резервируется в момент записи. Возврат происходит только при обычной
// отмене; посещение, неявка и поздняя отмена остаются списанными.
export const DEDUCTED_BOOKING_STATUSES = ["booked", "completed", "absent", "late_cancel"] as const;

export function calculateRemainingVisits(
  visitsTotal: number | null,
  chargedBookings: number,
  currentRemaining: number | null,
) {
  if (visitsTotal === null) return currentRemaining;
  return Math.max(0, Math.min(visitsTotal, visitsTotal - chargedBookings));
}
