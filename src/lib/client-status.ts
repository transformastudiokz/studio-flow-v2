import { format } from "date-fns";
import { supabase } from "@/lib/supabase";

export type MembershipIndicator = "active" | "ending" | "inactive";

export type ClientStatus = {
  isFirstVisit: boolean;
  membership: MembershipIndicator;
  remainingVisits: number | null;
  firstBookingId: string | null;
  hasCurrentTrial: boolean;
};

export type SubscriptionSummary = {
  user_id: string;
  visits_remaining: number;
  end_date: string | null;
  is_active: boolean;
  plan: { name?: string | null } | null;
};

const isTrialPlan = (name?: string | null) =>
  Boolean(name?.trim().toLocaleLowerCase("ru-RU").includes("пробн"));

const isCurrentlyActive = (subscription: SubscriptionSummary, today: string) =>
  subscription.is_active &&
  subscription.visits_remaining > 0 &&
  (!subscription.end_date || subscription.end_date >= today);

const isWithinValidityPeriod = (subscription: SubscriptionSummary, today: string) =>
  subscription.is_active && (!subscription.end_date || subscription.end_date >= today);

export const getClientStatus = (
  subscriptions: SubscriptionSummary[],
): ClientStatus => {
  const today = format(new Date(), "yyyy-MM-dd");
  const activeSubscriptions = subscriptions.filter((subscription) =>
    isCurrentlyActive(subscription, today),
  );
  const hasCurrentTrial = subscriptions.some(
    (subscription) =>
      isWithinValidityPeriod(subscription, today) && isTrialPlan(subscription.plan?.name),
  );

  if (activeSubscriptions.length === 0) {
    return {
      isFirstVisit: false,
      membership: "inactive",
      remainingVisits: 0,
      firstBookingId: null,
      hasCurrentTrial,
    };
  }

  const regularSubscriptions = activeSubscriptions.filter(
    (subscription) => !isTrialPlan(subscription.plan?.name),
  );
  const healthyRegularSubscription = regularSubscriptions.some(
    (subscription) => subscription.visits_remaining > 2,
  );
  const endingRegularSubscription = regularSubscriptions.some(
    (subscription) => subscription.visits_remaining <= 2,
  );
  const remainingVisits = Math.max(
    ...activeSubscriptions.map((subscription) => subscription.visits_remaining),
  );

  return {
    isFirstVisit: false,
    membership:
      endingRegularSubscription && !healthyRegularSubscription ? "ending" : "active",
    remainingVisits,
    firstBookingId: null,
    hasCurrentTrial,
  };
};

export const getClientStatusForBooking = (
  status: ClientStatus | undefined,
  bookingId: string,
) => {
  if (!status) return undefined;

  const isFirstVisit = status.firstBookingId === bookingId;
  return {
    ...status,
    isFirstVisit,
    membership: isFirstVisit && status.hasCurrentTrial ? ("active" as const) : status.membership,
  };
};

export const fetchClientStatuses = async (userIds: string[]) => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const statusMap = new Map<string, ClientStatus>();

  if (uniqueUserIds.length === 0) return statusMap;

  const [subscriptionsResult, bookingsResult] = await Promise.all([
    supabase
      .from("user_subscriptions")
      .select(
        "user_id, visits_remaining, end_date, is_active, plan:subscription_plans(name)",
      )
      .in("user_id", uniqueUserIds),
    supabase
      .from("bookings")
      .select("id, user_id, created_at")
      .in("user_id", uniqueUserIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (subscriptionsResult.error) throw subscriptionsResult.error;
  if (bookingsResult.error) throw bookingsResult.error;

  const subscriptionsByUser = new Map<string, SubscriptionSummary[]>();
  for (const subscription of subscriptionsResult.data || []) {
    const current = subscriptionsByUser.get(subscription.user_id) || [];
    current.push(subscription as unknown as SubscriptionSummary);
    subscriptionsByUser.set(subscription.user_id, current);
  }

  const firstBookingByUser = new Map<string, string>();
  for (const booking of bookingsResult.data || []) {
    if (!firstBookingByUser.has(booking.user_id)) {
      firstBookingByUser.set(booking.user_id, booking.id);
    }
  }

  for (const userId of uniqueUserIds) {
    const status = getClientStatus(subscriptionsByUser.get(userId) || []);
    statusMap.set(
      userId,
      {
        ...status,
        firstBookingId: firstBookingByUser.get(userId) || null,
      },
    );
  }

  return statusMap;
};
