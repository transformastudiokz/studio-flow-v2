import type { SupabaseClient } from "@supabase/supabase-js";

export const normalizeClientPhone = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};

export const clientAuthEmail = (phone: string) => `${normalizeClientPhone(phone)}@balance.kz`;
export const clientTemporaryPassword = (phone: string) => `yoga${normalizeClientPhone(phone).slice(-4)}`;

type ClientAccountInput = {
  firstName: string;
  lastName?: string;
  phone: string;
  contactEmail?: string;
  notes?: string;
  leadStatus?: string;
};

export async function ensureClientAccount(admin: SupabaseClient, input: ClientAccountInput) {
  const phone = normalizeClientPhone(input.phone);
  const firstName = input.firstName.trim();
  const lastName = (input.lastName || "").trim();
  const contactEmail = (input.contactEmail || "").trim().toLowerCase();
  if (!firstName || phone.length !== 11) throw new Error("Укажи имя и корректный телефон");

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id,first_name,last_name,phone,email")
    .eq("role", "client")
    .limit(5000);
  if (profilesError) throw profilesError;

  const matchingProfiles = (profiles || []).filter((profile) => normalizeClientPhone(profile.phone || "") === phone);
  const canonicalEmail = clientAuthEmail(phone);
  // Historical screens used different technical domains and could create a
  // duplicate profile. Prefer the canonical account deterministically.
  const existing = matchingProfiles.find((profile) => profile.email === canonicalEmail) || matchingProfiles[0];
  if (existing) {
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(existing.id);
    if (authError || !authData.user) {
      throw new Error("Карточка клиента существует, но доступ повреждён. Нужна безопасная миграция учётной записи.");
    }

    // Unify legacy @balance.local/@auth.local accounts without changing an
    // existing password. The client keeps access while the login becomes the
    // same normalized phone in every creation flow.
    if (authData.user.email !== canonicalEmail) {
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(existing.id, {
        email: canonicalEmail,
        email_confirm: true,
        user_metadata: {
          ...authData.user.user_metadata,
          first_name: firstName,
          last_name: lastName,
          phone,
        },
      });
      if (updateAuthError) throw updateAuthError;
    }

    const { error: updateProfileError } = await admin.from("profiles").update({
      first_name: firstName,
      last_name: lastName || null,
      phone,
      email: contactEmail || existing.email || canonicalEmail,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.leadStatus !== undefined ? { lead_status: input.leadStatus } : {}),
    }).eq("id", existing.id);
    if (updateProfileError) throw updateProfileError;

    return { id: existing.id, phone, login: phone, created: false, temporaryPassword: null };
  }

  const email = clientAuthEmail(phone);
  const temporaryPassword = clientTemporaryPassword(phone);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, phone, role: "client" },
  });
  if (createError) throw createError;

  try {
    const { error: profileError } = await admin.from("profiles").upsert({
      id: created.user.id,
      first_name: firstName,
      last_name: lastName || null,
      phone,
      email: contactEmail || email,
      role: "client",
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.leadStatus !== undefined ? { lead_status: input.leadStatus } : {}),
    });
    if (profileError) throw profileError;
  } catch (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw error;
  }

  return { id: created.user.id, phone, login: phone, created: true, temporaryPassword };
}
