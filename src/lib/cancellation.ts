export const parseCancellationMinutes = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : null;
};

export const canClientCancel = (startTime: string | Date, cancellationMinutes: number, now = new Date()) => {
  const start = startTime instanceof Date ? startTime : new Date(startTime);
  if (Number.isNaN(start.getTime())) return false;
  return Math.floor((start.getTime() - now.getTime()) / 60_000) >= cancellationMinutes;
};

export const formatCancellationCutoff = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} ч.` : `${minutes} мин.`;
