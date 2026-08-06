import crypto from "node:crypto";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";
import { config } from "./config.mjs";
import { normalizeOnefitClassName, normalizeOnefitText as normalize, parseVisitSnapshot } from "./parser.mjs";
import { findMissingActiveKeys } from "./reconcile.mjs";
import { claimRun, createRun, finishRun, rest } from "./supabase.mjs";

const triggerType = process.argv.includes("--manual") ? "manual" : "schedule";
const historical = process.argv.includes("--historical");
const runIdIndex = process.argv.indexOf("--run-id");
const requestedRunId = runIdIndex >= 0 ? process.argv[runIdIndex + 1] : null;
const lockPath = "/var/lib/onefit-sync/onefit-sync.lock";

const kazakhstanDate = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const fingerprint = (booking) => crypto
  .createHash("sha256")
  .update([config.targetDate, booking.time, normalize(booking.className), normalize(booking.clientName), booking.occurrence].join("|"))
  .digest("hex");

async function acquireLock() {
  try {
    const handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(String(process.pid));
    return handle;
  } catch (error) {
    if (error?.code === "EEXIST") {
      const storedPid = Number.parseInt(await fs.readFile(lockPath, "utf8").catch(() => "0"), 10);
      try { if (storedPid > 1) process.kill(storedPid, 0); }
      catch { await fs.unlink(lockPath).catch(() => {}); return acquireLock(); }
      return null;
    }
    throw error;
  }
}

async function scrapeToday() {
  const context = await chromium.launchPersistentContext(config.profileDir, {
    executablePath: config.chromiumPath,
    headless: config.headless,
    viewport: { width: 1440, height: 3000 },
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
    env: {
      HOME: "/var/lib/onefit-sync",
      LANG: "ru_RU.UTF-8",
      PATH: "/usr/bin:/bin",
      ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
      ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
    },
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(config.onefitUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const ensureAuthenticated = async () => {
      if (!page.url().includes("/login")) return;
      if (!config.onefitEmail || !config.onefitPassword) {
        throw new Error("OneFit authentication expired: ONEFIT_EMAIL and ONEFIT_PASSWORD are required for autonomous recovery");
      }
      await page.locator('input[name="email"]').fill(config.onefitEmail);
      await page.locator('input[name="password"]').fill(config.onefitPassword);
      await page.getByRole("button", { name: "Войти в аккаунт" }).click();
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000 });
      await page.waitForLoadState("domcontentloaded");
    };
    await ensureAuthenticated();
    const target = new Date(`${config.targetDate}T12:00:00+05:00`);
    const today = kazakhstanDate();
    const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
    const targetLabel = config.targetDate === today
      ? `Сегодня ${target.getUTCDate()}`
      : `${weekdays[target.getUTCDay()]} ${target.getUTCDate()}`;
    const targetPattern = new RegExp(`^${targetLabel.replace(" ", "\\s*")}$`);

    const selectTargetDate = async () => {
      await ensureAuthenticated();
      await page.locator("li").filter({ hasText: /^(Сегодня|Пн|Вт|Ср|Чт|Пт|Сб|Вс)\s*\d+$/ }).first().waitFor({ timeout: 30_000 });
      const selectedToday = page.locator("li").filter({ hasText: new RegExp(`^Сегодня\\s*${new Date(`${today}T12:00:00+05:00`).getUTCDate()}$`) });
      const selectedClass = await selectedToday.getAttribute("class");
      let targetDateItem = page.locator("li").filter({ hasText: targetPattern });
      if (historical) {
        for (let attempt = 0; attempt < 8 && await targetDateItem.count() === 0; attempt += 1) {
          const back = page.getByRole("button", { name: "Прокрутить ленту назад" });
          if (await back.count() !== 1) break;
          await back.click();
          await page.waitForTimeout(500);
          targetDateItem = page.locator("li").filter({ hasText: targetPattern });
        }
      }
      if (await targetDateItem.count() !== 1) throw new Error(`OneFit date is not visible: ${targetLabel}`);
      await targetDateItem.click();
      await page.waitForFunction(
        ({ label, className }) => [...document.querySelectorAll("li")].some((node) =>
          node.textContent?.replace(/\s+/g, " ").trim() === label && node.className === className),
        { label: targetLabel, className: selectedClass },
        { timeout: 10_000 },
      );
      await page.waitForTimeout(800);
    };
    await selectTargetDate();
    const collectSnapshot = (sectionLabel) => page.evaluate(async (label) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const findSection = () => {
          const heading = [...document.querySelectorAll("p")].find((node) => node.textContent?.trim() === label);
          return { heading, section: heading?.parentElement?.parentElement?.parentElement };
        };
        const { heading, section } = findSection();
        if (!heading || !section) return { todayVisible: true, declared: 0, cards: [] };
        const declared = Number.parseInt(heading?.parentElement?.parentElement?.querySelectorAll("p")[1]?.textContent || "", 10);
        const collected = new Map();

        // OneFit renders visits inside a fixed-height, independently
        // scrollable <ul>. Looking only at section ancestors silently capped
        // snapshots at the first ten cards once the list grew beyond 10.
        let scroller = [section, ...section.querySelectorAll("*")].find((element) => {
          const style = getComputedStyle(element);
          return element.scrollHeight > element.clientHeight + 2 &&
            ["auto", "scroll"].includes(style.overflowY);
        });
        if (!scroller) {
          scroller = section;
          while (scroller && scroller !== document.body) {
            const style = getComputedStyle(scroller);
            if (scroller.scrollHeight > scroller.clientHeight + 2 && ["auto", "scroll"].includes(style.overflowY)) break;
            scroller = scroller.parentElement;
          }
        }
        if (!scroller || scroller === document.body) scroller = document.scrollingElement;

        const collectVisibleCards = () => {
          const currentSection = findSection().section;
          const frameCounts = new Map();
          for (const card of currentSection?.querySelectorAll("ul li") || []) {
            const fields = [...card.querySelectorAll("p")].map((field) => field.textContent?.trim() || "");
            const key = JSON.stringify(fields);
            frameCounts.set(key, (frameCounts.get(key) || 0) + 1);
          }
          for (const [key, count] of frameCounts) collected.set(key, Math.max(collected.get(key) || 0, count));
        };

        const step = Math.max(Math.floor((scroller?.clientHeight || 500) * 0.7), 120);
        for (let position = 0, passes = 0; passes < 30; position += step, passes += 1) {
          if (scroller) {
            scroller.scrollTop = Math.min(position, Math.max(scroller.scrollHeight - scroller.clientHeight, 0));
            scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
          await sleep(180);
          collectVisibleCards();
          const parsedCount = [...collected.values()].reduce((sum, count) => sum + count, 0);
          const atBottom = !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
          if (parsedCount >= declared || atBottom) break;
        }
        if (scroller) scroller.scrollTop = 0;

        const cards = [];
        for (const [key, count] of collected) {
          for (let index = 0; index < count; index += 1) cards.push(JSON.parse(key));
        }
        return {
          todayVisible: [...document.querySelectorAll("p")].some((node) => node.textContent?.trim() === "Сегодня"),
          declared,
          cards,
        };
      }, sectionLabel);
    let lastError;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const queuedSnapshot = await collectSnapshot("В очереди");
      const confirmedSnapshot = await collectSnapshot("Подтвердившие");
      try {
        return [
          ...parseVisitSnapshot(queuedSnapshot, "queued"),
          ...parseVisitSnapshot(confirmedSnapshot, "confirmed"),
        ];
      } catch (error) {
        lastError = error;
        if (attempt < 9) {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
          await selectTargetDate();
          await page.waitForTimeout(3_000);
        }
      }
    }
    throw lastError;
  } finally {
    await context.close();
  }
}

async function loadSessions() {
  const from = `${config.targetDate}T00:00:00+05:00`;
  const to = `${config.targetDate}T23:59:59+05:00`;
  return rest(`schedule_sessions?select=id,start_time,class_type:class_types(name)&start_time=gte.${encodeURIComponent(from)}&start_time=lte.${encodeURIComponent(to)}`);
}

const localTime = (iso) => {
  // Kazakhstan uses UTC+5. Ubuntu's Node 18 may ship an older tzdata snapshot
  // where Asia/Almaty is still UTC+6, so use the studio's fixed legal offset.
  const local = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};

async function sync() {
  const today = kazakhstanDate();
  const allowedDates = new Set([0, 1, 2].map((offset) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }));
  if (!allowedDates.has(config.targetDate) && !historical) {
    throw new Error("OneFit sync target must be today or one of the next two days");
  }
  if (historical && config.targetDate > today) {
    throw new Error("Historical OneFit sync cannot target a future date");
  }
  const lock = await acquireLock();
  if (!lock) {
    console.log(JSON.stringify({ ok: true, skipped: "sync_already_running" }));
    return;
  }
  let run;
  try {
    run = requestedRunId ? await claimRun(requestedRunId) : await createRun(triggerType);
    const [bookings, sessions] = await Promise.all([scrapeToday(), loadSessions()]);
    let matched = 0;
    let unmatched = 0;
    const seenKeys = new Set();

    for (const booking of bookings) {
      const candidates = sessions.filter((session) =>
        localTime(session.start_time) === booking.time &&
        normalizeOnefitClassName(session.class_type?.name || "") === normalizeOnefitClassName(booking.className));
      const sessionId = candidates.length === 1 ? candidates[0].id : null;
      sessionId ? matched += 1 : unmatched += 1;
      const externalKey = fingerprint(booking);
      seenKeys.add(externalKey);
      await rest("onefit_bookings?on_conflict=external_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          external_key: externalKey,
          session_id: sessionId,
          source_date: config.targetDate,
          source_start_time: `${booking.time}:00`,
          source_class_name: booking.className,
          client_name: booking.clientName,
          source_status: booking.status,
          is_active: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }

    // Reconcile only after the parser has returned a structurally complete
    // snapshot and every visible booking has been safely upserted. History is
    // retained: disappeared bookings are marked inactive, never deleted.
    const activeRows = await rest(
      `onefit_bookings?select=external_key&source_date=eq.${encodeURIComponent(config.targetDate)}&is_active=eq.true`,
    );
    const cancelledKeys = findMissingActiveKeys(activeRows, seenKeys);
    const reconciledAt = new Date().toISOString();
    for (const externalKey of cancelledKeys) {
      await rest(`onefit_bookings?external_key=eq.${encodeURIComponent(externalKey)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          source_status: "cancelled",
          is_active: false,
          updated_at: reconciledAt,
        }),
      });
    }

    await finishRun(run.id, {
      status: unmatched > 0 ? "partial" : "success",
      found_count: bookings.length,
      matched_count: matched,
      unmatched_count: unmatched,
      parser_complete: true,
    });
    console.log(JSON.stringify({ ok: true, found: bookings.length, matched, unmatched, cancelled: cancelledKeys.length }));
  } catch (error) {
    if (run?.id) await finishRun(run.id, { status: "failed", error_message: String(error.message || error).slice(0, 500) });
    throw error;
  } finally {
    await lock.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}

await sync();
