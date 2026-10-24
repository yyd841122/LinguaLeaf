// Gate check for the task-lifecycle module (.scratch/
// server-task-lifecycle/issues/01-task-lifecycle-module.md): background
// tasks fire through task-lifecycle.ts's fireTask, whose envelope owns
// never-throw, the guarded settle, and the 99 ceiling. A second hand-
// rolled in-flight tracker — the disease that ticket cured, when
// import-task and chapter-task each carried one — splits those rules
// again. The tracker's fingerprint (a Set of promises, or the deleted
// createTaskTracker factory) fails the build anywhere outside the
// module. A differently shaped tracker slips past this fingerprint; the
// architecture-review cadence is the net for that. Wired into the root
// `verify` chain and the pre-commit hook.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED = new Set(["task-lifecycle.ts"]);
const TRACKER_FINGERPRINT = /\bnew Set<Promise\b|\bcreateTaskTracker\b/;

const offenders = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (entry.name.endsWith(".ts") && !ALLOWED.has(entry.name)) {
      const hit = readFileSync(path, "utf8").match(TRACKER_FINGERPRINT);
      if (hit) {
        offenders.push(`${path}: ${hit[0]}`);
      }
    }
  }
};
walk(srcDir);

if (offenders.length > 0) {
  console.error(
    [
      "A hand-rolled background-task tracker found outside",
      "task-lifecycle.ts — fire the task through fireTask instead: the",
      "envelope owns never-throw, the guarded settle, and the 99",
      "ceiling, and a second tracker splits those rules again.",
      ...offenders,
    ].join("\n")
  );
  process.exitCode = 1;
}
