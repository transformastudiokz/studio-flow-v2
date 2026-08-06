import { spawn } from "node:child_process";

const kazakhstanToday = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const manual = process.argv.includes("--manual");
const runIdIndex = process.argv.indexOf("--run-id");
const requestedRunId = runIdIndex >= 0 ? process.argv[runIdIndex + 1] : null;

// Operational horizon: keep only today and tomorrow fresh. The studio uses
// OneFit occupancy to manage the next day, so scraping a third day adds load
// without improving the team's decisions.
const dates = [0, 1].map((offset) => {
  const date = new Date(`${kazakhstanToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
});

const runDate = (targetDate, index) => new Promise((resolve, reject) => {
  const args = [new URL("./sync.mjs", import.meta.url).pathname];
  if (manual) args.push("--manual");
  if (index === 0 && requestedRunId) args.push("--run-id", requestedRunId);
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ONEFIT_TARGET_DATE: targetDate },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`OneFit sync failed for ${targetDate}: ${signal || code}`));
  });
});

const failures = [];
for (const [index, date] of dates.entries()) {
  try {
    await runDate(date, index);
  } catch (error) {
    failures.push(String(error.message || error));
  }
}

if (failures.length) throw new Error(failures.join("; "));
