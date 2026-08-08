import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { ensureClientAccount, normalizeClientPhone } from "./_lib/client-account.js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret
  ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const normalizePhone = (value: string) => {
  return normalizeClientPhone(value);
};

async function requireStaff(req: VercelRequest) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await adminClient.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .single();
  return profile?.is_active !== false && ["owner", "admin"].includes(profile?.role || "") ? user : null;
}

async function requireUser(req: VercelRequest) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await adminClient.auth.getUser(token);
  return user || null;
}

const almatyDate = (value: string | Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

const addCalendarDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

async function setBookingAttendanceStatus(bookingId: string, nextStatus: string) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const { data: booking, error: bookingError } = await adminClient
    .from("bookings")
    .select("id,user_id,subscription_id,status,session:schedule_sessions(start_time)")
    .eq("id", bookingId).single();
  if (bookingError || !booking) throw bookingError || new Error("Запись не найдена");
  if (booking.status === nextStatus) return { bookingId, subscriptionId: booking.subscription_id };
  const session = Array.isArray(booking.session) ? booking.session[0] : booking.session;
  if (!session?.start_time) throw new Error("У занятия не указана дата");
  const visitDate = almatyDate(session.start_time);
  const chargedStatuses = new Set(["completed", "absent", "late_cancel"]);
  const wasCharged = chargedStatuses.has(booking.status);
  const willCharge = chargedStatuses.has(nextStatus);

  if (wasCharged === willCharge) {
    const { error } = await adminClient.from("bookings").update({ status: nextStatus }).eq("id", bookingId);
    if (error) throw error;
    return { bookingId, subscriptionId: booking.subscription_id };
  }

  if (willCharge) {
    let subscription: any = null;
    if (booking.subscription_id) {
      const { data, error } = await adminClient.from("user_subscriptions")
        .select("id,user_id,visits_total,visits_remaining,start_date,end_date,activation_date,is_active,created_at,plan:subscription_plans(duration_days)")
        .eq("id", booking.subscription_id).single();
      if (error) throw error;
      subscription = data;
    } else {
      const { data, error } = await adminClient.from("user_subscriptions")
        .select("id,user_id,visits_total,visits_remaining,start_date,end_date,activation_date,is_active,created_at,plan:subscription_plans(duration_days)")
        .eq("user_id", booking.user_id).eq("is_active", true).gt("visits_remaining", 0)
        .lte("start_date", visitDate).or(`end_date.is.null,end_date.gte.${visitDate}`)
        .order("created_at", { ascending: true }).limit(20);
      if (error) throw error;
      // Самый ранний купленный абонемент расходуется первым: пробный не должен
      // быть пропущен в пользу более нового основного абонемента.
      subscription = (data || []).sort((a: any, b: any) =>
        String(a.created_at).localeCompare(String(b.created_at)))[0];
    }
    const subscriptionIsEligible = subscription
      && subscription.user_id === booking.user_id
      && subscription.is_active !== false
      && Number(subscription.visits_remaining) > 0
      && (!subscription.start_date || subscription.start_date <= visitDate)
      && (!subscription.end_date || subscription.end_date >= visitDate);
    if (!subscriptionIsEligible) {
      throw new Error("У клиента нет подходящего действующего абонемента. Сначала оформи абонемент, затем отметь посещение.");
    }
    const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
    const activationDate = subscription.activation_date || visitDate;
    const endDate = subscription.end_date || (Number(plan?.duration_days) > 0
      ? addCalendarDays(activationDate, Number(plan.duration_days) - 1) : null);
    const nextRemaining = Math.max(0, Number(subscription.visits_remaining) - 1);
    const { data: updatedSubscription, error: subscriptionError } = await adminClient
      .from("user_subscriptions")
      .update({ visits_remaining: nextRemaining, activation_date: activationDate, end_date: endDate, is_active: nextRemaining > 0 })
      .eq("id", subscription.id).eq("visits_remaining", subscription.visits_remaining)
      .select("id").maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!updatedSubscription) throw new Error("Абонемент уже изменился. Обнови окно и повтори действие.");
    const { data: updatedBooking, error: statusError } = await adminClient.from("bookings")
      .update({ status: nextStatus, subscription_id: subscription.id })
      .eq("id", bookingId).eq("status", booking.status).select("id").maybeSingle();
    if (statusError || !updatedBooking) {
      await adminClient.from("user_subscriptions").update({
        visits_remaining: subscription.visits_remaining,
        activation_date: subscription.activation_date,
        end_date: subscription.end_date,
        is_active: subscription.is_active,
      }).eq("id", subscription.id).eq("visits_remaining", nextRemaining);
      throw statusError || new Error("Статус записи уже изменился. Обнови окно.");
    }
    return { bookingId, subscriptionId: subscription.id };
  }

  if (wasCharged && booking.subscription_id) {
    const { data: subscription, error } = await adminClient.from("user_subscriptions")
      .select("id,visits_total,visits_remaining,end_date").eq("id", booking.subscription_id).single();
    if (error) throw error;
    const restored = subscription.visits_total == null
      ? Number(subscription.visits_remaining) + 1
      : Math.min(Number(subscription.visits_total), Number(subscription.visits_remaining) + 1);
    const { error: restoreError } = await adminClient.from("user_subscriptions")
      .update({ visits_remaining: restored, is_active: !subscription.end_date || subscription.end_date >= visitDate }).eq("id", subscription.id)
      .eq("visits_remaining", subscription.visits_remaining);
    if (restoreError) throw restoreError;
  }
  const { error } = await adminClient.from("bookings").update({ status: nextStatus }).eq("id", bookingId);
  if (error) throw error;
  return { bookingId, subscriptionId: booking.subscription_id };
}

async function cancelOwnBooking(userId: string, bookingId: string) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const { data: booking, error } = await adminClient.from("bookings")
    .select("id,user_id,status,session:schedule_sessions(start_time)")
    .eq("id", bookingId).single();
  if (error || !booking) throw error || new Error("Запись не найдена");
  if (booking.user_id !== userId) throw new Error("Нельзя отменить чужую запись");
  if (booking.status !== "booked") throw new Error("Эта запись уже обработана");
  const session = Array.isArray(booking.session) ? booking.session[0] : booking.session;
  if (!session?.start_time) throw new Error("У занятия не указано время");

  const { data: setting } = await adminClient.from("studio_info").select("value").eq("key", "cancellation_minutes").maybeSingle();
  const limitMinutes = Math.max(120, Number(setting?.value || 120));
  const minutesLeft = Math.floor((new Date(session.start_time).getTime() - Date.now()) / 60000);
  if (minutesLeft < limitMinutes) {
    const hours = Math.ceil(limitMinutes / 60);
    throw new Error(`Самостоятельная отмена закрывается за ${hours} часа до занятия. Свяжись с администратором.`);
  }
  const { error: updateError } = await adminClient.from("bookings").update({ status: "cancelled" }).eq("id", bookingId).eq("status", "booked");
  if (updateError) throw updateError;
  return { bookingId, status: "cancelled" };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const action = req.body?.action;
    if (action === "cancel-own-booking") {
      const user = await requireUser(req);
      if (!user) return res.status(401).json({ error: "Нужна авторизация клиента" });
      const bookingId = String(req.body?.bookingId || "");
      if (!bookingId) return res.status(400).json({ error: "Запись не указана" });
      return res.status(200).json(await cancelOwnBooking(user.id, bookingId));
    }
    const staff = await requireStaff(req);
    if (!staff) return res.status(403).json({ error: "Доступ только сотрудникам студии" });

    if (action === "set-booking-status") {
      const bookingId = String(req.body?.bookingId || "");
      const status = String(req.body?.status || "");
      const allowed = ["booked", "completed", "absent", "cancelled", "late_cancel", "transferred"];
      if (!bookingId || !allowed.includes(status)) return res.status(400).json({ error: "Некорректный статус записи" });
      return res.status(200).json(await setBookingAttendanceStatus(bookingId, status));
    }
    if (action === "request-onefit-sync") {
      const sourceDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Almaty",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const { error } = await adminClient!.from("onefit_sync_runs").insert({
        trigger_type: "manual",
        status: "queued",
        source_date: sourceDate,
      });
      if (error) throw error;
      return res.status(202).json({ queued: true });
    }

    if (action === "search-clients") {
      const rawQuery = String(req.body?.query || "").trim();
      const safeQuery = rawQuery.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
      const { data, error } = await adminClient!
        .from("profiles")
        .select("id,first_name,last_name,phone,email")
        .eq("role", "client")
        .order("first_name")
        .limit(5000);
      if (error) throw error;
      const normalizedQuery = safeQuery.toLocaleLowerCase("ru-RU");
      const queryDigits = normalizePhone(safeQuery);
      const clients = (data || []).filter((client) => {
        if (!normalizedQuery) return true;
        const fullName = `${client.first_name || ""} ${client.last_name || ""}`.toLocaleLowerCase("ru-RU");
        return fullName.includes(normalizedQuery) || (queryDigits.length >= 3 && normalizePhone(client.phone || "").includes(queryDigits));
      }).slice(0, 30);
      return res.status(200).json({ clients });
    }

    if (action === "create-client-and-book") {
      const sessionId = String(req.body?.sessionId || "");
      const firstName = String(req.body?.firstName || "").trim();
      const lastName = String(req.body?.lastName || "").trim();
      const phone = normalizePhone(String(req.body?.phone || ""));
      const contactEmail = String(req.body?.email || "").trim().toLowerCase();
      if (!sessionId || !firstName || phone.length < 10) {
        return res.status(400).json({ error: "Укажи имя и корректный телефон" });
      }
      const account = await ensureClientAccount(adminClient!, {
        firstName,
        lastName,
        phone,
        contactEmail,
      });
      const { data: existingBooking, error: existingBookingError } = await adminClient!
        .from("bookings")
        .select("id,status")
        .eq("session_id", sessionId)
        .eq("user_id", account.id)
        .maybeSingle();
      if (existingBookingError) throw existingBookingError;
      if (existingBooking) {
        if (!["cancelled", "late_cancel", "absent"].includes(existingBooking.status)) {
          return res.status(409).json({ error: "Клиент уже записан на это занятие" });
        }
        const { error: restoreError } = await adminClient!.from("bookings")
          .update({ status: "booked" })
          .eq("id", existingBooking.id);
        if (restoreError) throw restoreError;
      } else {
        const { error: bookingError } = await adminClient!.from("bookings").insert({
          session_id: sessionId,
          user_id: account.id,
          status: "booked",
        });
        if (bookingError) throw bookingError;
      }

      return res.status(account.created ? 201 : 200).json(account);
    }

    if (action === "transfer-booking") {
      const bookingId = String(req.body?.bookingId || "");
      const targetSessionId = String(req.body?.targetSessionId || "");
      if (!bookingId || !targetSessionId) return res.status(400).json({ error: "Не выбрана запись или новое занятие" });

      const { data: source, error: sourceError } = await adminClient!
        .from("bookings")
        .select("id,user_id,session_id,status")
        .eq("id", bookingId)
        .single();
      if (sourceError || !source) throw sourceError || new Error("Исходная запись не найдена");
      if (source.session_id === targetSessionId) return res.status(400).json({ error: "Выбрано то же занятие" });
      if (source.status !== "booked") return res.status(409).json({ error: "Перенести можно только действующую запись" });

      const { data: target, error: targetError } = await adminClient!
        .from("schedule_sessions")
        .select("id,capacity,booking_status,is_cancelled,bookings:bookings(id,status),onefit_bookings:onefit_bookings(id,is_active)")
        .eq("id", targetSessionId)
        .single();
      if (targetError || !target) throw targetError || new Error("Новое занятие не найдено");
      if (target.booking_status !== "open" || target.is_cancelled) return res.status(409).json({ error: "Запись на выбранное занятие закрыта" });
      const occupied = (target.bookings || []).filter((booking: { status: string }) => !["cancelled", "late_cancel", "absent"].includes(booking.status)).length
        + (target.onefit_bookings || []).filter((booking: { is_active: boolean }) => booking.is_active).length;
      if (occupied >= target.capacity) return res.status(409).json({ error: "На выбранном занятии уже нет свободных мест" });

      const { data: duplicates, error: duplicateError } = await adminClient!
        .from("bookings")
        .select("id,status")
        .eq("user_id", source.user_id)
        .eq("session_id", targetSessionId)
        .not("status", "in", "(cancelled,late_cancel,absent)")
        .limit(1);
      if (duplicateError) throw duplicateError;
      if (duplicates?.length) return res.status(409).json({ error: "Клиент уже записан на выбранное занятие" });

      const { error: cancelError } = await adminClient!.from("bookings").update({ status: "cancelled" }).eq("id", source.id);
      if (cancelError) throw cancelError;
      const { data: createdBooking, error: insertError } = await adminClient!
        .from("bookings")
        .insert({ session_id: targetSessionId, user_id: source.user_id, status: "booked" })
        .select("id")
        .single();
      if (insertError || !createdBooking) {
        await adminClient!.from("bookings").update({ status: source.status }).eq("id", source.id);
        throw insertError || new Error("Не удалось создать новую запись");
      }

      const transferData = {
        event_type: "rescheduled",
        from_booking_id: source.id,
        to_booking_id: createdBooking.id,
        from_session_id: source.session_id,
        to_session_id: targetSessionId,
      };
      const { error: logError } = await adminClient!.from("booking_change_log").insert({
        booking_id: source.id,
        session_id: source.session_id,
        user_id: source.user_id,
        action: "updated",
        changed_by: staff.id,
        new_data: transferData,
      });
      if (logError) console.error("Transfer history log failed", logError);
      return res.status(200).json({ bookingId: createdBooking.id });
    }

    return res.status(400).json({ error: "Неизвестное действие" });
  } catch (error) {
    console.error("Schedule API error", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Ошибка сервера" });
  }
}
