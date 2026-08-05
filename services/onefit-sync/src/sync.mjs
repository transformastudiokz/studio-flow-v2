import crypto from "node:crypto";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";
import { config } from "./config.mjs";
import { normalizeOnefitText as normalize, parseQueuedSnapshot } from "./parser.mjs";
import { findMissingActiveKeys } from "./reconcile.mjs";
import { claimRun, createRun, finishRun, rest } from "./supabase.mjs";

const triggerType = process.argv.includes("--manual") ? "manual" : "schedule";
const runIdIndex = process.argv.indexOf("--run-id");
const requestedRunId = runIdIndex >= 0 ? process.argv[runIdIndex + 1] : null;
const lockPath = "/var/lib/onefit-sync/onefit-sync.lock";

const kazakhstanDate = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const fingerprint = (booking) => crypto
  .createHash("sha256")
  .update([config.pilotDate, booking.time, normalize(booking.className), normalize(booking.clientName), booking.occurrence].join("|"))
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
      throw new Error("Sync is already running");
    }
    throw error;
  }
}

async function scrapeToday() {
  const context = await chromium.launchPersistentContext(config.profileDir, {
    executablePath: config.chromiumPath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
    env: { HOME: "/var/lib/onefit-sync", LANG: "ru_RU.UTF-8", PATH: "/usr/bin:/bin" },
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(config.onefitUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText("В очереди", { exact: true }).waitFor({ timeout: 30_000 });
    const snapshot = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("p")].find((node) => node.textContent?.trim() === "В очереди");
      const section = heading?.parentElement?.parentElement?.parentElement;
      const declared = Number.parseInt(heading?.parentElement?.parentElement?.querySelectorAll("p")[1]?.textContent || "", 10);
      const cards = [...(section?.querySelectorAll("ul li") || [])].map((card) =>
        [...card.querySelectorAll("p")].map((field) => field.textContent?.trim() || ""));
      return { todayVisible: [...document.querySelectorAll("p")].some((node) => node.textContent?.trim() === "Сегодня"), declared, cards };
    });
    return parseQueuedSnapshot(snapshot);
  } finally {
    await context.close();
  }
}

async function loadSessions() {
  const from = `${config.pilotDate}T00:00:00+05:00`;
  const to = `${config.pilotDate}T23:59:59+05:00`;
  return rest(`schedule_sessions?select=id,start_time,class_type:class_types(name)&start_time=gte.${encodeURIComponent(from)}&start_time=lte.${encodeURIComponent(to)}`);
}

const localTime = (iso) => {
  // Kazakhstan uses UTC+5. Ubuntu's Node 18 may ship an older tzdata snapshot
  // where Asia/Almaty is still UTC+6, so use the studio's fixed legal offset.
  const local = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};

async function sync() {
  if (kazakhstanDate() !== config.pilotDate) {
    throw new Error(`OneFit pilot is limited to ${config.pilotDate}`);
  }
  const lock = await acquireLock();
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
        normalize(session.class_type?.name || "") === normalize(booking.className));
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
          source_date: config.pilotDate,
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
      `onefit_bookings?select=external_key&source_date=eq.${encodeURIComponent(config.pilotDate)}&is_active=eq.true`,
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
