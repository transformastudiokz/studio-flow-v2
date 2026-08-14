export type RevenuePoint = { date: string; label: string; value: number };

export const dashboardPercent = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

export const calculateBestRevenueDay = (points: RevenuePoint[]) => {
  const best = points.reduce<RevenuePoint | null>(
    (current, point) => (!current || point.value > current.value ? point : current),
    null,
  );

  return best && best.value > 0 ? best : null;
};

export const calculateFillRate = (occupied: number, capacity: number) => {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((occupied / capacity) * 100)));
};
