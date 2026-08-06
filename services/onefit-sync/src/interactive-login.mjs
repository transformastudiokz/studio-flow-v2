import { chromium } from "playwright-core";
import { config } from "./config.mjs";

const context = await chromium.launchPersistentContext(config.profileDir, {
  executablePath: config.chromiumPath,
  headless: false,
  viewport: { width: 1200, height: 800 },
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
  env: {
    HOME: "/var/lib/onefit-sync",
    LANG: "ru_RU.UTF-8",
    PATH: "/usr/bin:/bin",
    DISPLAY: process.env.DISPLAY || ":99",
    ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
  },
});

const page = context.pages()[0] || await context.newPage();
await page.goto(config.onefitUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
if (page.url().includes("/login")) {
  await page.locator('input[name="email"]').fill(config.onefitEmail);
  await page.locator('input[name="password"]').fill(config.onefitPassword);
}

await new Promise((resolve) => setTimeout(resolve, 15 * 60_000));
await context.close();
