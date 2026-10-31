// Shared config and probe helpers for the double-click launcher halves
// (launch.mjs / stop.mjs). Design contract: .scratch/local-launcher/plan.md
// (T2/T4). The launcher, the reuse probe and the stop script share one
// pinned origin — PORT/HOST are fixed by design (dynamic ports refused) —
// and all runtime artifacts live beside the resolved database path, so the
// startup mutex keys on database identity, not on the port.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
export const PORT = 3000;
export const HOST = "127.0.0.1";
export const BASE_URL = `http://127.0.0.1:${PORT}/`;
export const START_BUDGET_MS = 30_000;
export const POLL_MS = 500;
export const PROBE_TIMEOUT_MS = 2_000;
export const STOP_WAIT_MS = 15_000;

// Node's --env-file precedence: real environment wins over .env, then the
// documented default. Mirrored here so the launcher manages the same
// database the server will open.
const dotEnv = (() => {
  const values = {};
  try {
    const text = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (match) {
        values[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env is a legal state; documented defaults apply.
  }
  return values;
})();

export const DB_PATH = path.resolve(
  REPO_ROOT,
  process.env.DATABASE_PATH ?? dotEnv.DATABASE_PATH ?? ".data/lingualeaf.sqlite"
);
export const LOCK_PATH = `${DB_PATH}.launch-lock`;
export const STATE_PATH = `${DB_PATH}.launcher-state.json`;
export const LOG_PATH = path.join(path.dirname(DB_PATH), "launcher-server.log");
export const WATCHDOG_LOG_PATH = path.join(
  path.dirname(DB_PATH),
  "launcher-watchdog.log"
);

export function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function procCwd(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

// "owned" = the recorded pid is alive and works in this repository; any
// other outcome means the recorded instance is gone (dead, or the pid was
// reused by an unrelated process) and our records are residue.
export function classifyState(state) {
  if (!state || typeof state.pid !== "number" || !pidAlive(state.pid)) {
    return "stale";
  }
  return procCwd(state.pid) === REPO_ROOT ? "owned" : "stale";
}

// True when something is listening on the pinned port. Raw socket probe —
// no HTTP client, so no proxy layer can intercept the loopback check.
export function portBusy() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT, timeout: 1_000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

// The server's readiness contract: 200 from /api/health. Direct http.get —
// undici and proxy environment settings never enter the path. Returns the
// parsed JSON body (the watchdog reads lastPageSeenAt/activeTasks off it),
// or null when the server is not (yet) answering.
export function probeHealthJson() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: HOST,
        port: PORT,
        path: "/api/health",
        timeout: PROBE_TIMEOUT_MS,
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      }
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}

export async function probeHealth() {
  return (await probeHealthJson()) !== null;
}

// Removes launcher records unconditionally — the stop/watchdog paths call
// this only after verifying the instance is gone. launch.mjs deliberately
// keeps its own nonce-gated variant: it can race a concurrent launcher.
export function removeRecords(paths) {
  for (const filePath of paths) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Absent already is fine.
    }
  }
}

// SIGTERM a managed pid and wait up to waitMs for it to die; true when the
// pid is gone (including when it already was). Never escalates to SIGKILL
// and never kills by port — callers own their timeout messaging.
export async function gracefulStop(pid, waitMs) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return true;
    throw error;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(200);
  }
  return !pidAlive(pid);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
