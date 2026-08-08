// Запись резервирует место в группе, но не расходует занятие из абонемента.
// Списание происходит только после фактического результата занятия:
// посещение, неявка или поздняя отмена.
export const DEDUCTED_BOOKING_STATUSES = ["completed", "absent", "late_cancel"] as const;

export function calculateRemainingVisits(
  visitsTotal: number | null,
  chargedBookings: number,
  currentRemaining: number | null,
) {
  if (visitsTotal === null) return currentRemaining;
  return Math.max(0, Math.min(visitsTotal, visitsTotal - chargedBookings));
}
