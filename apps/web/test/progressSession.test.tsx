import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProgressSession } from "../src/progressSession";
import {
  fetchReadingProgress,
  saveReadingProgress,
  type ReadingProgress,
} from "../src/readingProgress";

// Pin the session mechanics at the hook boundary, keeping the real DOM
// position helper. The unchanged reading.test.tsx pins page behavior and
// the helpers' HTTP contracts, including bodyless successful PUTs.
vi.mock("../src/readingProgress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/readingProgress")>()),
  fetchReadingProgress: vi.fn(),
  saveReadingProgress: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function actAdvance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const route = { bookId: 7, chapterNumber: 2, ready: true };
const jump = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  "scrollIntoView"
);
let visibleBlock: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(fetchReadingProgress).mockResolvedValue(null);
  vi.mocked(saveReadingProgress).mockResolvedValue(undefined);
  window.HTMLElement.prototype.scrollIntoView = jump;
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

  visibleBlock = 1;
  const blocks = document.createElement("div");
  blocks.className = "blocks";
  for (const position of [1, 2, 3]) {
    const block = document.createElement("div");
    block.dataset.position = String(position);
    vi.spyOn(block, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, (position - visibleBlock) * 100, 100, 100)
    );
    blocks.append(block);
  }
  document.body.append(blocks);
});

afterEach(() => {
  cleanup();
  document.querySelector(".blocks")?.remove();
  vi.restoreAllMocks();
  if (originalScrollIntoView) {
    Object.defineProperty(
      window.HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView
    );
  } else {
    Reflect.deleteProperty(window.HTMLElement.prototype, "scrollIntoView");
  }
  vi.useRealTimers();
});

describe("useProgressSession restore and chapter start", () => {
  it("waits for ready before restoring or arming saves", async () => {
    vi.mocked(fetchReadingProgress).mockResolvedValue({ chapter: 2, block: 3 });
    const { rerender } = renderHook(useProgressSession, {
      initialProps: { ...route, ready: false },
    });

    await actAdvance(1000);
    fireEvent.scroll(window);
    expect(fetchReadingProgress).toHaveBeenCalledWith(7);
    expect(jump).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(saveReadingProgress).not.toHaveBeenCalled();

    rerender(route);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump.mock.instances[0]).toBe(
      document.querySelector('.blocks [data-position="3"]')
    );
    expect(window.scrollTo).not.toHaveBeenCalled();
    await actAdvance(1000);
    expect(saveReadingProgress).not.toHaveBeenCalled();
  });

  it("waits for progress even when the chapter is already ready", async () => {
    const pending = deferred<ReadingProgress | null>();
    vi.mocked(fetchReadingProgress).mockReturnValue(pending.promise);
    renderHook(() => useProgressSession(route));

    await actAdvance(1000);
    fireEvent.scroll(window);
    expect(jump).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(saveReadingProgress).not.toHaveBeenCalled();

    await act(async () => pending.resolve({ chapter: 2, block: 3 }));
    expect(jump.mock.instances[0]).toBe(
      document.querySelector('.blocks [data-position="3"]')
    );
    await actAdvance(1000);
    expect(saveReadingProgress).not.toHaveBeenCalled();
  });

  it("starts at the top for another chapter and saves chapter start first", async () => {
    vi.mocked(fetchReadingProgress).mockResolvedValue({ chapter: 1, block: 3 });
    renderHook(() => useProgressSession(route));

    await actAdvance(0);
    expect(jump).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    await actAdvance(499);
    expect(saveReadingProgress).not.toHaveBeenCalled();
    await actAdvance(1);
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 1,
    });
  });

  it.each([
    { name: "no saved progress", progress: null },
    { name: "block one", progress: { chapter: 2, block: 1 } },
    { name: "a missing saved block", progress: { chapter: 2, block: 99 } },
  ])("starts at the top for $name", async ({ progress }) => {
    vi.mocked(fetchReadingProgress).mockResolvedValue(progress);
    renderHook(() => useProgressSession(route));

    await actAdvance(0);
    await actAdvance(500);
    expect(jump).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 1,
    });
  });

  it("swallows the restore jump's scroll events for 250ms", async () => {
    vi.mocked(fetchReadingProgress).mockResolvedValue({ chapter: 2, block: 3 });
    renderHook(() => useProgressSession(route));

    await actAdvance(0);
    expect(jump).toHaveBeenCalledTimes(1);
    fireEvent.scroll(window);
    await actAdvance(249);
    fireEvent.scroll(window);
    fireEvent.pageHide(window);
    expect(saveReadingProgress).not.toHaveBeenCalled();

    await actAdvance(1);
    // Clearing the guard alone does not announce chapter start.
    fireEvent.pageHide(window);
    expect(saveReadingProgress).not.toHaveBeenCalled();
    visibleBlock = 2;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 2,
    });
  });

  it("clears the restore guard timer on unmount", async () => {
    vi.mocked(fetchReadingProgress).mockResolvedValue({ chapter: 2, block: 3 });
    const { unmount } = renderHook(() => useProgressSession(route));
    await actAdvance(0);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(saveReadingProgress).not.toHaveBeenCalled();
  });
});

describe("useProgressSession autosave", () => {
  it("coalesces a scroll burst into the latest position after 500ms", async () => {
    renderHook(() => useProgressSession(route));
    await actAdvance(0);

    await actAdvance(100);
    visibleBlock = 2;
    fireEvent.scroll(window);
    await actAdvance(400);
    visibleBlock = 3;
    fireEvent.scroll(window);
    await actAdvance(499);
    expect(saveReadingProgress).not.toHaveBeenCalled();
    await actAdvance(1);
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 3,
    });
  });

  it("flushes the pending position on unmount and removes its listeners", async () => {
    const { unmount } = renderHook(() => useProgressSession(route));
    await actAdvance(0);
    visibleBlock = 2;
    fireEvent.scroll(window);
    await actAdvance(499);
    expect(saveReadingProgress).not.toHaveBeenCalled();

    unmount();
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 2,
    });
    fireEvent.scroll(window);
    fireEvent.pageHide(window);
    await actAdvance(1000);
    expect(saveReadingProgress).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes once on pagehide and continues following later scrolls", async () => {
    renderHook(() => useProgressSession(route));
    await actAdvance(0);
    visibleBlock = 2;
    fireEvent.scroll(window);
    fireEvent.pageHide(window);
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 2,
    });

    fireEvent.pageHide(window);
    await actAdvance(1000);
    expect(saveReadingProgress).toHaveBeenCalledTimes(1);
    visibleBlock = 3;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(saveReadingProgress).toHaveBeenCalledTimes(2);
    expect(saveReadingProgress).toHaveBeenLastCalledWith(7, {
      chapter: 2,
      block: 3,
    });
  });

  it("parks unavailable progress until a real scroll produces a position", async () => {
    vi.mocked(fetchReadingProgress).mockRejectedValue(new Error("server gone"));
    renderHook(() => useProgressSession(route));
    await actAdvance(1000);
    expect(jump).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    fireEvent.pageHide(window);
    expect(saveReadingProgress).not.toHaveBeenCalled();

    // A scroll with no measurable block still has nothing to save.
    visibleBlock = 4;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(saveReadingProgress).not.toHaveBeenCalled();

    visibleBlock = 2;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 2,
    });
  });

  it("sets saveFailed on failure and clears it only when a save lands", async () => {
    const pending = deferred<void>();
    vi.mocked(saveReadingProgress)
      .mockRejectedValueOnce(new Error("save failed"))
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useProgressSession(route));
    expect(result.current.saveFailed).toBe(false);

    await actAdvance(0);
    await actAdvance(500);
    expect(result.current.saveFailed).toBe(true);
    await actAdvance(1000);
    expect(saveReadingProgress).toHaveBeenCalledTimes(1);

    visibleBlock = 2;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(saveReadingProgress).toHaveBeenCalledTimes(2);
    expect(result.current.saveFailed).toBe(true);

    await act(async () => pending.resolve());
    expect(result.current.saveFailed).toBe(false);
    await actAdvance(1000);
    expect(saveReadingProgress).toHaveBeenCalledTimes(2);
  });
});

describe("useProgressSession save feedback ownership", () => {
  it("still flushes the old route's save on a route change, but its late failure cannot set the new route's notice", async () => {
    const staleFlush = deferred<void>();
    vi.mocked(saveReadingProgress)
      .mockReturnValueOnce(staleFlush.promise)
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(useProgressSession, {
      initialProps: route,
    });
    await actAdvance(0);
    visibleBlock = 2;
    fireEvent.scroll(window);

    rerender({ ...route, bookId: 8 });
    // The flush itself still writes: ownership governs the notice, not the save.
    expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
      chapter: 2,
      block: 2,
    });
    await actAdvance(1000);
    expect(result.current.saveFailed).toBe(false);

    await act(async () => staleFlush.reject(new Error("late, old route")));
    expect(result.current.saveFailed).toBe(false);
  });

  it("a stale success cannot clear the new route's notice", async () => {
    const staleFlush = deferred<void>();
    vi.mocked(saveReadingProgress)
      .mockReturnValueOnce(staleFlush.promise)
      .mockRejectedValueOnce(new Error("book 8 announce failed"))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(useProgressSession, {
      initialProps: route,
    });
    await actAdvance(0);
    visibleBlock = 2;
    fireEvent.scroll(window);

    rerender({ ...route, bookId: 8 });
    await actAdvance(0); // book 8's refetch settles and its session arms
    await actAdvance(1000);
    // Book 8's own save failed: the notice is its route's now.
    expect(result.current.saveFailed).toBe(true);

    await act(async () => staleFlush.resolve());
    expect(result.current.saveFailed).toBe(true);

    // The next save this route lands clears it.
    visibleBlock = 3;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(result.current.saveFailed).toBe(false);
  });

  it("leaving and re-entering a route does not revive its first pass's feedback", async () => {
    const firstPassFlush = deferred<void>();
    vi.mocked(saveReadingProgress)
      .mockReturnValueOnce(firstPassFlush.promise)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("current pass"))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(useProgressSession, {
      initialProps: route,
    });
    await actAdvance(0);
    visibleBlock = 2;
    fireEvent.scroll(window);

    rerender({ ...route, bookId: 8 });
    await actAdvance(0);
    await actAdvance(1000);
    rerender(route);
    await actAdvance(0); // re-entry's refetch settles and its session arms
    await actAdvance(1000);
    expect(result.current.saveFailed).toBe(false);

    // The first pass's flush rejects after re-entry: key comparison alone
    // would revive its ticket, so the arm invalidates instead.
    await act(async () => firstPassFlush.reject(new Error("first pass")));
    expect(result.current.saveFailed).toBe(false);

    // The current pass's own failure still reports honestly.
    visibleBlock = 3;
    fireEvent.scroll(window);
    await actAdvance(500);
    expect(result.current.saveFailed).toBe(true);
  });
});

describe("useProgressSession route ownership", () => {
  it.each([
    { name: "chapter", next: { ...route, chapterNumber: 3 } },
    { name: "book", next: { ...route, bookId: 8 } },
  ])(
    "resets and refetches on a $name change, flushing the old route",
    async ({ next }) => {
      const pending = deferred<ReadingProgress | null>();
      vi.mocked(fetchReadingProgress)
        .mockResolvedValueOnce({ chapter: 2, block: 3 })
        .mockReturnValueOnce(pending.promise);
      const { rerender } = renderHook(useProgressSession, {
        initialProps: route,
      });
      await actAdvance(0);
      await actAdvance(250);
      visibleBlock = 2;
      fireEvent.scroll(window);

      rerender(next);
      expect(vi.mocked(fetchReadingProgress).mock.calls).toEqual([
        [7],
        [next.bookId],
      ]);
      expect(saveReadingProgress).toHaveBeenCalledExactlyOnceWith(7, {
        chapter: 2,
        block: 2,
      });
      await actAdvance(1000);
      fireEvent.scroll(window);
      fireEvent.pageHide(window);
      expect(jump).toHaveBeenCalledTimes(1);
      expect(window.scrollTo).not.toHaveBeenCalled();
      expect(saveReadingProgress).toHaveBeenCalledTimes(1);

      await act(async () => pending.resolve(null));
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
      await actAdvance(500);
      expect(saveReadingProgress).toHaveBeenCalledTimes(2);
      expect(saveReadingProgress).toHaveBeenLastCalledWith(next.bookId, {
        chapter: next.chapterNumber,
        block: 1,
      });
    }
  );

  it("discards a progress response arriving after its route was left", async () => {
    const stale = deferred<ReadingProgress | null>();
    vi.mocked(fetchReadingProgress)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ chapter: 3, block: 2 });
    const { rerender } = renderHook(useProgressSession, {
      initialProps: route,
    });
    rerender({ ...route, chapterNumber: 3 });
    await actAdvance(0);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump.mock.instances[0]).toBe(
      document.querySelector('.blocks [data-position="2"]')
    );

    await act(async () => stale.resolve({ chapter: 3, block: 3 }));
    await actAdvance(1000);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(saveReadingProgress).not.toHaveBeenCalled();
  });
});

// Pinned, not endorsed (CODING_STANDARDS, "Reviews pin unreachable
// behavior instead of changing it"): the Number.isInteger guard at the top
// of the fetch effect keeps a garbage route inert. No current caller
// reaches it — ReadingPage rejects non-integer route params before the
// reading view renders — so the guard's reach is a contract, not a lived
// behavior. This is the test that flips if the guard is ever deliberately
// removed: without it, the hook would fire the progress fetch (and arm
// saves) for a NaN route.
describe("useProgressSession non-integer route guard (pinned)", () => {
  it.each([
    { name: "book id", badRoute: { bookId: Number("x"), chapterNumber: 2 } },
    { name: "chapter number", badRoute: { bookId: 7, chapterNumber: 1.5 } },
  ])(
    "keeps a non-integer $name inert: no fetch, no restore, no saves",
    async ({ badRoute }) => {
      renderHook(() => useProgressSession({ ...badRoute, ready: true }));
      await actAdvance(1000);
      fireEvent.scroll(window);
      await actAdvance(1000);

      expect(fetchReadingProgress).not.toHaveBeenCalled();
      expect(saveReadingProgress).not.toHaveBeenCalled();
      expect(jump).not.toHaveBeenCalled();
      expect(window.scrollTo).not.toHaveBeenCalled();
    }
  );
});
