import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret ? createClient(url, secret, { auth: { persistSession: false } }) : null;

const temporaryPassword = (phone: string) => phone.replace(/\D/g, "").slice(-6);
const normalizeEmail = (email: unknown) => String(email || "").trim().toLowerCase();
const normalizePhone = (phone: unknown) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("8") && digits.length === 11 ? `7${digits.slice(1)}` : digits;
};

const publicStaffError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/already.*registered|already.*exists|duplicate|unique/i.test(message)) return "Сотрудник с таким email или телефоном уже существует";
  if (/invalid.*email|email.*invalid/i.test(message)) return "Email указан некорректно";
  return message || "Ошибка сервера";
};

async function requireOwner(req: VercelRequest) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await adminClient.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient.from("profiles").select("role,is_active").eq("id", user.id).single();
  return profile?.role === "owner" && profile?.is_active !== false ? user : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const owner = await requireOwner(req);
    if (!owner) return res.status(403).json({ error: "Доступ только управляющему" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const action = req.body?.action;

    if (action === "create") {
      const { email, phone, firstName, lastName, middleName, role, position, coachId } = req.body;
      const normalizedEmail = normalizeEmail(email);
      const normalizedPhone = normalizePhone(phone);
      if (!String(firstName || "").trim() || !String(lastName || "").trim()) return res.status(400).json({ error: "Укажи имя и фамилию" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: "Укажи корректный email" });
      if (normalizedPhone.length !== 11 || !normalizedPhone.startsWith("7")) return res.status(400).json({ error: "Укажи корректный телефон из 11 цифр" });
      if (!["owner", "admin", "trainer"].includes(role)) return res.status(400).json({ error: "Выбери роль сотрудника" });

      const { data: staffProfiles, error: profilesLookupError } = await adminClient!.from("profiles").select("id,email,phone").in("role", ["owner", "admin", "trainer"]);
      if (profilesLookupError) throw profilesLookupError;
      const duplicate = (staffProfiles || []).find(profile => normalizeEmail(profile.email) === normalizedEmail || normalizePhone(profile.phone) === normalizedPhone);
      if (duplicate) return res.status(409).json({ error: "Сотрудник с таким email или телефоном уже существует" });

      const password = temporaryPassword(normalizedPhone);
      const { data: created, error: createError } = await adminClient!.auth.admin.createUser({ email: normalizedEmail, password, email_confirm: true, user_metadata: { first_name: String(firstName).trim(), last_name: String(lastName).trim(), middle_name: String(middleName || "").trim() || null, phone: normalizedPhone } });
      if (createError) throw createError;
      try {
        const { error: profileError } = await adminClient!.from("profiles").upsert({ id: created.user.id, email: normalizedEmail, phone: normalizedPhone, first_name: String(firstName).trim(), last_name: String(lastName).trim(), middle_name: String(middleName || "").trim() || null, role, position: String(position || "").trim() || (role === "trainer" ? "Тренер" : role === "owner" ? "Управляющий" : "Администратор"), is_active: true, must_change_password: true });
        if (profileError) throw profileError;
        const coachName = `${String(lastName).trim()} ${String(firstName).trim()} ${String(middleName || "").trim()}`.trim();
        if (coachId) {
          const { error: coachError } = await adminClient!.from("coaches").update({ user_id: created.user.id, name: coachName, phone: normalizedPhone }).eq("id", coachId);
          if (coachError) throw coachError;
        } else if (role === "trainer") {
          const { error: coachError } = await adminClient!.from("coaches").insert({ name: coachName, phone: normalizedPhone, is_active: true, user_id: created.user.id });
          if (coachError) throw coachError;
        }
        return res.status(200).json({ id: created.user.id });
      } catch (error) {
        await adminClient!.from("profiles").delete().eq("id", created.user.id);
        await adminClient!.auth.admin.deleteUser(created.user.id);
        throw error;
      }
    }

    if (action === "update") {
      const { userId, email, phone, firstName, lastName, middleName, role, position } = req.body;
      if (!userId || !email || !phone || !firstName || !lastName || !["owner", "admin", "trainer"].includes(role)) return res.status(400).json({ error: "Имя и фамилия обязательны" });
      if (userId === owner.id && role !== "owner") return res.status(400).json({ error: "Нельзя снять роль управляющего у собственной учётной записи" });
      const normalizedEmail = String(email).trim().toLowerCase();
      const { error: authError } = await adminClient!.auth.admin.updateUserById(userId, { email: normalizedEmail, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName, middle_name: middleName || null, phone } });
      if (authError) throw authError;
      const { error } = await adminClient!.from("profiles").update({ email: normalizedEmail, phone, first_name: firstName, last_name: lastName, middle_name: middleName || null, role, position: position || (role === "trainer" ? "Тренер" : role === "owner" ? "Управляющий" : "Администратор") }).eq("id", userId);
      if (error) throw error;
      const { data: coach } = await adminClient!.from("coaches").select("id").eq("user_id", userId).maybeSingle();
      const coachName = `${lastName} ${firstName} ${middleName || ""}`.trim();
      if (role === "trainer" && !coach) await adminClient!.from("coaches").insert({ name: coachName, phone, is_active: true, user_id: userId });
      else if (role === "trainer" && coach) await adminClient!.from("coaches").update({ name: coachName, phone, is_active: true }).eq("id", coach.id);
      return res.status(200).json({ ok: true });
    }

    if (action === "reset-password") {
      const { userId } = req.body;
      const { data: profile } = await adminClient!.from("profiles").select("phone").eq("id", userId).single();
      const password = temporaryPassword(profile?.phone || "");
      if (password.length !== 6) return res.status(400).json({ error: "У сотрудника некорректный телефон" });
      const { error } = await adminClient!.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      await adminClient!.from("profiles").update({ must_change_password: true }).eq("id", userId);
      return res.status(200).json({ ok: true });
    }

    if (action === "prepare-access") {
      const { userId } = req.body;
      const { data: profile } = await adminClient!.from("profiles").select("email,phone,is_active").eq("id", userId).single();
      if (!profile?.is_active) return res.status(400).json({ error: "Сначала включи доступ сотруднику" });
      const password = temporaryPassword(profile.phone || "");
      if (password.length !== 6 || !profile.email) return res.status(400).json({ error: "У сотрудника не заполнены email или телефон" });
      const { error } = await adminClient!.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      await adminClient!.from("profiles").update({ must_change_password: true }).eq("id", userId);
      return res.status(200).json({ email: profile.email, temporaryPassword: password });
    }

    if (action === "set-active") {
      const { userId, active } = req.body;
      if (userId === owner.id) return res.status(400).json({ error: "Нельзя отключить собственную учётную запись" });
      const { error } = await adminClient!.from("profiles").update({ is_active: Boolean(active) }).eq("id", userId);
      if (error) throw error;
      if (!active) await adminClient!.auth.admin.signOut(userId, "global");
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Неизвестное действие" });
  } catch (error) {
    console.error("Staff API error", error);
    return res.status(500).json({ error: publicStaffError(error) });
  }
}
