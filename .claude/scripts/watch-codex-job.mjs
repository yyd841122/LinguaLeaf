#!/usr/bin/env node
// Terminal-state watcher for cc-suite codex-runner background jobs (Lane B).
//
// Usage (from the repo root — the state dir is derived from cwd):
//   node .claude/scripts/watch-codex-job.mjs <jobId> [timeoutSec]
//
// Polls <stateDir>/state.json until the job reaches a terminal status, then
// prints one TERMINAL line naming the job, the status, and the result file
// (jobs/<id>.json — {rawOutput, threadId}, no status field, so it cannot
// answer "is it done" itself). Exit 0 terminal, 1 watch timeout, 2 usage.
//
// state.json shape (verified 2026-10-25, re-verified 2026-11-03):
// { version, config, jobs: [...] } — jobs is an ARRAY whose entries key on
// `id`, with status queued | running | completed | failed | stalled.
//
// Why a script instead of an inline until-loop: an inline `node -e '...'`
// condition carrying escaped quotes fed `\"` to the JS source verbatim — a
// SyntaxError whose permanently-false exit kept a watcher idle for hours
// past a job that had already completed (settle-channel 02, 2026-11-03).
// Before backgrounding, dry-run: `timeout 3 node <this> <jobId> 2` should
// exit 124 (still polling), never 0 or 1.

import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [jobId, timeoutArg] = process.argv.slice(2);
if (!jobId) {
  console.error(
    "usage: node .claude/scripts/watch-codex-job.mjs <jobId> [timeoutSec]"
  );
  process.exit(2);
}
// The runner's implement deadline defaults to 15 min; the margin covers the
// spawn cold start between job registration and the first state write.
const timeoutSec = Number(timeoutArg ?? 1260);

// cc-suite lives under the plugin cache at a versioned path; take the
// highest version present (same resolution as picking the runner path).
const cacheRoot = join(
  homedir(),
  ".claude",
  "plugins",
  "cache",
  "xiaolai",
  "cc-suite"
);
let versions;
try {
  versions = readdirSync(cacheRoot).sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
} catch {
  console.error("no cc-suite plugin cache under " + cacheRoot);
  process.exit(2);
}

let stateDir;
try {
  const state = await import(
    pathToFileURL(
      join(cacheRoot, versions.at(-1), "scripts", "lib", "state.mjs")
    )
  );
  stateDir = state.resolveStateDir(process.cwd());
} catch (error) {
  console.error(
    "cannot resolve cc-suite state dir: " + (error?.message ?? String(error))
  );
  process.exit(2);
}

const stateFile = join(stateDir, "state.json");
const TERMINAL = new Set(["completed", "failed", "stalled"]);
const start = Date.now();

function currentStatus() {
  let data;
  try {
    data = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null; // not written yet, or mid-write — keep polling
  }
  const job = Array.isArray(data.jobs)
    ? data.jobs.find((j) => j && j.id === jobId)
    : null;
  return (job && job.status) || null;
}

(function tick() {
  const status = currentStatus();
  if (status && TERMINAL.has(status)) {
    const resultFile = join(stateDir, "jobs", jobId + ".json");
    console.log("TERMINAL " + jobId + " " + status + " result=" + resultFile);
    process.exit(0);
  }
  if ((Date.now() - start) / 1000 > timeoutSec) {
    console.log("WATCHTIMEOUT " + jobId + " last=" + (status || "none"));
    process.exit(1);
  }
  setTimeout(tick, 15000);
})();
