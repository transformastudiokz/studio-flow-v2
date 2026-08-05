import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret
  ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const staff = await requireStaff(req);
    if (!staff) return res.status(403).json({ error: "Доступ только сотрудникам студии" });

    const action = req.body?.action;
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
      const authEmail = `${phone}@balance.kz`;
      if (!sessionId || !firstName || phone.length < 10) {
        return res.status(400).json({ error: "Укажи имя и корректный телефон" });
      }

      const { data: existingProfiles, error: profilesError } = await adminClient!
        .from("profiles")
        .select("id,first_name,last_name,phone")
        .eq("role", "client")
        .limit(5000);
      if (profilesError) throw profilesError;
      const duplicate = (existingProfiles || []).find((profile) => normalizePhone(profile.phone || "") === phone);
      if (duplicate) return res.status(409).json({ error: "Клиент с этим телефоном уже существует" });

      const password = `yoga${phone.slice(-4)}`;
      const { data: created, error: createError } = await adminClient!.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName, phone },
      });
      if (createError) throw createError;

      try {
        const { error: profileError } = await adminClient!.from("profiles").upsert({
          id: created.user.id,
          first_name: firstName,
          last_name: lastName || null,
          phone,
          email: contactEmail || authEmail,
          role: "client",
        });
        if (profileError) throw profileError;

        const { error: bookingError } = await adminClient!.from("bookings").insert({
          session_id: sessionId,
          user_id: created.user.id,
          status: "booked",
        });
        if (bookingError) throw bookingError;
      } catch (error) {
        const cleanup = await adminClient!.auth.admin.deleteUser(created.user.id);
        if (cleanup.error) console.error("Schedule API cleanup failed", cleanup.error);
        throw error;
      }

      return res.status(200).json({ id: created.user.id, login: phone, temporaryPassword: password });
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
