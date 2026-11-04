import { useEffect, useRef, useState } from "react";
import {
  fetchReadingProgress,
  saveReadingProgress,
  topmostVisibleBlock,
  type ReadingProgress,
} from "./readingProgress";
import type { BookmarkTarget } from "./bookmarks";
import { readingBlockSelector } from "./readingBlocks";
import {
  useOwner,
  useSettle,
  type OwnerTicket,
} from "@lingualeaf/reading-model/react";

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
}) {
  const { bookId, chapterNumber, ready } = options;
  const [armedTarget, setArmedTarget] = useState<
    (BookmarkTarget & { op: number }) | null
  >(null);
  const jumpOpRef = useRef(0);
  const [landedJump, setLandedJump] = useState<{
    bookId: number;
    chapter: number;
    block: number;
    op: number;
  } | null>(null);
  // Arms a landing without navigating. Each call mints a monotonically
  // advancing op that never resets, so repeated intents for the same
  // chapter and block still re-scroll. Arm in the same event as the
  // navigation it belongs to: React batches them into one render. A target
  // naming another chapter leaves this chapter's normal restore in place.
  const armJumpTarget = (target: BookmarkTarget) => {
    jumpOpRef.current += 1;
    setArmedTarget({ ...target, op: jumpOpRef.current });
    return jumpOpRef.current;
  };
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
  // changes alongside the armed target (render-time adjust — the route-key
  // rule's endorsed shape), before any effect can restore the new book.
  const consumedOpRef = useRef(Number.NEGATIVE_INFINITY);
  const consumedBookIdRef = useRef<number | null>(null);
  // NaN routes stay inert too: !== would keep resetting state every render.
  if (!Object.is(consumedBookIdRef.current, bookId)) {
    consumedBookIdRef.current = bookId;
    consumedOpRef.current = Number.NEGATIVE_INFINITY;
    setArmedTarget(null);
  }
  // What the last completed restore did on which route. The restore effect
  // must be idempotent per (route, inputs) — StrictMode double-invokes it,
  // and readiness can replay it with the same armed target — so a
  // re-run that matches this record repeats the jump verbatim (same scroll,
  // no second save), and anything else treats the target as consumed.
  const lastRestoreRef = useRef<{
    bookId: number;
    chapterNumber: number;
    jumpedToOp: number | null;
  } | null>(null);

  // The notice's adjudication rides the settle channel (GLOSSARY 落回裁
  // 决): a fresh failed flush raises its flag, a fresh landed flush
  // clears it, a stale round writes nothing. A retry loop's last
  // rendered state must not outlive its credibility (CODING_STANDARDS,
  // audit 2026-10-23 — the silence made persistent outages look saved).
  const settle = useSettle(owner);

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
      // The channel adjudicates: the flush still sends whatever the ref
      // holds (a null — no armed session yet — sends and writes nothing),
      // and only a fresh verdict moves the notice.
      void settle.run(saveReadingProgress(bookId, pending), {
        ticket: saveFeedbackTicketRef.current,
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
    document.querySelector(readingBlockSelector(block));
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
    const target = armedTarget;
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
      const dispose = jumpToBlockEl(blockEl);
      // scrollIntoView is synchronous (no smooth behavior); the next frame
      // observes the committed layout before a consumer measures its button.
      const frame = window.requestAnimationFrame(() => {
        setLandedJump({
          bookId,
          chapter: target.chapter,
          block: target.block,
          op: target.op,
        });
      });
      return () => {
        dispose();
        window.cancelAnimationFrame(frame);
      };
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
  }, [ready, progressLoaded, chapterNumber, progress, armedTarget, bookId]);

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

  return { saveFailed: settle.failed, armJumpTarget, landedJump };
}
