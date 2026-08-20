export type PayrollCoach = {
  id: string;
  name: string;
  user_id?: string | null;
  rate_per_client?: number | null;
  aggregator_rate_per_client?: number | null;
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
};

export type PayrollBooking = {
  id: string;
  session_id: string;
  user_id: string | null;
  status: string;
  created_at: string;
};

export type PayrollOneFitBooking = {
  is_active: boolean | null;
  source_status: string | null;
};

export type PayrollSession = {
  id: string;
  coach_id: string | null;
  start_time: string;
  end_time: string;
  booking_status: string | null;
  is_cancelled: boolean | null;
  session_kind?: string | null;
  bookings?: PayrollBooking[] | null;
  onefit_bookings?: PayrollOneFitBooking[] | null;
};

export type PayrollSubscription = {
  id: string;
  user_id: string;
  visits_total: number | null;
  start_date: string | null;
  created_at: string | null;
  first_payment_at: string | null;
  net_paid: number;
  plan?: {
    name?: string | null;
    visits_count?: number | null;
  } | null;
};

export type CoachPayrollStat = {
  id: string;
  name: string;
  sessionCount: number;
  totalVisits: number;
  crmVisits: number;
  onefitVisits: number;
  trialStars: number;
  purchasesAfterTrial: number;
  averageVisits: number;
  conversionRate: number;
  rate: number;
  onefitRate: number;
  payment: number;
};

export type PayrollAnalytics = {
  rows: CoachPayrollStat[];
  totals: CoachPayrollStat;
  activeCoachCount: number;
  averageSessionsPerCoach: number;
  averageCrmPerSession: number;
  averageOnefitPerSession: number;
};

const cancelledStatuses = new Set(["cancelled", "late_cancel"]);
const isTrialPlan = (name?: string | null) => name?.toLocaleLowerCase("ru-RU").includes("пробн") ?? false;

const trainerName = (coach: PayrollCoach) => {
  const firstName = coach.profile?.first_name?.trim();
  const lastName = coach.profile?.last_name?.trim();
  if (firstName || lastName) return [firstName, lastName].filter(Boolean).join(" ");
  return coach.name.trim() || "Без имени";
};

const percent = (part: number, total: number) => total > 0 ? Math.round((part / total) * 100) : 0;
const average = (part: number, total: number) => total > 0 ? Number((part / total).toFixed(1)) : 0;

export const buildPayrollAnalytics = ({
  coaches,
  sessions,
  bookingHistory,
  subscriptions,
  now,
}: {
  coaches: PayrollCoach[];
  sessions: PayrollSession[];
  bookingHistory: PayrollBooking[];
  subscriptions: PayrollSubscription[];
  now: Date;
}): PayrollAnalytics => {
  const firstBookingIdByClient = new Map<string, string>();
  [...bookingHistory]
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
    .forEach((booking) => {
      if (booking.user_id && !firstBookingIdByClient.has(booking.user_id)) {
        firstBookingIdByClient.set(booking.user_id, booking.id);
      }
    });

  const validSubscriptionsByClient = new Map<string, PayrollSubscription[]>();
  subscriptions.forEach((subscription) => {
    const visitCount = Number(subscription.plan?.visits_count ?? subscription.visits_total ?? 0);
    if (visitCount <= 2 || isTrialPlan(subscription.plan?.name) || subscription.net_paid <= 0) return;
    const current = validSubscriptionsByClient.get(subscription.user_id) || [];
    current.push(subscription);
    validSubscriptionsByClient.set(subscription.user_id, current);
  });

  const conductedSessions = sessions.filter((session) =>
    session.coach_id
    && session.session_kind !== "rental"
    && session.booking_status !== "cancelled"
    && !session.is_cancelled
    && new Date(session.end_time) <= now,
  );

  const rows = coaches.map<CoachPayrollStat>((coach) => {
    const coachSessions = conductedSessions.filter((session) => session.coach_id === coach.id);
    const coachSessionIds = new Set(coachSessions.map((session) => session.id));
    const crmVisits = coachSessions.reduce(
      (sum, session) => sum + (session.bookings || []).filter((booking) => booking.status === "completed" || booking.status === "attended").length,
      0,
    );
    const onefitVisits = coachSessions.reduce(
      (sum, session) => sum + (session.onefit_bookings || []).filter((booking) => booking.is_active && booking.source_status === "confirmed").length,
      0,
    );

    const firstBookings = bookingHistory.filter((booking) =>
      booking.user_id
      && coachSessionIds.has(booking.session_id)
      && firstBookingIdByClient.get(booking.user_id) === booking.id
      && !cancelledStatuses.has(booking.status),
    );
    const starClients = new Map<string, Date>();
    firstBookings.forEach((booking) => {
      const session = coachSessions.find((item) => item.id === booking.session_id);
      if (booking.user_id && session && !starClients.has(booking.user_id)) {
        starClients.set(booking.user_id, new Date(session.end_time));
      }
    });

    const purchasedClients = [...starClients].filter(([clientId, sessionEndedAt]) =>
      (validSubscriptionsByClient.get(clientId) || []).some((subscription) => {
        const paidAt = subscription.first_payment_at
          ? new Date(subscription.first_payment_at)
          : subscription.created_at
            ? new Date(subscription.created_at)
            : subscription.start_date
              ? new Date(`${subscription.start_date}T23:59:59+05:00`)
              : null;
        return paidAt !== null && paidAt >= sessionEndedAt;
      }),
    ).length;

    const rate = Number(coach.rate_per_client || 0);
    const onefitRate = Number(coach.aggregator_rate_per_client ?? rate);
    const totalVisits = crmVisits + onefitVisits;
    return {
      id: coach.id,
      name: trainerName(coach),
      sessionCount: coachSessions.length,
      totalVisits,
      crmVisits,
      onefitVisits,
      trialStars: starClients.size,
      purchasesAfterTrial: purchasedClients,
      averageVisits: average(totalVisits, coachSessions.length),
      conversionRate: percent(purchasedClients, starClients.size),
      rate,
      onefitRate,
      payment: crmVisits * rate + onefitVisits * onefitRate,
    };
  }).sort((left, right) =>
    right.totalVisits - left.totalVisits
    || right.sessionCount - left.sessionCount
    || left.name.localeCompare(right.name, "ru"),
  );

  const totals = rows.reduce<CoachPayrollStat>((total, row) => ({
    ...total,
    sessionCount: total.sessionCount + row.sessionCount,
    totalVisits: total.totalVisits + row.totalVisits,
    crmVisits: total.crmVisits + row.crmVisits,
    onefitVisits: total.onefitVisits + row.onefitVisits,
    trialStars: total.trialStars + row.trialStars,
    purchasesAfterTrial: total.purchasesAfterTrial + row.purchasesAfterTrial,
    payment: total.payment + row.payment,
  }), {
    id: "total",
    name: "Итого",
    sessionCount: 0,
    totalVisits: 0,
    crmVisits: 0,
    onefitVisits: 0,
    trialStars: 0,
    purchasesAfterTrial: 0,
    averageVisits: 0,
    conversionRate: 0,
    rate: 0,
    onefitRate: 0,
    payment: 0,
  });
  totals.averageVisits = average(totals.totalVisits, totals.sessionCount);
  totals.conversionRate = percent(totals.purchasesAfterTrial, totals.trialStars);

  const activeCoachCount = rows.filter((row) => row.sessionCount > 0).length;
  return {
    rows,
    totals,
    activeCoachCount,
    averageSessionsPerCoach: average(totals.sessionCount, activeCoachCount),
    averageCrmPerSession: average(totals.crmVisits, totals.sessionCount),
    averageOnefitPerSession: average(totals.onefitVisits, totals.sessionCount),
  };
};
