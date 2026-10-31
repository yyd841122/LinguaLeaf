// LinguaLeaf double-click launcher — stop half (WSL side). Windows entry:
// windows/lingualeaf-stop.bat. Stops only the instance this launcher owns:
// the state record is verified through /proc/<pid>/cwd before SIGTERM, and
// nothing is ever killed by port. Idempotent: nothing running exits 0.
import {
  LOCK_PATH,
  LOG_PATH,
  PORT,
  STATE_PATH,
  STOP_WAIT_MS,
  classifyState,
  gracefulStop,
  portBusy,
  readJson,
  removeRecords,
} from "./launcher-shared.mjs";

function fail(message) {
  process.stderr.write(`stop: ${message}\n`);
  process.exit(1);
}

const state = readJson(STATE_PATH);
if (!state) {
  if (await portBusy()) {
    fail(
      `没有受管实例,但端口 ${PORT} 有监听(非本启动器拉起,不予停止)。\n` +
        `  排查: ss -ltnp 'sport = :${PORT}'`
    );
  }
  console.log("没有受管实例在运行。");
  process.exit(0);
}

if (classifyState(state) !== "owned") {
  removeRecords([STATE_PATH, LOCK_PATH]);
  console.log("记录的进程已不存在(pid 失效或被复用),已清理残留记录。");
  process.exit(0);
}

if (await gracefulStop(state.pid, STOP_WAIT_MS)) {
  removeRecords([STATE_PATH, LOCK_PATH]);
  console.log(`已停止 (pid ${state.pid})。日志: ${LOG_PATH}`);
  process.exit(0);
}

fail(
  `pid ${state.pid} 在 ${STOP_WAIT_MS / 1000}s 内未退出;已保留托管记录,可重试停止,\n` +
    `  或手动处理: kill -TERM ${state.pid}。日志: ${LOG_PATH}`
);
