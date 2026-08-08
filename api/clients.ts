import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { ensureClientAccount } from "./_lib/client-account.js";

const url = process.env.VITE_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = url && secret
  ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

async function requireStaff(req: VercelRequest) {
  if (!adminClient) throw new Error("Серверный доступ Supabase не настроен");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await adminClient.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient.from("profiles").select("role,is_active").eq("id", user.id).single();
  return profile?.is_active !== false && ["owner", "admin"].includes(profile?.role || "") ? user : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!await requireStaff(req)) return res.status(403).json({ error: "Доступ только сотрудникам студии" });
    if (req.body?.action === "update-subscription") {
      const subscriptionId = String(req.body?.subscriptionId || "");
      const saleDate = String(req.body?.saleDate || "");
      const activationDate = req.body?.activationDate ? String(req.body.activationDate) : null;
      const endDate = req.body?.endDate ? String(req.body.endDate) : null;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;

      if (!subscriptionId) return res.status(400).json({ error: "Абонемент не указан" });
      if (!datePattern.test(saleDate)) return res.status(400).json({ error: "Укажи дату продажи" });
      if (activationDate && !datePattern.test(activationDate)) return res.status(400).json({ error: "Некорректная дата активации" });
      if (endDate && !datePattern.test(endDate)) return res.status(400).json({ error: "Некорректная дата окончания" });
      if (activationDate && endDate && endDate < activationDate) {
        return res.status(400).json({ error: "Дата окончания не может быть раньше активации" });
      }

      const { data: subscription, error: subscriptionError } = await adminClient!
        .from("user_subscriptions")
        .select("id,visits_total,visits_remaining")
        .eq("id", subscriptionId)
        .single();
      if (subscriptionError || !subscription) throw subscriptionError || new Error("Абонемент не найден");

      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const hasVisits = subscription.visits_total == null || Number(subscription.visits_remaining) > 0;
      const isActive = hasVisits && (!endDate || endDate >= today);
      const { data: updated, error: updateError } = await adminClient!
        .from("user_subscriptions")
        .update({
          start_date: saleDate,
          activation_date: activationDate,
          end_date: endDate,
          is_active: isActive,
        })
        .eq("id", subscriptionId)
        .select("id,start_date,activation_date,end_date,is_active")
        .single();
      if (updateError) throw updateError;

      return res.status(200).json(updated);
    }

    if (req.body?.action !== "create") return res.status(400).json({ error: "Неизвестное действие" });

    const account = await ensureClientAccount(adminClient!, {
      firstName: String(req.body?.firstName || ""),
      lastName: String(req.body?.lastName || ""),
      phone: String(req.body?.phone || ""),
      contactEmail: String(req.body?.email || ""),
      notes: req.body?.notes === undefined ? undefined : String(req.body.notes || ""),
      leadStatus: req.body?.leadStatus === undefined ? undefined : String(req.body.leadStatus || ""),
    });

    if (!account.created) {
      return res.status(409).json({
        error: "Клиент с этим телефоном уже существует. Открой его карточку вместо повторного создания.",
        id: account.id,
      });
    }

    if (req.body?.planId && req.body.planId !== "none") {
      const { data: plan, error: planError } = await adminClient!.from("subscription_plans")
        .select("id,visits_count")
        .eq("id", String(req.body.planId))
        .single();
      if (planError || !plan) throw planError || new Error("Абонемент не найден");
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const { error: subscriptionError } = await adminClient!.from("user_subscriptions").insert({
        user_id: account.id,
        plan_id: plan.id,
        visits_remaining: plan.visits_count,
        visits_total: plan.visits_count,
        start_date: today,
        activation_date: null,
        end_date: null,
        is_active: true,
      });
      if (subscriptionError) throw subscriptionError;
    }

    return res.status(account.created ? 201 : 200).json(account);
  } catch (error) {
    console.error("Client account API failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Не удалось создать клиента" });
  }
}
