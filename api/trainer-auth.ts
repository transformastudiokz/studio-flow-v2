import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret
  ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const phoneDigits = (value: string) => value.replace(/\D/g, "").slice(-10);

async function authenticatedTrainer(req: VercelRequest) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await adminClient.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient
    .from("profiles")
    .select("id,role,is_active")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.role === "trainer" && profile?.is_active !== false ? user : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!adminClient) return res.status(500).json({ error: "Сервер авторизации не настроен" });

  try {
    const action = req.body?.action;

    if (action === "resolve-login") {
      const identifier = String(req.body?.identifier || "").trim();
      if (!identifier) return res.status(400).json({ error: "Укажите e-mail или телефон" });
      if (identifier.includes("@")) {
        return res.status(200).json({ email: identifier.toLocaleLowerCase("ru-RU") });
      }

      const wantedPhone = phoneDigits(identifier);
      if (wantedPhone.length !== 10) return res.status(400).json({ error: "Неверный телефон или пароль" });
      const { data: trainers, error } = await adminClient
        .from("profiles")
        .select("email,phone")
        .eq("role", "trainer")
        .eq("is_active", true);
      if (error) throw error;
      const trainer = trainers?.find((item) => phoneDigits(String(item.phone || "")) === wantedPhone);
      if (!trainer?.email) return res.status(404).json({ error: "Неверный телефон или пароль" });
      return res.status(200).json({ email: String(trainer.email).trim().toLowerCase() });
    }

    if (action === "password-changed") {
      const trainer = await authenticatedTrainer(req);
      if (!trainer) return res.status(403).json({ error: "Сессия завершилась. Войдите снова." });
      const { error } = await adminClient
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", trainer.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Неизвестное действие" });
  } catch (error) {
    console.error("Trainer auth API error", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Ошибка сервера" });
  }
}
