import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useOwner,
  useSettle,
  type Owner,
  type SettleChannel,
} from "@lingualeaf/reading-model/react";

// The settle channel's kernel contract (settle-channel 01 接口定稿,语义
// 1-9): these claims live once here; the stations prove their own wiring
// through the shared race suite in their own files. The owner token's own
// contract stays pinned by useOwner.test — this file only assumes it.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Flush the mocked promises' state updates.
async function flush() {
  await act(async () => {});
}

function mountChannel() {
  return renderHook(() => {
    const owner = useOwner();
    const settle = useSettle(owner);
    return { owner, settle } as {
      owner: Owner;
      settle: SettleChannel;
    };
  });
}

afterEach(() => {
  cleanup();
});

describe("useSettle kernel contract", () => {
  it("sends the op regardless of the verdict; a stale success writes nothing", async () => {
    const { result } = mountChannel();
    const ticket = result.current.owner.mark();
    act(() => result.current.owner.invalidate());
    const onLanded = vi.fn();
    const onFresh = vi.fn();
    const d = deferred<number>();
    const pending = result.current.settle.run(d.promise, {
      ticket,
      onLanded,
      onFresh,
    });
    d.resolve(7);
    await flush();
    expect(await pending).toEqual({ ok: true, value: 7, fresh: false });
    // 先落页:陈旧也调恰一次。
    expect(onLanded).toHaveBeenCalledExactlyOnceWith(7);
    expect(onFresh).not.toHaveBeenCalled();
    expect(result.current.settle.failed).toBe(false);
  });

  it("does not invalidate implicitly: the losing 409 may speak before the winning 202", async () => {
    const { result } = mountChannel();
    const loser = deferred<void>();
    const winner = deferred<void>();
    void result.current.settle.run(loser.promise);
    void result.current.settle.run(winner.promise);
    await act(async () => loser.reject(new Error("409")));
    expect(result.current.settle.failed).toBe(true);
    await act(async () => winner.resolve(undefined));
    expect(result.current.settle.failed).toBe(false);
  });

  it("success sequence is landed → verdict → (fresh) clear + fresh, each once", async () => {
    const { result } = mountChannel();
    const order: string[] = [];
    const freshTicket = result.current.owner.mark();
    const d1 = deferred<number>();
    const p1 = result.current.settle.run(d1.promise, {
      ticket: freshTicket,
      onLanded: (v) => order.push(`landed:${v}`),
      onFresh: (v) => order.push(`fresh:${v}`),
    });
    d1.resolve(1);
    await flush();
    await p1;
    expect(order).toEqual(["landed:1", "fresh:1"]);
    expect(result.current.settle.failed).toBe(false);

    // Stale round: landed still fires, fresh does not.
    const ticket = result.current.owner.mark();
    act(() => result.current.owner.invalidate());
    const d2 = deferred<number>();
    const p2 = result.current.settle.run(d2.promise, {
      ticket,
      onLanded: (v) => order.push(`landed:${v}`),
      onFresh: (v) => order.push(`fresh:${v}`),
    });
    d2.resolve(2);
    await flush();
    await p2;
    expect(order).toEqual(["landed:1", "fresh:1", "landed:2"]);
  });

  it("a fresh failure raises the flag; a stale failure does not", async () => {
    const { result } = mountChannel();
    const d1 = deferred<void>();
    void result.current.settle.run(d1.promise);
    await act(async () => d1.reject(new Error("gone")));
    expect(result.current.settle.failed).toBe(true);

    const ticket = result.current.owner.mark();
    act(() => result.current.owner.invalidate());
    const d2 = deferred<void>();
    const p2 = result.current.settle.run(d2.promise, { ticket });
    await act(async () => d2.reject(new Error("late")));
    expect(await p2).toEqual({ ok: false, fresh: false });
    expect(result.current.settle.failed).toBe(true);
  });

  it("run start never clears the flag — arm-clear is the caller's explicit clear()", async () => {
    const { result } = mountChannel();
    const d1 = deferred<void>();
    void result.current.settle.run(d1.promise);
    await act(async () => d1.reject(new Error("gone")));
    expect(result.current.settle.failed).toBe(true);

    // A new arm with the flag still lit: run's start must leave it alone
    // (Q6=B — a poll's outage may not flicker per tick, a create's flag
    // may not blink at op start).
    const d2 = deferred<number>();
    void result.current.settle.run(d2.promise);
    expect(result.current.settle.failed).toBe(true);

    await act(async () => d2.resolve(3));
    expect(result.current.settle.failed).toBe(false);
  });

  it("clear() is the intent-side write and works regardless of any ticket", async () => {
    const { result } = mountChannel();
    const d = deferred<void>();
    void result.current.settle.run(d.promise);
    await act(async () => d.reject(new Error("gone")));
    expect(result.current.settle.failed).toBe(true);
    act(() => result.current.settle.clear());
    expect(result.current.settle.failed).toBe(false);
  });

  it("explicit null ticket: the op runs, nothing is written, hooks are skipped", async () => {
    const { result } = mountChannel();
    const onLanded = vi.fn();
    const onFresh = vi.fn();
    const d1 = deferred<number>();
    const p1 = result.current.settle.run(d1.promise, {
      ticket: null,
      onLanded,
      onFresh,
    });
    d1.resolve(1);
    await flush();
    expect(await p1).toEqual({ ok: true, value: 1, fresh: false });
    expect(onLanded).not.toHaveBeenCalled();
    expect(onFresh).not.toHaveBeenCalled();
    expect(result.current.settle.failed).toBe(false);

    const d2 = deferred<void>();
    const p2 = result.current.settle.run(d2.promise, { ticket: null });
    await act(async () => d2.reject(new Error("gone")));
    expect(await p2).toEqual({ ok: false, fresh: false });
    expect(result.current.settle.failed).toBe(false);
  });

  it("hook throws reject the run promise without rolling back adjudicated writes", async () => {
    const { result } = mountChannel();
    // landed throws: the verdict is never reached, the flag untouched.
    const d1 = deferred<number>();
    const p1 = result.current.settle.run(d1.promise, {
      onLanded: () => {
        throw new Error("boom");
      },
      onFresh: () => {
        throw new Error("never");
      },
    });
    d1.resolve(1);
    await expect(p1).rejects.toThrow("boom");
    expect(result.current.settle.failed).toBe(false);

    // fresh throws: the flag has already cleared (write not rolled back).
    const d2 = deferred<number>();
    const p2 = result.current.settle.run(d2.promise, {
      onFresh: () => {
        throw new Error("late");
      },
    });
    d2.resolve(2);
    await expect(p2).rejects.toThrow("late");
    expect(result.current.settle.failed).toBe(false);
  });

  it("an omitted ticket mints at op start and stales on invalidate", async () => {
    const { result } = mountChannel();
    const onFresh = vi.fn();
    const d = deferred<number>();
    const pending = result.current.settle.run(d.promise, { onFresh });
    act(() => result.current.owner.invalidate());
    d.resolve(1);
    await flush();
    expect(await pending).toEqual({ ok: true, value: 1, fresh: false });
    expect(onFresh).not.toHaveBeenCalled();

    // The contrast case: without the invalidate the mint stays fresh and
    // the round lands.
    const d2 = deferred<number>();
    const pending2 = result.current.settle.run(d2.promise, { onFresh });
    d2.resolve(2);
    await flush();
    expect(await pending2).toEqual({ ok: true, value: 2, fresh: true });
    expect(onFresh).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("run/clear keep their identity across renders and flag flips", async () => {
    const view = mountChannel();
    const first = view.result.current;
    view.rerender();
    expect(
      Object.is(view.result.current.settle.clear, first.settle.clear)
    ).toBe(true);
    expect(Object.is(view.result.current.settle.run, first.settle.run)).toBe(
      true
    );

    const d = deferred<void>();
    void view.result.current.settle.run(d.promise);
    await act(async () => d.reject(new Error("gone")));
    expect(view.result.current.settle.failed).toBe(true);
    expect(Object.is(view.result.current.settle.run, first.settle.run)).toBe(
      true
    );
    expect(
      Object.is(view.result.current.settle.clear, first.settle.clear)
    ).toBe(true);
  });
});
