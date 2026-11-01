import { useEffect, useState } from "react";
import {
  createBookmark,
  deleteBookmark,
  fetchBookmarks,
  type BookmarkTarget,
} from "./bookmarks";
import type { BookmarkSummary } from "../../server/src/wire";
import { useOwner, type OwnerTicket } from "@lingualeaf/reading-model/react";

// Manual bookmarks' session (reading-bookmarks ticket 02): the route's
// list plus the create/remove calls, with every response adjudicated by
// an owner token keyed on the book id (GLOSSARY 属主令牌). No failure is
// swallowed: any failed op raises one `failed` flag for the page to render
// inline (the saveFailed channel's styling; never a popup), and the next
// successful op clears it.
//
// The list arm invalidates before marking. Key comparison alone would
// revive book A's first-pass tickets on an A → B → A re-entry
// (CODING_STANDARDS, "Cleanup flags revoke once; key comparison can
// revive"), and arrival order is not initiation order: a first-pass list
// snapshot resolving late would rewind the re-entered book's fresher one,
// and a first-pass create resolving after the reader deleted that row
// would resurrect it in a list the server no longer has. The trade for
// dropping pre-arm responses is transient client staleness — an op still
// in flight when the book changes shows only after the next list-writing
// op or a book re-entry, which refetches — and that is the right side of
// the trade: the panel never rewinds a snapshot or resurrects a deleted
// row.
export function useBookmarksSession(options: { bookId: number }): {
  bookmarks: BookmarkSummary[];
  failed: boolean;
  addBookmark: (target: BookmarkTarget) => void;
  removeBookmark: (bookmarkId: number) => void;
} {
  const { bookId } = options;
  const owner = useOwner(bookId);
  const [bookmarks, setBookmarks] = useState<BookmarkSummary[]>([]);
  // Set when any bookmark op fails, cleared when one lands — the same
  // channel semantics as the progress session's saveFailed.
  const [failed, setFailed] = useState(false);

  // One adjudicated channel for every response: a stale ticket writes
  // nothing at all; a fresh failure raises the inline flag, a fresh
  // success clears it and applies the caller's state merge.
  const settleOp = <T>(
    op: Promise<T>,
    ticket: OwnerTicket,
    onFresh?: (value: T) => void
  ) => {
    void op
      .then((value) => {
        if (ticket.stale()) return;
        setFailed(false);
        onFresh?.(value);
      })
      .catch(() => {
        if (ticket.stale()) return;
        setFailed(true);
      });
  };

  useEffect(() => {
    // The list is the new book's from the first render that names it; a
    // stale response for the old book cannot resurrect either piece.
    setBookmarks([]);
    setFailed(false);
    if (!Number.isInteger(bookId)) return;
    owner.invalidate();
    settleOp(fetchBookmarks(bookId), owner.mark(), (rows) =>
      setBookmarks(rows)
    );
  }, [bookId, owner]);

  const addBookmark = (target: BookmarkTarget) => {
    const ticket = owner.mark();
    settleOp(createBookmark(bookId, target), ticket, (row) =>
      setBookmarks((current) =>
        current.some((bookmark) => bookmark.id === row.id)
          ? current
          : // The server lists (chapter, block)-ascending; a fresh row
            // re-enters that order instead of appending.
            [...current, row].sort(
              (a, b) => a.chapter - b.chapter || a.block - b.block
            )
      )
    );
  };

  const removeBookmark = (bookmarkId: number) => {
    const ticket = owner.mark();
    settleOp(deleteBookmark(bookId, bookmarkId), ticket, () =>
      setBookmarks((current) =>
        current.filter((bookmark) => bookmark.id !== bookmarkId)
      )
    );
  };

  return { bookmarks, failed, addBookmark, removeBookmark };
}
