import { spawn } from "node:child_process";

const kazakhstanToday = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const dates = [0, 1, 2].map((offset) => {
  const date = new Date(`${kazakhstanToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
});

const runDate = (targetDate) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [new URL("./sync.mjs", import.meta.url).pathname], {
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
for (const date of dates) {
  try {
    await runDate(date);
  } catch (error) {
    failures.push(String(error.message || error));
  }
}

if (failures.length) throw new Error(failures.join("; "));
