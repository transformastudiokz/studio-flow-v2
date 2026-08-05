import { config } from "./config.mjs";

const headers = {
  apikey: config.serviceRoleKey,
  Authorization: `Bearer ${config.serviceRoleKey}`,
  "Content-Type": "application/json",
};

export async function rest(path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message.slice(0, 300)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function createRun(triggerType) {
  const rows = await rest("onefit_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ trigger_type: triggerType, status: "running", source_date: config.targetDate }),
  });
  return rows[0];
}

export async function claimRun(id) {
  const rows = await rest(`onefit_sync_runs?id=eq.${encodeURIComponent(id)}&status=eq.queued`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "running", started_at: new Date().toISOString() }),
  });
  if (!rows?.length) throw new Error("Manual sync request was already claimed");
  return rows[0];
}

export async function finishRun(id, values) {
  await rest(`onefit_sync_runs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...values, finished_at: new Date().toISOString() }),
  });
}
