import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainTasks, fireTask } from "../src/task-lifecycle.js";

// Direct lifecycle tests: no database, no domain — the envelope is
// domain-free, so a planted body (fireTask's seam for tests) is the whole
// fixture. These pin what only the lifecycle level can prove: the drain
// holds any in-flight task and honours its grace deadline, a fault
// settles through settleFailed without the promise ever rejecting, the
// settle write itself is guarded, and progress reports clamp at the 99
// ceiling. The task kinds' own suites (import-task, chapter-task) pin
// the verdicts; api.test.ts pins the wire-level percent steps.

describe("fireTask envelope", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("a body fault settles failed and the fired promise still resolves", async () => {
    const settleFailed = vi.fn();
    await expect(
      fireTask({
        label: "Task 7",
        run: () => Promise.reject(new Error("boom")),
        settleFailed,
      })
    ).resolves.toBeUndefined();
    expect(settleFailed).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Task 7 failed:", expect.any(Error));
  });

  it("a synchronous body throw is the same fault as a rejection", async () => {
    const settleFailed = vi.fn();
    await expect(
      fireTask({
        label: "Task 8",
        run: () => {
          throw new Error("sync boom");
        },
        settleFailed,
      })
    ).resolves.toBeUndefined();
    expect(settleFailed).toHaveBeenCalledTimes(1);
  });

  it("a settle write that cannot land is swallowed and logged, not rethrown", async () => {
    const settleFailed = vi.fn(() => {
      throw new Error("settle boom");
    });
    await expect(
      fireTask({
        label: "Task 9",
        run: () => Promise.reject(new Error("boom")),
        settleFailed,
      })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "Task 9 could not be settled:",
      expect.any(Error)
    );
  });

  it("a clean body never touches the failure verdict", async () => {
    const settleFailed = vi.fn();
    await expect(
      fireTask({
        label: "Task 10",
        run: () => Promise.resolve(),
        settleFailed,
      })
    ).resolves.toBeUndefined();
    expect(settleFailed).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("progress reports clamp at the 99 ceiling, untouched values pass", async () => {
    const written: number[] = [];
    await fireTask({
      label: "Task 11",
      writeProgress: (percent) => written.push(percent),
      run: async (report) => {
        report(44);
        report(99);
        // Retry rounds can push the raw ratio to its maximum while work
        // is still in flight — the envelope owns the honest ceiling.
        report(100);
        report(100);
      },
      settleFailed: () => {},
    });
    expect(written).toEqual([44, 99, 99, 99]);
  });

  it("without a progress write, reporting is a no-op", async () => {
    await expect(
      fireTask({
        label: "Task 12",
        run: (report) => {
          report(100);
          return Promise.resolve();
        },
        settleFailed: () => {},
      })
    ).resolves.toBeUndefined();
  });
});

describe("drainTasks", () => {
  it("holds while a planted task is in flight, resolves when it settles", async () => {
    let release!: () => void;
    const parked = fireTask({
      label: "Parked",
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      settleFailed: () => {},
    });

    let drained = false;
    const draining = drainTasks(10_000).then(() => {
      drained = true;
    });
    await Promise.resolve();
    // Still in flight: the drain holds (its grace deadline is far away).
    expect(drained).toBe(false);

    release();
    await parked;
    await draining;
    expect(drained).toBe(true);
  });

  it("resolves at the grace deadline even with the task still parked", async () => {
    let release!: () => void;
    const parked = fireTask({
      label: "Pasted deadline",
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      settleFailed: () => {},
    });

    // The grace window wins: shutdown must reach the database close even
    // when a task never settles.
    await drainTasks(10);

    release();
    await parked;
  });
});
