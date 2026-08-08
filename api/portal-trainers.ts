import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret
  ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!adminClient) return res.status(500).json({ error: "Сервис не настроен" });
  try {
    const [{ data: profiles, error: profileError }, { data: coaches, error: coachError }] = await Promise.all([
      adminClient.from("profiles").select("id,first_name,last_name").eq("role", "trainer").eq("is_active", true),
      adminClient.from("coaches").select("id,user_id,name,photo_url,is_active,specializations:coach_class_types(class_type:class_types(name,color))").eq("is_active", true),
    ]);
    if (profileError) throw profileError;
    if (coachError) throw coachError;
    const coachByUser = new Map((coaches || []).filter((item) => item.user_id).map((item) => [item.user_id, item]));
    const result = (profiles || []).map((profile) => {
      const coach = coachByUser.get(profile.id);
      const firstName = String(profile.first_name || "Тренер").trim();
      const lastInitial = String(profile.last_name || "").trim().slice(0, 1).toLocaleUpperCase("ru-RU");
      return {
        id: coach?.id || profile.id,
        user_id: profile.id,
        display_name: `${firstName}${lastInitial ? ` ${lastInitial}.` : ""}`,
        photo_url: coach?.photo_url || null,
        description: null,
        specializations: coach?.specializations || [],
      };
    }).sort((left, right) => left.display_name.localeCompare(right.display_name, "ru"));
    return res.status(200).json({ trainers: result });
  } catch (error) {
    console.error("Portal trainers API error", error);
    const message = error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "Не удалось загрузить тренеров";
    return res.status(500).json({ error: message });
  }
}
