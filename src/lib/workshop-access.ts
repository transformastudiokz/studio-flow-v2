export const WORKSHOP_NAME_PATTERN = /мастер[\s-]*класс/i;

export type WorkshopAccessType =
  | "standard"
  | "workshop_member_free"
  | "workshop_paid"
  | "workshop_complimentary";

export type WorkshopSubscription = {
  id: string;
  visits_remaining: number | null;
  is_active: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  plan?: {
    plan_format?: string | null;
    product_kind?: string | null;
  } | null;
};

export const isWorkshopSession = (session: {
  session_kind?: string | null;
  class_type?: { name?: string | null } | null;
}) => session.session_kind === "workshop"
  || WORKSHOP_NAME_PATTERN.test(session.class_type?.name || "");

export const subscriptionIsValidOn = (subscription: WorkshopSubscription, date: string) =>
  subscription.is_active !== false
  && Number(subscription.visits_remaining) > 0
  && (!subscription.start_date || subscription.start_date <= date)
  && (!subscription.end_date || subscription.end_date >= date);

export const isFreeWorkshopMembership = (subscription: WorkshopSubscription) =>
  (subscription.plan?.product_kind || "fitness") === "fitness"
  && ["group", "individual", "split"].includes(subscription.plan?.plan_format || "group");

export const isPaidWorkshopPass = (subscription: WorkshopSubscription) =>
  subscription.plan?.product_kind === "workshop";

export const workshopAccessLabel = (accessType?: string | null) => {
  if (accessType === "workshop_member_free") return "Бесплатно";
  if (accessType === "workshop_paid") return "Оплачено · 6 000 ₸";
  if (accessType === "workshop_complimentary") return "Комплимент студии";
  return null;
};
