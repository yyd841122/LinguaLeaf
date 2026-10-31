import type Database from "better-sqlite3";
import {
  failInterruptedChapterTranslations,
  failInterruptedImports,
} from "./book-store.js";

// The one lifecycle for server-side background tasks — book imports and
// on-demand chapter translations fire through the same envelope (spec:
// .scratch/server-task-lifecycle/issues/01-task-lifecycle-module.md).
// The rules both task kinds used to hand-copy live here now, once:
//
// - never-throw: the routers fire tasks without awaiting, so a task's
//   promise must never reject — a fault settles the task instead;
// - guarded settle: even the failure verdict is written inside a second
//   try/catch — a database that cannot take the settle write must not
//   turn the promise into an unhandled rejection (audit 2026-10-23);
// - the 99 ceiling: a progress report passes through `report`, which
//   clamps at 99. Retry rounds re-process work that already counted, so
//   the percent can reach its input maximum while work is still in
//   flight — 100 would be a lie until the body itself returns.
//
// Shutdown awaits drainTasks before SQLite closes (a running task gets a
// grace window to land its writes); startup calls sweepInterruptedTasks
// for tasks the previous process lost. The guarded SQL and the "already
// translating/importing" predicates stay in book-store — this module owns
// the lifecycle around them, never the rows.

// The in-flight set every background task shares. Shutdown's drain waits
// on exactly these promises instead of snapping writes mid-batch
// (audit 2026-10-23).
const inFlight = new Set<Promise<unknown>>();

export type TaskSpec = {
  // The log subject, e.g. "Import of book 3". The envelope's two log
  // lines are `${label} failed:` and `${label} could not be settled:`.
  label: string;
  // The task body. May reject — the envelope owns the fallout. `report`
  // forwards a percent (round it before calling) into `writeProgress`
  // through the 99 ceiling; without a `writeProgress` it is a no-op.
  run: (report: (percent: number) => void) => Promise<void>;
  // The failure verdict write (settle 'failed' with the task kind's
  // reason). Only ever called by the envelope, inside its own guard.
  settleFailed: () => void;
  // The live progress write for this task, if it reports progress — the
  // chapter task's guarded percent UPDATE (imports have none since
  // ADR-0004 ticket 02).
  writeProgress?: (percent: number) => void;
};

// Fires one background task under the lifecycle. Returns a promise that
// resolves when the body settles — successfully, or after the envelope
// has recorded its fault — and never rejects. The body starts running
// synchronously (the router's 202 carries state the body has already
// begun to advance).
export function fireTask(spec: TaskSpec): Promise<void> {
  const { writeProgress } = spec;
  const report = (percent: number): void => {
    writeProgress?.(Math.min(99, percent));
  };
  // The async wrapper keeps the body's synchronous start while turning a
  // synchronous throw into the rejection the catch below owns.
  const task = (async () => spec.run(report))().catch((error) => {
    console.error(`${spec.label} failed:`, error);
    try {
      spec.settleFailed();
    } catch (settleError) {
      console.error(`${spec.label} could not be settled:`, settleError);
    }
  });
  inFlight.add(task);
  return task.finally(() => {
    inFlight.delete(task);
  });
}

// Resolves when no background task is running, or after the grace
// deadline — whichever comes first. Shutdown awaits this before closing
// the database.
export function drainTasks(graceMs: number): Promise<void> {
  const running = [...inFlight];
  if (running.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let waiting = running.length;
    const settled = (): void => {
      waiting -= 1;
      if (waiting === 0) resolve();
    };
    for (const task of running) {
      task.then(settled, settled);
    }
    setTimeout(resolve, graceMs).unref();
  });
}

// The launcher watchdog's "wait for tasks" input: how many background
// tasks are in flight right now (plan.md T4 修订 — the idle stop fires
// only on page-idle AND zero in-flight tasks).
export function activeTaskCount(): number {
  return inFlight.size;
}

// Startup recovery for tasks orphaned by a server restart: any row still
// importing/translating belongs to a task that died with the previous
// process and can never resume. Must run only after the server owns its
// port — a second launch that loses the bind must not fail the first
// instance's active tasks on its way out (audit 2026-10-23). The guarded
// UPDATEs live in book-store; the pairing and the operator-facing
// warnings live here, once. A store stays quiet; this is the caller.
export function sweepInterruptedTasks(database: Database.Database): void {
  // The store sweeps and their operator-facing copy, one row per task
  // kind: a third kind adds a row, not a block.
  const sweeps: {
    sweep: (database: Database.Database) => number;
    warn: (count: number) => string;
  }[] = [
    {
      sweep: failInterruptedImports,
      warn: (count) =>
        `${count} import(s) were interrupted by a restart and are marked failed on the shelf.`,
    },
    {
      sweep: failInterruptedChapterTranslations,
      warn: (count) =>
        `${count} chapter translation(s) were interrupted by a restart and are marked failed in the reader.`,
    },
  ];
  for (const { sweep, warn } of sweeps) {
    const interrupted = sweep(database);
    if (interrupted > 0) {
      console.warn(warn(interrupted));
    }
  }
}
