import { spawn } from "node:child_process";
import { config } from "./config.mjs";
import { finishRun, rest } from "./supabase.mjs";

let running = false;
const kazakhstanDate = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const execute = (runId) => new Promise((resolve) => {
  const args = [new URL("./sync.mjs", import.meta.url).pathname];
  args.push("--manual", "--run-id", runId);
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
  child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
});

async function poll() {
  if (running) return;
  const queued = await rest(`onefit_sync_runs?select=id&status=eq.queued&source_date=eq.${kazakhstanDate()}&order=started_at.asc&limit=1`);
  if (!queued.length) return;
  running = true;
  try {
    const code = await execute(queued[0].id);
    if (code !== 0) await finishRun(queued[0].id, { status: "failed", error_message: `Manual sync exited with code ${code}` }).catch(() => {});
  } finally {
    running = false;
  }
}

await poll();
setInterval(() => poll().catch((error) => console.error("OneFit poll failed", error.message)), 60_000);
