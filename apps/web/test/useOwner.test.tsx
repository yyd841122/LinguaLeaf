import { useLayoutEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOwner, type OwnerTicket } from "../src/useOwner";

// The owner-token contract (spec: .scratch/owner-token/spec.md). Page tests
// keep pinning each consumer's behavior unchanged through the extraction.
describe("useOwner", () => {
  it("allows a landing async write while the key is unchanged", async () => {
    const { result, rerender } = renderHook(
      ({ bookId, chapterNumber }) => useOwner(bookId, chapterNumber),
      { initialProps: { bookId: 7, chapterNumber: 2 } }
    );
    const ticket = result.current.mark();
    const write = vi.fn();

    rerender({ bookId: 7, chapterNumber: 2 });
    expect(ticket.stale()).toBe(false);
    await act(async () => {
      await Promise.resolve();
      if (!ticket.stale()) write("landed");
    });
    expect(write).toHaveBeenCalledExactlyOnceWith("landed");
  });

  it.each([
    { bookId: 8, chapterNumber: 2 },
    { bookId: 7, chapterNumber: 3 },
  ])("discards earlier tickets when a key part changes to %o", (route) => {
    const { result, rerender } = renderHook(
      ({ bookId, chapterNumber }) => useOwner(bookId, chapterNumber),
      { initialProps: { bookId: 7, chapterNumber: 2 } }
    );
    const ticket = result.current.mark();

    rerender(route);
    expect(ticket.stale()).toBe(true);
    expect(result.current.mark().stale()).toBe(false);
  });

  it("treats NaN as unchanged", () => {
    const { result, rerender } = renderHook(({ key }) => useOwner(key), {
      initialProps: { key: NaN },
    });
    const ticket = result.current.mark();

    rerender({ key: NaN });
    expect(ticket.stale()).toBe(false);
  });

  it.each([
    [0, -0],
    [-0, 0],
  ])("treats %s to %s as a key change", (before, after) => {
    const { result, rerender } = renderHook(({ key }) => useOwner(key), {
      initialProps: { key: before },
    });
    const ticket = result.current.mark();

    rerender({ key: after });
    expect(ticket.stale()).toBe(true);
  });

  it("compares object key parts by identity", () => {
    const key = { bookId: 7 };
    const { result, rerender } = renderHook(({ key }) => useOwner(key), {
      initialProps: { key },
    });
    const ticket = result.current.mark();

    rerender({ key });
    expect(ticket.stale()).toBe(false);
    rerender({ key: { bookId: 7 } });
    expect(ticket.stale()).toBe(true);
  });

  it("treats adding or removing even an undefined key part as a change", () => {
    const initialProps: { parts: unknown[] } = { parts: [7] };
    const { result, rerender } = renderHook(
      ({ parts }: { parts: unknown[] }) => useOwner(...parts),
      { initialProps }
    );
    const shorter = result.current.mark();

    rerender({ parts: [7, undefined] });
    expect(shorter.stale()).toBe(true);
    const longer = result.current.mark();
    rerender({ parts: [7] });
    expect(longer.stale()).toBe(true);
  });

  it("invalidates every earlier ticket while later tickets start fresh", () => {
    const { result, rerender } = renderHook(() => useOwner("woke"));
    const first = result.current.mark();
    const second = result.current.mark();
    const invalidate = result.current.invalidate;

    rerender();
    expect(result.current.invalidate).toBe(invalidate);
    act(() => invalidate());
    expect(first.stale()).toBe(true);
    expect(second.stale()).toBe(true);
    const next = result.current.mark();
    expect(next.stale()).toBe(false);

    act(() => invalidate());
    expect(first.stale()).toBe(true);
    expect(next.stale()).toBe(true);
    expect(result.current.mark().stale()).toBe(false);
  });

  it("marks the latest rendered key from callbacks, before passive effects", () => {
    const onRender = vi.fn<(ticket: OwnerTicket) => void>();
    const { result, rerender } = renderHook(
      ({ word }) => {
        const owner = useOwner(word);
        useLayoutEffect(() => {
          onRender(owner.mark());
        }, [owner, word]);
        return owner;
      },
      { initialProps: { word: "woke" } }
    );
    const start = result.current.mark;
    const earlier = start();

    rerender({ word: "book" });
    expect(earlier.stale()).toBe(true);
    expect(onRender).toHaveBeenCalledTimes(2);
    const duringLayout = onRender.mock.lastCall?.[0];
    expect(duringLayout?.stale()).toBe(false);
    const latest = start();
    expect(latest.stale()).toBe(false);

    rerender({ word: "read" });
    expect(duringLayout?.stale()).toBe(true);
    expect(latest.stale()).toBe(true);
  });

  it("keeps an empty-key ticket fresh across rerenders until invalidate", () => {
    const { result, rerender } = renderHook(() => useOwner());
    const owner = result.current;
    const ticket = result.current.mark();

    rerender();
    rerender();
    expect(result.current).toBe(owner);
    expect(ticket.stale()).toBe(false);
    act(() => result.current.invalidate());
    expect(ticket.stale()).toBe(true);
    expect(result.current.mark().stale()).toBe(false);
  });
});
