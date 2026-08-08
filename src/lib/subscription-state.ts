export type SubscriptionStateInput = {
  activation_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
  visits_remaining?: number | null;
  visits_total?: number | null;
};

export type SubscriptionState = "purchased" | "active" | "used" | "expired" | "disabled";

export const getSubscriptionState = (
  subscription: SubscriptionStateInput,
  today = new Date().toISOString().slice(0, 10),
): SubscriptionState => {
  if (subscription.visits_total !== null && subscription.visits_total !== undefined
    && Number(subscription.visits_remaining) <= 0) return "used";
  // The stored end date is inclusive: the subscription is valid through that day.
  if (subscription.end_date && subscription.end_date < today) return "expired";
  if (subscription.is_active === false) return "disabled";
  if (!subscription.activation_date) return "purchased";
  return "active";
};

export const subscriptionStateLabel: Record<SubscriptionState, string> = {
  purchased: "Куплен · не активирован",
  active: "Активен",
  used: "Неактивен · занятия закончились",
  expired: "Неактивен · срок истёк",
  disabled: "Неактивен",
};
