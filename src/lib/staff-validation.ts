export const normalizeStaffPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("8") && digits.length === 11 ? `7${digits.slice(1)}` : digits;
};

export const isValidStaffPhone = (phone: string) => {
  const normalized = normalizeStaffPhone(phone);
  return normalized.length === 11 && normalized.startsWith("7");
};
