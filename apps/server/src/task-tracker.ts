// The in-flight set both background-task kinds share (book imports, chapter
// translations): `run` tracks a fired task, `drain` resolves when every
// tracked task has settled or the grace deadline passes — whichever comes
// first. Shutdown awaits the drain before SQLite closes instead of snapping
// writes mid-batch (audit 2026-10-23).

export type TaskTracker = {
  run: <T>(task: Promise<T>) => Promise<T>;
  drain: (graceMs: number) => Promise<void>;
};

export function createTaskTracker(): TaskTracker {
  const inFlight = new Set<Promise<unknown>>();
  return {
    run<T>(task: Promise<T>): Promise<T> {
      inFlight.add(task);
      return task.finally(() => {
        inFlight.delete(task);
      });
    },
    drain(graceMs: number): Promise<void> {
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
    },
  };
}
