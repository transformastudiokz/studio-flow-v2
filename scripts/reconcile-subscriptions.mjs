import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const clientArg = process.argv.find((arg) => arg.startsWith("--client-id="));
const clientId = clientArg?.split("=")[1] || null;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const almatyDate = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

async function allRows(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const subscriptions = await allRows(() => {
  let query = db.from("user_subscriptions")
    .select("id,user_id,created_at,start_date,activation_date,end_date,visits_total,visits_remaining,is_active,plan:subscription_plans(name,duration_days)")
    .order("created_at", { ascending: true });
  if (clientId) query = query.eq("user_id", clientId);
  return query;
});

const userIds = [...new Set(subscriptions.map((row) => row.user_id))];
const bookings = [];
for (let index = 0; index < userIds.length; index += 100) {
  const ids = userIds.slice(index, index + 100);
  bookings.push(...await allRows(() => db.from("bookings")
    .select("id,user_id,status,subscription_id,session:schedule_sessions(start_time)")
    .in("user_id", ids)
    .in("status", ["completed", "absent", "late_cancel"])));
}

const subscriptionsByUser = new Map();
for (const subscription of subscriptions) {
  const rows = subscriptionsByUser.get(subscription.user_id) || [];
  rows.push(subscription);
  subscriptionsByUser.set(subscription.user_id, rows);
}

const assignedBookings = new Map();
const bookingUpdates = [];
const ambiguous = [];
for (const booking of bookings) {
  const session = Array.isArray(booking.session) ? booking.session[0] : booking.session;
  if (!session?.start_time) continue;
  const visitDate = almatyDate(session.start_time);
  let subscriptionId = booking.subscription_id;
  if (!subscriptionId) {
    const candidates = (subscriptionsByUser.get(booking.user_id) || []).filter((subscription) =>
      (!subscription.start_date || subscription.start_date <= visitDate)
      && (!subscription.activation_date || subscription.activation_date <= visitDate)
      && (!subscription.end_date || subscription.end_date >= visitDate));
    const activatedCandidates = candidates.filter((subscription) => subscription.activation_date);
    const preferredCandidates = activatedCandidates.length ? activatedCandidates : candidates;
    if (preferredCandidates.length === 1) {
      subscriptionId = preferredCandidates[0].id;
      bookingUpdates.push({ id: booking.id, subscription_id: subscriptionId, visitDate });
    } else if (preferredCandidates.length > 1) {
      ambiguous.push({ bookingId: booking.id, userId: booking.user_id, visitDate, candidates: preferredCandidates.map((row) => row.id) });
    }
  }
  if (!subscriptionId) continue;
  const rows = assignedBookings.get(subscriptionId) || [];
  rows.push({ id: booking.id, visitDate });
  assignedBookings.set(subscriptionId, rows);
}

const subscriptionUpdates = [];
for (const subscription of subscriptions) {
  const linked = (assignedBookings.get(subscription.id) || []).sort((a, b) => a.visitDate.localeCompare(b.visitDate));
  const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
  const activationDate = subscription.activation_date || linked[0]?.visitDate || null;
  const endDate = subscription.end_date || (activationDate && Number(plan?.duration_days) > 0
    ? addDays(activationDate, Number(plan.duration_days) - 1) : null);
  const remaining = subscription.visits_total == null
    ? subscription.visits_remaining
    : Math.max(0, Number(subscription.visits_total) - linked.length);
  const active = subscription.is_active !== false
    && (remaining == null || remaining > 0)
    && (!endDate || endDate >= today);
  if (remaining !== subscription.visits_remaining
    || activationDate !== subscription.activation_date
    || endDate !== subscription.end_date
    || active !== subscription.is_active) {
    subscriptionUpdates.push({
      id: subscription.id,
      before: { visits_remaining: subscription.visits_remaining, activation_date: subscription.activation_date, end_date: subscription.end_date, is_active: subscription.is_active },
      after: { visits_remaining: remaining, activation_date: activationDate, end_date: endDate, is_active: active },
      completedVisits: linked.length,
      plan: plan?.name || "Абонемент",
    });
  }
}

const report = {
  mode: apply ? "apply" : "dry-run",
  clients: userIds.length,
  subscriptions: subscriptions.length,
  completedBookings: bookings.length,
  bookingLinksToAdd: bookingUpdates.length,
  subscriptionUpdates: subscriptionUpdates.length,
  ambiguousBookings: ambiguous.length,
  ambiguous: ambiguous.slice(0, 20),
  changes: subscriptionUpdates,
};

if (apply) {
  const linked = [];
  const changed = [];
  try {
    for (const row of bookingUpdates) {
      const { error } = await db.from("bookings").update({ subscription_id: row.subscription_id }).eq("id", row.id).is("subscription_id", null);
      if (error) throw error;
      linked.push(row);
    }
    for (const row of subscriptionUpdates) {
      const { error } = await db.from("user_subscriptions").update(row.after).eq("id", row.id);
      if (error) throw error;
      changed.push(row);
    }
  } catch (error) {
    for (const row of changed.reverse()) await db.from("user_subscriptions").update(row.before).eq("id", row.id);
    for (const row of linked.reverse()) await db.from("bookings").update({ subscription_id: null }).eq("id", row.id).eq("subscription_id", row.subscription_id);
    throw error;
  }
}

console.log(JSON.stringify(report, null, 2));
