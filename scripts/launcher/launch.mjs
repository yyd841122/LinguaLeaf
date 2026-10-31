// LinguaLeaf double-click launcher — launch half (WSL side). Windows entry:
// windows/lingualeaf-launch.bat. Responsibilities per plan.md T2/T4:
// minimum runnability checks that name the preparation command (never an
// implicit install or build), a database-identity mutex via an O_EXCL lock
// beside the database, an ownership record verified through /proc/<pid>/cwd
// before any reuse, and convergence for concurrent double-clicks.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  DB_PATH,
  HOST,
  LOCK_PATH,
  LOG_PATH,
  POLL_MS,
  PORT,
  REPO_ROOT,
  START_BUDGET_MS,
  STATE_PATH,
  STOP_WAIT_MS,
  WATCHDOG_LOG_PATH,
  classifyState,
  gracefulStop,
  pidAlive,
  portBusy,
  probeHealth,
  readJson,
  sleep,
} from "./launcher-shared.mjs";

const NONCE = randomUUID();

function fail(message) {
  process.stderr.write(`launch: ${message}\n`);
  process.exit(1);
}

function tail(filePath, lines) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .slice(-lines)
      .join("\n");
  } catch {
    return "(日志不可读)";
  }
}

function hasOwnedState() {
  const state = readJson(STATE_PATH);
  return Boolean(state) && classifyState(state) === "owned";
}

// Records are removed only when they are ours (nonce match) or verifiably
// residue — never while a concurrent launcher's live instance owns them.
function tryUnlink(filePath, disposable) {
  const parsed = readJson(filePath);
  if (parsed && parsed.nonce !== NONCE && !disposable(parsed)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Absent already is fine.
  }
}

function cleanupRecords() {
  tryUnlink(STATE_PATH, (state) => classifyState(state) === "stale");
  tryUnlink(LOCK_PATH, () => !hasOwnedState());
}

// The idle watchdog is a detached sibling of the server (plan.md T4 修订):
// it survives this process and stops the server once reader pages have
// been gone past the idle limit with no background task running.
function spawnWatchdog(serverPid) {
  fs.writeFileSync(WATCHDOG_LOG_PATH, "");
  const watchdog = spawn(
    process.execPath,
    [
      path.join(REPO_ROOT, "scripts", "launcher", "watchdog.mjs"),
      String(serverPid),
    ],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore" }
  );
  watchdog.unref();
  return watchdog.pid;
}

// Reuse must leave a live watchdog behind: the previous launch's watchdog
// may itself have died while the server lived on.
function ensureWatchdog() {
  const state = readJson(STATE_PATH);
  if (!state || (state.watcherPid && pidAlive(state.watcherPid))) return;
  const watcherPid = spawnWatchdog(state.pid);
  fs.writeFileSync(
    STATE_PATH,
    `${JSON.stringify({ ...state, watcherPid }, null, 2)}\n`
  );
  console.log("看门狗未在运行,已重新拉起。");
}

const AUTO_STOP_HINT =
  "提示:关闭所有页面约 2 分钟后服务会自动停止(有任务时会等任务完成)。";

// T2: minimum runnability checks — name the missing prerequisite and the
// command that provides it; never install or build implicitly.
if (!fs.existsSync(path.join(REPO_ROOT, "node_modules"))) {
  fail("依赖未安装(node_modules 缺失)。\n  准备命令: npm install");
}
if (!fs.existsSync(path.join(REPO_ROOT, ".output/server/main.js"))) {
  fail("生产构建产物缺失(.output/server/main.js)。\n  准备命令: npm run build");
}

// Existing record → verify ownership → reuse, or clean verified residue.
const existing = readJson(STATE_PATH);
if (existing) {
  if (classifyState(existing) === "owned") {
    if (await probeHealth()) {
      ensureWatchdog();
      console.log(
        `正在使用现有实例 (pid ${existing.pid}): ${BASE_URL}\n${AUTO_STOP_HINT}`
      );
      process.exit(0);
    }
    fail(
      `受管进程 (pid ${existing.pid}) 存活但健康检查不通过(受管异常)。\n` +
        `  日志: ${LOG_PATH}\n` +
        `  或先停止再启动: bash scripts/launcher/stop.sh`
    );
  }
  console.log("清理残留的启动器记录(记录的进程已不存在)…");
  cleanupRecords();
}

// Unmanaged occupier on the pinned port → report; never kill, never move.
if (await portBusy()) {
  fail(
    `端口 ${PORT} 已被监听但没有本启动器的托管记录` +
      `(可能是手动 npm start/dev 的实例)。\n` +
      `  排查: ss -ltnp 'sport = :${PORT}'\n` +
      `  本启动器不自动杀进程、不自动换端口。`
  );
}

// Database-identity mutex: O_EXCL lock beside the database. The loser of
// the race waits for the winner's state record and reuses its instance, so
// concurrent double-clicks converge on one server.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
let lockFd;
try {
  lockFd = fs.openSync(LOCK_PATH, "wx");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  // A legitimate holder publishes its state record immediately after taking
  // the lock; a lock with no owned record is a crashed launch.
  await sleep(1_000);
  const winner = readJson(STATE_PATH);
  if (winner && classifyState(winner) === "owned") {
    const waitedFrom = Date.now();
    while (Date.now() - waitedFrom < START_BUDGET_MS) {
      if (await probeHealth()) {
        ensureWatchdog();
        console.log(
          `正在使用现有实例 (pid ${winner.pid}): ${BASE_URL}\n${AUTO_STOP_HINT}`
        );
        process.exit(0);
      }
      if (!hasOwnedState()) break;
      await sleep(POLL_MS);
    }
    if (hasOwnedState()) {
      fail(
        `同库已有受管实例 (pid ${winner.pid}) 但健康检查持续不通过。\n` +
          `  日志: ${LOG_PATH}`
      );
    }
    // The winner vanished mid-wait: fall through and take the lock below.
  }
  try {
    lockFd = fs.openSync(LOCK_PATH, "wx");
  } catch (retryError) {
    fail(
      `无法取得启动锁 ${LOCK_PATH}(${retryError.code ?? retryError.message})。`
    );
  }
}

fs.writeSync(
  lockFd,
  `${JSON.stringify({
    nonce: NONCE,
    repoPath: REPO_ROOT,
    dbPath: DB_PATH,
    startedAt: new Date().toISOString(),
  })}\n`
);

// Prod entry, same command shape as `npm start`; the env-file flag keeps
// .env semantics, and the pinned PORT/HOST win through explicit environment.
const logFd = fs.openSync(LOG_PATH, "w");
const child = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", ".output/server/main.js"],
  {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: ["ignore", logFd, logFd],
    detached: true,
  }
);
child.unref();

// Publish the record immediately (the mutex waiter above relies on this),
// with the watchdog already in it: health cannot pass before state carries
// watcherPid, so the reuse path's re-pull guard only fires for a genuinely
// dead watchdog (review C1). The watchdog tolerates the server still
// starting — its pid check owns liveness, the first-seen budget covers
// startup.
const state = {
  nonce: NONCE,
  pid: child.pid,
  repoPath: REPO_ROOT,
  dbPath: DB_PATH,
  port: PORT,
  host: HOST,
  startedAt: new Date().toISOString(),
};
state.watcherPid = spawnWatchdog(child.pid);
fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

let exitInfo = null;
child.once("exit", (code, signal) => {
  exitInfo = { code, signal };
});

const startedFrom = Date.now();
let ready = false;
while (Date.now() - startedFrom < START_BUDGET_MS) {
  if (exitInfo) {
    fs.closeSync(logFd);
    cleanupRecords();
    fail(
      `服务进程提前退出 (code ${exitInfo.code ?? exitInfo.signal})。` +
        `若日志显示端口被占: ss -ltnp 'sport = :${PORT}'\n` +
        `  日志: ${LOG_PATH}\n  日志尾部:\n${tail(LOG_PATH, 15)}`
    );
  }
  if (await probeHealth()) {
    ready = true;
    break;
  }
  await sleep(POLL_MS);
}

if (!ready) {
  // We spawned this child, so it is ours to stop — SIGTERM the direct
  // child, never anything found by port.
  const stopped = await gracefulStop(child.pid, STOP_WAIT_MS);
  fs.closeSync(logFd);
  cleanupRecords();
  fail(
    `启动超时(${START_BUDGET_MS / 1000}s)未就绪,` +
      `${stopped ? "已停止本次拉起的进程" : `停止超时,进程 ${child.pid} 可能仍在`}。\n` +
      `  日志: ${LOG_PATH}\n  日志尾部:\n${tail(LOG_PATH, 15)}`
  );
}

fs.closeSync(logFd);
console.log(
  `LinguaLeaf 已启动 (pid ${child.pid}): ${BASE_URL}\n${AUTO_STOP_HINT}`
);
