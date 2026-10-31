// LinguaLeaf double-click launcher — idle watchdog (WSL side, detached).
// Spawned by launch.mjs once the server is healthy; owns the server after
// startup. Stops it when reader pages have been gone past the idle limit
// AND no background task is running (plan.md T4 修订: 等任务做完再停,
// 默认 2 分钟), and cleans the launcher records up when the server dies
// on its own. Usage: watchdog.mjs <serverPid>
//
// The idle limit and the first-seen budget are env-tunable for
// verification (LAUNCHER_IDLE_MS / LAUNCHER_FIRST_SEEN_MS); production
// runs on the defaults.
import fs from "node:fs";
import {
  LOCK_PATH,
  POLL_MS,
  STATE_PATH,
  STOP_WAIT_MS,
  WATCHDOG_LOG_PATH,
  gracefulStop,
  pidAlive,
  probeHealthJson,
  removeRecords,
  sleep,
} from "./launcher-shared.mjs";

const IDLE_LIMIT_MS = Number(process.env.LAUNCHER_IDLE_MS ?? 120_000);
const FIRST_SEEN_BUDGET_MS = Number(
  process.env.LAUNCHER_FIRST_SEEN_MS ?? 600_000
);

const serverPid = Number(process.argv[2]);
if (!Number.isInteger(serverPid) || serverPid <= 0) {
  process.stderr.write("watchdog: 用法 watchdog.mjs <serverPid>\n");
  process.exit(1);
}

function log(line) {
  try {
    fs.appendFileSync(
      WATCHDOG_LOG_PATH,
      `${new Date().toISOString()} ${line}\n`
    );
  } catch {
    // A missing log must never kill the watchdog.
  }
}

function cleanupRecords() {
  removeRecords([STATE_PATH, LOCK_PATH]);
}

async function stopServer(reason) {
  log(reason);
  const stopped = await gracefulStop(serverPid, STOP_WAIT_MS);
  cleanupRecords();
  log(
    stopped
      ? `exit: stopped (${reason})`
      : `exit: stop timed out, pid ${serverPid} may remain (${reason})`
  );
  process.exit(0);
}

log(`watching pid ${serverPid}, idle limit ${IDLE_LIMIT_MS / 1000}s`);
const startedAt = Date.now();
let seenPage = false;

// Poll loop: the pid check owns death, the health body owns page presence
// and task load, and all three agree before any stop decision.
while (true) {
  await sleep(POLL_MS * 3);
  if (!pidAlive(serverPid)) {
    log("server process exited on its own");
    cleanupRecords();
    log("exit: server died");
    process.exit(0);
  }
  const health = await probeHealthJson();
  if (!health) continue;
  if (!seenPage && health.lastPageSeenAt) {
    seenPage = true;
    log("first page heartbeat seen");
  }
  if (!seenPage) {
    if (Date.now() - startedAt > FIRST_SEEN_BUDGET_MS) {
      await stopServer(
        `no reader page appeared within ${FIRST_SEEN_BUDGET_MS / 1000}s`
      );
    }
    continue;
  }
  const idleMs = Date.now() - Date.parse(health.lastPageSeenAt);
  if (idleMs > IDLE_LIMIT_MS && health.activeTasks === 0) {
    await stopServer(
      `pages idle ${Math.round(idleMs / 1000)}s (limit ${
        IDLE_LIMIT_MS / 1000
      }s), no active tasks`
    );
  }
}
