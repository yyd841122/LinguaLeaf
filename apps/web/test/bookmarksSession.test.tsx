import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookmarksSession } from "../src/bookmarksSession";
import { captureBookmarkTarget } from "../src/readingProgress";
import {
  createBookmark,
  deleteBookmark,
  fetchBookmarks,
} from "../src/bookmarks";
import type { BookmarkSummary } from "../../server/src/wire";

// Pin the session at the helper boundary, keeping the real DOM capture
// helper. The unchanged reading.test.tsx and the 01 contract suite pin the
// helpers' HTTP contracts.
vi.mock("../src/bookmarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bookmarks")>()),
  fetchBookmarks: vi.fn(),
  createBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
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

const row = (id: number, chapter: number, block: number): BookmarkSummary => ({
  id,
  chapter,
  block,
  createdAt: "2026-10-31T00:00:00.000Z",
});

// Flush the mocked promises' state updates.
async function settle() {
  await act(async () => {});
}

let visibleBlock: number;

beforeEach(() => {
  vi.resetAllMocks();
  visibleBlock = 1;
});

afterEach(() => {
  cleanup();
  document.querySelector(".blocks")?.remove();
});

describe("useBookmarksSession", () => {
  it("loads the book's list and reloads per book, dropping a stale list response", async () => {
    const stale = deferred<BookmarkSummary[]>();
    vi.mocked(fetchBookmarks)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([row(9, 4, 2)]);
    const { result, rerender } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();
    expect(result.current.bookmarks).toEqual([]);
    expect(result.current.failed).toBe(false);

    rerender({ bookId: 8 });
    await settle();
    expect(result.current.bookmarks).toEqual([row(9, 4, 2)]);

    await act(async () => stale.resolve([row(1, 1, 1)]));
    expect(result.current.bookmarks).toEqual([row(9, 4, 2)]);
    expect(vi.mocked(fetchBookmarks).mock.calls).toEqual([[7], [8]]);
  });

  it("keeps a non-integer book id inert (pinned, not endorsed)", async () => {
    // ReadingPage rejects non-integer routes before content renders; the
    // guard mirrors the progress session's pinned one. This is the test
    // that flips if the guard is deliberately removed.
    renderHook(() => useBookmarksSession({ bookId: Number("x") }));
    await settle();
    expect(fetchBookmarks).not.toHaveBeenCalled();
  });

  it("adds a mark in reading order and dedupes the same-position retry", async () => {
    vi.mocked(fetchBookmarks).mockResolvedValue([row(1, 1, 5), row(2, 3, 1)]);
    vi.mocked(createBookmark).mockResolvedValue(row(3, 2, 2));
    const { result } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();

    act(() => result.current.addBookmark({ chapter: 2, block: 2 }));
    await settle();
    expect(createBookmark).toHaveBeenCalledWith(7, { chapter: 2, block: 2 });
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      1, 3, 2,
    ]);

    // The server answers a same-position retry with the existing row: the
    // list is already holding it, so nothing moves.
    act(() => result.current.addBookmark({ chapter: 2, block: 2 }));
    await settle();
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      1, 3, 2,
    ]);
  });

  it("removes a mark in place", async () => {
    vi.mocked(fetchBookmarks).mockResolvedValue([row(1, 1, 5), row(2, 3, 1)]);
    vi.mocked(deleteBookmark).mockResolvedValue(undefined);
    const { result } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();

    act(() => result.current.removeBookmark(1));
    await settle();
    expect(deleteBookmark).toHaveBeenCalledWith(7, 1);
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      2,
    ]);
  });

  it("sets failed on a list-load failure and lets the next landing clear it", async () => {
    vi.mocked(fetchBookmarks).mockRejectedValue(new Error("server gone"));
    vi.mocked(createBookmark).mockResolvedValue(row(1, 1, 5));
    const { result } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();
    expect(result.current.failed).toBe(true);

    act(() => result.current.addBookmark({ chapter: 1, block: 5 }));
    await settle();
    expect(result.current.failed).toBe(false);
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      1,
    ]);
  });

  it("a stale create's late failure does not set the new book's flag", async () => {
    const staleCreate = deferred<BookmarkSummary>();
    vi.mocked(fetchBookmarks).mockResolvedValue([]);
    vi.mocked(createBookmark)
      .mockReturnValueOnce(staleCreate.promise)
      .mockResolvedValue(row(2, 1, 1));
    const { result, rerender } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();
    act(() => result.current.addBookmark({ chapter: 4, block: 1 }));

    rerender({ bookId: 8 });
    await settle();
    act(() => result.current.addBookmark({ chapter: 1, block: 1 }));
    await settle();
    expect(result.current.failed).toBe(false);
    expect(result.current.bookmarks).toEqual([row(2, 1, 1)]);

    await act(async () => staleCreate.reject(new Error("late, book 7")));
    expect(result.current.failed).toBe(false);
  });

  it("a stale delete's late success does not clear the new book's flag", async () => {
    const staleDelete = deferred<void>();
    vi.mocked(fetchBookmarks).mockResolvedValue([]);
    vi.mocked(deleteBookmark)
      .mockReturnValueOnce(staleDelete.promise)
      .mockRejectedValueOnce(new Error("book 8 delete failed"));
    const { result, rerender } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();
    act(() => result.current.removeBookmark(3));

    rerender({ bookId: 8 });
    await settle();
    act(() => result.current.removeBookmark(4));
    await settle();
    expect(result.current.failed).toBe(true);

    await act(async () => staleDelete.resolve());
    expect(result.current.failed).toBe(true);
  });
});

describe("captureBookmarkTarget", () => {
  it("captures the topmost visible block at the call instant", () => {
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

    visibleBlock = 2;
    expect(captureBookmarkTarget(2)).toEqual({ chapter: 2, block: 2 });
  });

  it("returns null for an empty chapter and never fabricates block 1", () => {
    // No .blocks at all, and a container without candidates.
    expect(captureBookmarkTarget(2)).toBeNull();
    const blocks = document.createElement("div");
    blocks.className = "blocks";
    document.body.append(blocks);
    expect(captureBookmarkTarget(2)).toBeNull();
  });
});

describe("useBookmarksSession pass ordering", () => {
  it("a first pass's late list snapshot cannot rewind the re-entered book's fresher one", async () => {
    const firstPass = deferred<BookmarkSummary[]>();
    vi.mocked(fetchBookmarks)
      .mockReturnValueOnce(firstPass.promise)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(9, 4, 2)]);
    const { result, rerender } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();

    rerender({ bookId: 8 });
    await settle();
    rerender({ bookId: 7 });
    await settle();
    expect(result.current.bookmarks).toEqual([row(9, 4, 2)]);

    // The first pass's snapshot resolves last: older data, dropped.
    await act(async () => firstPass.resolve([row(1, 1, 1), row(2, 3, 1)]));
    expect(result.current.bookmarks).toEqual([row(9, 4, 2)]);
  });

  it("a first pass's late create cannot resurrect a row the reader deleted", async () => {
    const firstPassCreate = deferred<BookmarkSummary>();
    vi.mocked(fetchBookmarks).mockResolvedValue([row(1, 1, 5)]);
    vi.mocked(createBookmark)
      .mockReturnValueOnce(firstPassCreate.promise)
      .mockResolvedValue(row(2, 2, 2));
    vi.mocked(deleteBookmark).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(useBookmarksSession, {
      initialProps: { bookId: 7 },
    });
    await settle();
    act(() => result.current.addBookmark({ chapter: 2, block: 2 }));

    // Away and back: book 7's second pass sees the row the first pass
    // created.
    rerender({ bookId: 8 });
    await settle();
    vi.mocked(fetchBookmarks).mockResolvedValue([row(1, 1, 5), row(2, 2, 2)]);
    rerender({ bookId: 7 });
    await settle();
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      1, 2,
    ]);

    // The reader deletes it; then the first pass's create resolves late.
    act(() => result.current.removeBookmark(2));
    await settle();
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      1,
    ]);
    await act(async () => firstPassCreate.resolve(row(2, 2, 2)));
    expect(result.current.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      1,
    ]);
  });
});
