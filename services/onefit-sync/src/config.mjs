const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

export const config = {
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  profileDir: process.env.ONEFIT_PROFILE_DIR || "/var/lib/onefit-sync/browser-profile",
  chromiumPath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
  pilotDate: process.env.ONEFIT_PILOT_DATE || "2026-08-05",
  onefitUrl: "https://erp.1fit.app/",
};
