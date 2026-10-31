import { fetchJson } from "./api";
import type { BookmarkSummary } from "../../server/src/wire";

// Manual bookmarks (reading-bookmarks ticket 01): the three calls the
// reading page and its panel make, thin over the shared fetch layer like
// readingProgress.ts. No failure is swallowed here and no state is
// written: every rejection — including a missing book's 404 — throws as a
// catchable ApiError, and the caller branches on `error.status` (404 book
// gone vs. everything else). A ready book with no marks is the server's
// empty collection, resolved as [], never folded into that 404.

// Where a reader planted a mark: chapter + block positions, the same
// coordinates the API and the reading view's data-position attributes use.
export type BookmarkTarget = {
  chapter: number;
  block: number;
};

// Lists a book's marks in (chapter, block) reading order.
export function fetchBookmarks(bookId: number): Promise<BookmarkSummary[]> {
  return fetchJson<{ bookmarks: BookmarkSummary[] }>(
    `/api/books/${bookId}/bookmarks`
  ).then((body) => body.bookmarks);
}

// Plants a mark: 201 resolves the fresh row, a same-position retry
// resolves the existing one (200) — same shape either way. Over the per-
// book cap a new mark rejects with 409, a position the book lacks with
// 404; nothing is retried here.
export function createBookmark(
  bookId: number,
  target: BookmarkTarget
): Promise<BookmarkSummary> {
  return fetchJson<{ bookmark: BookmarkSummary }>(
    `/api/books/${bookId}/bookmarks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    }
  ).then((body) => body.bookmark);
}

// Removes one mark. The server answers 204 idempotently for any id while
// the book exists; a missing book's 404 rejects — deletion is explicit,
// its failure is not a silent no-op.
export function deleteBookmark(
  bookId: number,
  bookmarkId: number
): Promise<void> {
  return fetchJson<void>(`/api/books/${bookId}/bookmarks/${bookmarkId}`, {
    method: "DELETE",
  });
}
