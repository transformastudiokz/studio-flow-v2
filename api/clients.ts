import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import {
  clientAuthEmail,
  clientTemporaryPassword,
  ensureClientAccount,
  normalizeClientPhone,
} from "./_lib/client-account.js";

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
    const staffUser = await requireStaff(req);
    if (!staffUser) return res.status(403).json({ error: "Доступ только сотрудникам студии" });
    if (req.body?.action === "reset-client-access") {
      const clientId = String(req.body?.clientId || "");
      if (!clientId) return res.status(400).json({ error: "Клиент не указан" });

      const { data: profile, error: profileError } = await adminClient!
        .from("profiles")
        .select("id,first_name,last_name,phone,role")
        .eq("id", clientId)
        .single();
      if (profileError || !profile) throw profileError || new Error("Клиент не найден");
      if (profile.role !== "client") return res.status(400).json({ error: "Это не учётная запись клиента" });

      const phone = normalizeClientPhone(profile.phone || "");
      if (phone.length !== 11) return res.status(400).json({ error: "Сначала укажи корректный телефон клиента" });

      const { data: authData, error: authLookupError } = await adminClient!.auth.admin.getUserById(clientId);
      if (authLookupError || !authData.user) {
        return res.status(409).json({ error: "Карточка клиента есть, но доступ повреждён. Нужно восстановить учётную запись." });
      }

      const temporaryPassword = clientTemporaryPassword(phone);
      const { error: updateError } = await adminClient!.auth.admin.updateUserById(clientId, {
        email: clientAuthEmail(phone),
        email_confirm: true,
        password: temporaryPassword,
        user_metadata: {
          ...authData.user.user_metadata,
          first_name: profile.first_name || "",
          last_name: profile.last_name || "",
          phone,
          role: "client",
        },
      });
      if (updateError) throw updateError;

      return res.status(200).json({
        firstName: profile.first_name || "",
        login: phone,
        phone,
        temporaryPassword,
        portalUrl: "https://crm-fitness-one.vercel.app/portal/login",
      });
    }
    if (req.body?.action === "update-subscription") {
      const subscriptionId = String(req.body?.subscriptionId || "");
      const saleDate = String(req.body?.saleDate || "");
      const activationDate = req.body?.activationDate ? String(req.body.activationDate) : null;
      const endDate = req.body?.endDate ? String(req.body.endDate) : null;
      const visitsTotal = Number(req.body?.visitsTotal);
      const visitsRemaining = Number(req.body?.visitsRemaining);
      const requestedActive = req.body?.isActive === true;
      const reason = String(req.body?.reason || "").trim();
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;

      if (!subscriptionId) return res.status(400).json({ error: "Абонемент не указан" });
      if (!datePattern.test(saleDate)) return res.status(400).json({ error: "Укажи дату продажи" });
      if (activationDate && !datePattern.test(activationDate)) return res.status(400).json({ error: "Некорректная дата активации" });
      if (endDate && !datePattern.test(endDate)) return res.status(400).json({ error: "Некорректная дата окончания" });
      if (activationDate && endDate && endDate < activationDate) {
        return res.status(400).json({ error: "Дата окончания не может быть раньше активации" });
      }
      if (!Number.isInteger(visitsTotal) || visitsTotal < 0) return res.status(400).json({ error: "Укажи корректное общее количество занятий" });
      if (!Number.isInteger(visitsRemaining) || visitsRemaining < 0 || visitsRemaining > visitsTotal) {
        return res.status(400).json({ error: "Остаток должен быть от нуля до общего количества занятий" });
      }
      if (reason.length < 3) return res.status(400).json({ error: "Укажи причину корректировки" });

      const { data: updated, error: updateError } = await adminClient!.rpc("adjust_client_subscription", {
        p_subscription_id: subscriptionId,
        p_sale_date: saleDate,
        p_activation_date: activationDate,
        p_end_date: endDate,
        p_visits_total: visitsTotal,
        p_visits_remaining: visitsRemaining,
        p_is_active: requestedActive,
        p_reason: reason,
        p_changed_by: staffUser.id,
      });
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
