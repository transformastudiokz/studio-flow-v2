export const normalizeClientRegistrationPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};

export const getClientLoginPhones = (value: string) => {
  const digits = value.replace(/\D/g, "");
  const candidates = [digits];

  // New CRM accounts use the full Kazakhstan number. A small number of
  // migrated/manual accounts still use the last 10 digits as their login.
  if (digits.length === 10) candidates.push(`7${digits}`);
  if (digits.length === 11 && digits.startsWith("8")) {
    candidates.push(`7${digits.slice(1)}`, digits.slice(1));
  }
  if (digits.length === 11 && digits.startsWith("7")) candidates.push(digits.slice(1));

  return [...new Set(candidates.filter(Boolean))];
};

export const getClientLoginEmails = (value: string) => {
  const domains = ["balance.kz", "balance.local", "auth.local"];
  return getClientLoginPhones(value).flatMap((phone) => domains.map((domain) => `${phone}@${domain}`));
};
