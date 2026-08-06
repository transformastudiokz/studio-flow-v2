const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const decoded = (name) => {
  const value = process.env[name]?.trim();
  return value ? Buffer.from(value, "base64").toString("utf8") : "";
};

export const config = {
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  profileDir: process.env.ONEFIT_PROFILE_DIR || "/var/lib/onefit-sync/browser-profile",
  chromiumPath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
  headless: process.env.ONEFIT_HEADLESS !== "false",
  targetDate: process.env.ONEFIT_TARGET_DATE || new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10),
  onefitEmail: process.env.ONEFIT_EMAIL?.trim() || decoded("ONEFIT_EMAIL_B64"),
  onefitPassword: process.env.ONEFIT_PASSWORD || decoded("ONEFIT_PASSWORD_B64"),
  onefitUrl: "https://erp.1fit.app/",
};
