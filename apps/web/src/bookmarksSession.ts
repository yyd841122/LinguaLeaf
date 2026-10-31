import { useEffect, useState } from "react";
import {
  createBookmark,
  deleteBookmark,
  fetchBookmarks,
  type BookmarkTarget,
} from "./bookmarks";
import type { BookmarkSummary } from "../../server/src/wire";
import { useOwner } from "./useOwner";

// Manual bookmarks' session (reading-bookmarks ticket 02): the route's
// list plus the create/remove calls, with every response adjudicated by an
// owner token keyed on the book id (GLOSSARY 属主令牌) — once the reader
// has moved to another book, a late response is dropped and writes
// nothing. No failure is swallowed: any failed op raises one `failed`
// flag for the page to render inline (the saveFailed channel's styling;
// never a popup), and the next successful op clears it.
//
// The tokens here are key-compared, never invalidated: book A → B → A can
// revive an earlier pass's response, and that is safe by construction —
// every response carries book-A data (a row that exists server-side,
// deduped by id on append; a delete of a book-A row), so a revived
// response still tells the truth about book A (CODING_STANDARDS,
// "Cleanup flags revoke once; key comparison can revive"). Invalidating
// at the list refetch instead could drop a create that landed between the
// refetch and its response, leaving the list missing a real row.
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

  useEffect(() => {
    // The list is the new book's from the first render that names it; a
    // stale response for the old book cannot resurrect either piece.
    setBookmarks([]);
    setFailed(false);
    if (!Number.isInteger(bookId)) return;
    const ticket = owner.mark();
    fetchBookmarks(bookId)
      .then((rows) => {
        if (ticket.stale()) return;
        setBookmarks(rows);
      })
      .catch(() => {
        if (ticket.stale()) return;
        setFailed(true);
      });
  }, [bookId, owner]);

  const addBookmark = (target: BookmarkTarget) => {
    const ticket = owner.mark();
    createBookmark(bookId, target)
      .then((row) => {
        if (ticket.stale()) return;
        setFailed(false);
        setBookmarks((current) =>
          current.some((bookmark) => bookmark.id === row.id)
            ? current
            : // The server lists (chapter, block)-ascending; a fresh row
              // re-enters that order instead of appending.
              [...current, row].sort(
                (a, b) => a.chapter - b.chapter || a.block - b.block
              )
        );
      })
      .catch(() => {
        if (ticket.stale()) return;
        setFailed(true);
      });
  };

  const removeBookmark = (bookmarkId: number) => {
    const ticket = owner.mark();
    deleteBookmark(bookId, bookmarkId)
      .then(() => {
        if (ticket.stale()) return;
        setFailed(false);
        setBookmarks((current) =>
          current.filter((bookmark) => bookmark.id !== bookmarkId)
        );
      })
      .catch(() => {
        if (ticket.stale()) return;
        setFailed(true);
      });
  };

  return { bookmarks, failed, addBookmark, removeBookmark };
}
