import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret ? createClient(url, secret, { auth: { persistSession: false } }) : null;

const temporaryPassword = (phone: string) => phone.replace(/\D/g, "").slice(-6);

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
      const { email, phone, firstName, lastName, role, position, coachId } = req.body;
      if (!email || !phone || !firstName || !["admin", "trainer"].includes(role)) return res.status(400).json({ error: "Не заполнены обязательные поля" });
      const password = temporaryPassword(phone);
      if (password.length !== 6) return res.status(400).json({ error: "Для временного пароля нужен корректный телефон" });
      const { data: created, error: createError } = await adminClient!.auth.admin.createUser({ email: String(email).trim().toLowerCase(), password, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName, phone } });
      if (createError) throw createError;
      await adminClient!.from("profiles").upsert({ id: created.user.id, email: String(email).trim().toLowerCase(), phone, first_name: firstName, last_name: lastName || null, role, position: position || (role === "trainer" ? "Тренер" : "Администратор"), is_active: true, must_change_password: true });
      if (coachId) await adminClient!.from("coaches").update({ user_id: created.user.id }).eq("id", coachId);
      else if (role === "trainer") await adminClient!.from("coaches").insert({ name: `${firstName} ${lastName || ""}`.trim(), phone, is_active: true, user_id: created.user.id });
      return res.status(200).json({ id: created.user.id });
    }

    if (action === "update") {
      const { userId, email, phone, firstName, lastName, role, position } = req.body;
      if (!userId || !email || !phone || !firstName || !["owner", "admin", "trainer"].includes(role)) return res.status(400).json({ error: "Не заполнены обязательные поля" });
      const { data: existing } = await adminClient!.from("profiles").select("role").eq("id", userId).single();
      if (userId === owner.id && role !== "owner") return res.status(400).json({ error: "Нельзя снять роль управляющего у собственной учётной записи" });
      if (existing?.role === "owner" && userId !== owner.id) return res.status(400).json({ error: "Старую управляющую учётку можно только отключить" });
      const normalizedEmail = String(email).trim().toLowerCase();
      const { error: authError } = await adminClient!.auth.admin.updateUserById(userId, { email: normalizedEmail, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName, phone } });
      if (authError) throw authError;
      const { error } = await adminClient!.from("profiles").update({ email: normalizedEmail, phone, first_name: firstName, last_name: lastName || null, role, position: position || (role === "trainer" ? "Тренер" : "Администратор") }).eq("id", userId);
      if (error) throw error;
      const { data: coach } = await adminClient!.from("coaches").select("id").eq("user_id", userId).maybeSingle();
      if (role === "trainer" && !coach) await adminClient!.from("coaches").insert({ name: `${firstName} ${lastName || ""}`.trim(), phone, is_active: true, user_id: userId });
      else if (role === "trainer" && coach) await adminClient!.from("coaches").update({ name: `${firstName} ${lastName || ""}`.trim(), phone, is_active: true }).eq("id", coach.id);
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
    return res.status(500).json({ error: error instanceof Error ? error.message : "Ошибка сервера" });
  }
}
