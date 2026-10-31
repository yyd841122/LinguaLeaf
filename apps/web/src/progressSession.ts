import { useEffect, useRef, useState } from "react";
import {
  fetchReadingProgress,
  saveReadingProgress,
  topmostVisibleBlock,
  type ReadingProgress,
} from "./readingProgress";
import type { BookmarkTarget } from "./bookmarks";
import { useOwner, type OwnerTicket } from "./useOwner";

const SAVE_DEBOUNCE_MS = 500;
// How long after the restore jump scroll events stay ignored: they are the
// jump's own events, not the reader moving on. A reader physically
// scrolling within this window of a chapter render is not a thing.
const RESTORE_SCROLL_GUARD_MS = 250;

// Reading progress (ticket 05): owns the route's fetch, restore, and
// autosave session. The page supplies content readiness and renders the
// save-failure notice; progress and the scroll/debounce machinery stay
// here. reading-bookmarks 02 adds the explicit jump target: the page
// translates a click intent (a panel bookmark entry, back-to-chapter-one)
// into a target and this hook is the single coordinator of where the
// reader lands — priority 「显式目标 → 自动进度 → 章首」.
export function useProgressSession(options: {
  bookId: number;
  chapterNumber: number;
  ready: boolean;
  // Where the reader asked to land. op advances per intent, so a repeated
  // jump to the same chapter+block still re-scrolls. Set it in the same
  // event as the navigation it belongs to (React batches them into one
  // render): a target naming a foreign chapter simply runs the current
  // chapter's normal restore. The target carries no book id by shape; the
  // page owns clearing it on navigation it does not want honored (a book
  // switch above all).
  target?: (BookmarkTarget & { op: number }) | null;
}): { saveFailed: boolean } {
  const { bookId, chapterNumber, ready, target = null } = options;
  // "unavailable" = the progress could not be asked for (server hiccup):
  // nothing to restore, and the autosave must not write either, or it would
  // overwrite the reader's real position with top-of-chapter.
  // Hold the fetched route too: null progress is a settled "never read",
  // distinct from a request still in flight or belonging to the old route.
  const [loadedProgress, setLoadedProgress] = useState<{
    bookId: number;
    chapterNumber: number;
    progress: ReadingProgress | null | "unavailable";
  } | null>(null);
  const progress = loadedProgress?.progress ?? null;
  const progressLoaded =
    loadedProgress !== null &&
    loadedProgress.bookId === bookId &&
    loadedProgress.chapterNumber === chapterNumber;

  useEffect(() => {
    setLoadedProgress(null);
    if (!Number.isInteger(bookId) || !Number.isInteger(chapterNumber)) return;
    let cancelled = false;
    void fetchReadingProgress(bookId)
      .catch(() => "unavailable" as const)
      .then((progress) => {
        if (!cancelled) {
          setLoadedProgress({ bookId, chapterNumber, progress });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterNumber]);

  // Route-keyed owner (GLOSSARY 属主令牌) for the save-failure feedback.
  // The progress read keeps its per-effect cancelled flag on purpose: that
  // flag revokes one effect instance's response and the route change
  // refetches anyway, which is the read's whole contract. The notice is
  // the write side, whose responses arrive after the write and need
  // adjudication.
  const owner = useOwner(bookId, chapterNumber);

  const skipSavesRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<ReadingProgress | null>(null);
  // Highest target op already consumed: an equal-or-lower op is a re-render
  // of a landed intent, not a new jump. The watermark resets when the book
  // changes (render-time adjust — the route-key rule's endorsed shape):
  // ops are the page's counter, and the route element does not remount on
  // a book switch, so book A's consumed op 5 must not silence book B's
  // op 1. The page's half of the contract: ops advance per intent and are
  // never renumbered within a book.
  const consumedOpRef = useRef(Number.NEGATIVE_INFINITY);
  const consumedBookIdRef = useRef<number | null>(null);
  if (consumedBookIdRef.current !== bookId) {
    consumedBookIdRef.current = bookId;
    consumedOpRef.current = Number.NEGATIVE_INFINITY;
  }
  // What the last completed restore did on which route. The restore effect
  // must be idempotent per (route, inputs) — StrictMode double-invokes it,
  // and a page re-creating the target object per render re-runs it — so a
  // re-run that matches this record repeats the jump verbatim (same scroll,
  // no second save), and anything else treats the target as consumed.
  const lastRestoreRef = useRef<{
    bookId: number;
    chapterNumber: number;
    jumpedToOp: number | null;
  } | null>(null);

  // Set when a save fails, cleared when one lands: a retry loop's last
  // rendered state must not outlive its credibility (CODING_STANDARDS,
  // audit 2026-10-23 — the silence made persistent outages look saved).
  const [saveFailed, setSaveFailed] = useState(false);

  // The notice's owner ticket (GLOSSARY 属主令牌), taken when the
  // autosave session arms. Every flush this arm puts in flight speaks
  // through it, so a response can move the notice only while its route is
  // still current: an old route's late success must not clear the new
  // route's notice, and its late failure must not set it. The ref, not a
  // render-scoped constant, is what keeps the route-change flush honest —
  // that flush runs during the cleanup of the render that already
  // committed the new route, and it must carry the old route's ticket.
  const saveFeedbackTicketRef = useRef<OwnerTicket | null>(null);

  const flushSave = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) {
      const ticket = saveFeedbackTicketRef.current;
      void saveReadingProgress(bookId, pending)
        .then(() => {
          if (ticket && !ticket.stale()) setSaveFailed(false);
        })
        .catch(() => {
          // A failed save must never disturb reading; the next scroll
          // retries, and this notice says the sync is not happening.
          if (ticket && !ticket.stale()) setSaveFailed(true);
        });
    }
  };

  const scheduleSave = (next: ReadingProgress) => {
    pendingSaveRef.current = next;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  // Restore where the reader lands once the chapter renders, by priority:
  // the explicit target when it names this chapter, else the saved
  // progress when it points here, else the top (React Router keeps scroll
  // position across navigations). Declared before the autosave effect so
  // skipSavesRef is set before the autosave effect decides whether to
  // announce the chapter start — a landing jump must not be overwritten by
  // the chapter-start save.
  // Both landing paths (explicit target, auto restore) scroll the same
  // way: swallow the jump's own scroll events for the guard window, and
  // hand back the guard timer's disposer for the effect cleanup.
  const blockElAt = (block: number) =>
    document.querySelector(`.blocks [data-position="${block}"]`);
  const jumpToBlockEl = (blockEl: Element) => {
    skipSavesRef.current = true;
    blockEl.scrollIntoView();
    const guard = window.setTimeout(() => {
      skipSavesRef.current = false;
    }, RESTORE_SCROLL_GUARD_MS);
    return () => window.clearTimeout(guard);
  };

  useEffect(() => {
    if (!ready || !progressLoaded) return;
    const landsHere = target !== null && target.chapter === chapterNumber;
    const last = lastRestoreRef.current;
    const repeatJump =
      landsHere &&
      last !== null &&
      last.bookId === bookId &&
      last.chapterNumber === chapterNumber &&
      last.jumpedToOp !== null &&
      target.op === last.jumpedToOp;
    const fresh = landsHere && !repeatJump && target.op > consumedOpRef.current;
    const blockEl = landsHere ? blockElAt(target.block) : null;

    if ((repeatJump || fresh) && blockEl !== null) {
      if (fresh) {
        consumedOpRef.current = target.op;
        // The landing writes progress here and now (spec decision 11): the
        // jump is an observed reader act, so it saves even while
        // "unavailable" parks the fabricated chapter start. Debounced like
        // any save, so a scroll burst right after the jump coalesces into
        // the reader's real block.
        scheduleSave({ chapter: chapterNumber, block: target.block });
      }
      lastRestoreRef.current = { bookId, chapterNumber, jumpedToOp: target.op };
      return jumpToBlockEl(blockEl);
    }
    if (fresh) {
      // The target names a block this chapter does not render — a stale
      // mark after a re-import. Consumed once, degraded down the chain.
      consumedOpRef.current = target.op;
    }
    lastRestoreRef.current = { bookId, chapterNumber, jumpedToOp: null };
    const saved =
      progress !== null && progress !== "unavailable" ? progress : null;
    const restoreBlock =
      saved && saved.chapter === chapterNumber && saved.block > 1
        ? saved.block
        : null;
    const restoreEl = restoreBlock === null ? null : blockElAt(restoreBlock);
    if (restoreEl) {
      return jumpToBlockEl(restoreEl);
    }
    skipSavesRef.current = false;
    window.scrollTo(0, 0);
    // bookId joins the route key by name (a book switch re-arms through
    // progressLoaded too, but the repeatJump check reads bookId directly).
    // scheduleSave/blockElAt/jumpToBlockEl stay out on purpose: they are
    // re-created every render, and in the array they would re-run the
    // restore — and re-arm the scroll guard — on every render. They read
    // only refs and arguments, so the closures cannot go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, progressLoaded, chapterNumber, progress, target, bookId]);

  // Autosave: announce the chapter start, then follow scrolling. When the
  // saved position could not be asked for, write nothing until a real
  // scroll produces an observed position. The last pending position is
  // flushed on chapter switch / unmount / pagehide.
  useEffect(() => {
    if (!ready || !progressLoaded) return;
    // This arm owns the notice. invalidate, not just the key compare:
    // leaving a route and re-entering it would otherwise revive the first
    // pass's ticket (CODING_STANDARDS, "Cleanup flags revoke once; key
    // comparison can revive") and let its response speak for the second
    // pass. One armed session at a time owns the channel.
    owner.invalidate();
    saveFeedbackTicketRef.current = owner.mark();
    if (!skipSavesRef.current && progress !== "unavailable") {
      scheduleSave({ chapter: chapterNumber, block: 1 });
    }
    const onScroll = () => {
      if (skipSavesRef.current) return;
      const block = topmostVisibleBlock();
      if (block !== null) {
        scheduleSave({ chapter: chapterNumber, block });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flushSave);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flushSave);
      flushSave();
    };
    // Deps are deliberately narrow: readiness and the fetched route arm
    // the effect, not the save closures (re-created each render — adding
    // them would re-arm the listeners every render). progress settles
    // with progressLoaded for this route, so keying on that is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, progressLoaded, chapterNumber, bookId]);

  return { saveFailed };
}
