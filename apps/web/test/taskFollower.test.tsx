import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskFollower } from "../src/taskFollower";

// The task-follower seam (spec: .scratch/task-follower/spec.md 决策 4):
// these tests pin the mechanics — interval cadence, stale-tick discard,
// outage escalation + recovery — that the two pages used to hand-roll.
// User-visible behavior (notice copy, button states) stays pinned by the
// page tests, which keep running unchanged through the adoption.

const INTERVAL = 1500;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// React state changes land only inside act: run whatever timers are due
// and flush the promise queue under act, the pages' tests' same discipline.
async function actAdvance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskFollower", () => {
  it("follows while active: first tick after intervalMs, fresh data to onTick", async () => {
    const fetchTick = vi
      .fn<() => Promise<{ n: number }>>()
      .mockResolvedValueOnce({ n: 1 })
      .mockResolvedValueOnce({ n: 2 });
    const onTick = vi.fn();
    const { result } = renderHook(() =>
      useTaskFollower({ active: true, fetchTick, onTick, intervalMs: INTERVAL })
    );

    await actAdvance(INTERVAL - 1);
    expect(fetchTick).not.toHaveBeenCalled();
    await actAdvance(1);
    expect(fetchTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith({ n: 1 });

    await actAdvance(INTERVAL);
    expect(fetchTick).toHaveBeenCalledTimes(2);
    expect(onTick).toHaveBeenLastCalledWith({ n: 2 });
    expect(result.current.outage).toBe(false);
  });

  it("stops following when active flips false", async () => {
    const fetchTick = vi
      .fn<() => Promise<{ n: number }>>()
      .mockResolvedValue({ n: 1 });
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ active }) =>
        useTaskFollower({ active, fetchTick, onTick, intervalMs: INTERVAL }),
      { initialProps: { active: true } }
    );

    await actAdvance(INTERVAL);
    expect(fetchTick).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    await actAdvance(INTERVAL * 5);
    expect(fetchTick).toHaveBeenCalledTimes(1);
  });

  it("discards a tick that was in flight when invalidate() fired", async () => {
    const pending = deferred<{ n: number }>();
    const fetchTick = vi
      .fn<() => Promise<{ n: number }>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ n: 2 });
    const onTick = vi.fn();
    const { result } = renderHook(() =>
      useTaskFollower({ active: true, fetchTick, onTick, intervalMs: INTERVAL })
    );

    await actAdvance(INTERVAL);
    expect(fetchTick).toHaveBeenCalledTimes(1);

    // A mutation lands while the tick is in flight: the snapshot predating
    // it must not patch the page.
    act(() => result.current.invalidate());
    await act(async () => pending.resolve({ n: 1 }));
    expect(onTick).not.toHaveBeenCalled();

    // The next tick is fresh and lands normally.
    await actAdvance(INTERVAL);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith({ n: 2 });
  });
});

describe("useTaskFollower outage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lights outage on a failed tick without touching page data, clears when one lands", async () => {
    const pending = deferred<{ n: number }>();
    const fetchTick = vi
      .fn<() => Promise<{ n: number }>>()
      .mockRejectedValueOnce(new Error("server gone"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ n: 3 });
    const onTick = vi.fn();
    const { result } = renderHook(() =>
      useTaskFollower({ active: true, fetchTick, onTick, intervalMs: INTERVAL })
    );

    // A failed tick escalates but never patches.
    await actAdvance(INTERVAL);
    expect(onTick).not.toHaveBeenCalled();
    expect(result.current.outage).toBe(true);

    // The next tick is still in flight: outage stays lit, no patch yet.
    await actAdvance(INTERVAL);
    expect(result.current.outage).toBe(true);

    // A landed tick is the outage's recovery.
    await act(async () => pending.resolve({ n: 2 }));
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith({ n: 2 });
    expect(result.current.outage).toBe(false);

    // And the loop keeps following.
    await actAdvance(INTERVAL);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick).toHaveBeenLastCalledWith({ n: 3 });
    expect(result.current.outage).toBe(false);
  });

  it("starts each fresh follow with a clean outage slate", async () => {
    const fetchTick = vi
      .fn<() => Promise<{ n: number }>>()
      .mockRejectedValueOnce(new Error("server gone"))
      .mockResolvedValue({ n: 1 });
    const onTick = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) =>
        useTaskFollower({ active, fetchTick, onTick, intervalMs: INTERVAL }),
      { initialProps: { active: true } }
    );

    await actAdvance(INTERVAL);
    expect(result.current.outage).toBe(true);

    // The follow tears down and re-arms (a route change does this): the
    // new follow must not inherit the old one's outage.
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.outage).toBe(false);

    await actAdvance(INTERVAL);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(result.current.outage).toBe(false);
  });
});
