import { useEffect, useRef, useState } from "react";
import {
  fetchReadingProgress,
  saveReadingProgress,
  topmostVisibleBlock,
  type ReadingProgress,
} from "./readingProgress";

const SAVE_DEBOUNCE_MS = 500;
// How long after the restore jump scroll events stay ignored: they are the
// jump's own events, not the reader moving on. A reader physically
// scrolling within this window of a chapter render is not a thing.
const RESTORE_SCROLL_GUARD_MS = 250;

// Reading progress (ticket 05): owns the route's fetch, restore, and
// autosave session. The page supplies content readiness and renders the
// save-failure notice; progress and the scroll/debounce machinery stay here.
export function useProgressSession(options: {
  bookId: number;
  chapterNumber: number;
  ready: boolean;
}): { saveFailed: boolean } {
  const { bookId, chapterNumber, ready } = options;
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

  const skipSavesRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<ReadingProgress | null>(null);

  // Set when a save fails, cleared when one lands: a retry loop's last
  // rendered state must not outlive its credibility (CODING_STANDARDS,
  // audit 2026-10-23 — the silence made persistent outages look saved).
  const [saveFailed, setSaveFailed] = useState(false);

  const flushSave = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) {
      void saveReadingProgress(bookId, pending)
        .then(() => setSaveFailed(false))
        .catch(() => {
          // A failed save must never disturb reading; the next scroll
          // retries, and this notice says the sync is not happening.
          setSaveFailed(true);
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

  // Restore the saved position once the chapter renders: jump to the saved
  // block when this is the chapter the progress points at, otherwise start
  // at the top (React Router keeps scroll position across navigations).
  // Declared before the autosave effect so skipSavesRef is set before the
  // autosave effect decides whether to announce the chapter start.
  useEffect(() => {
    if (!ready || !progressLoaded) return;
    const saved =
      progress !== null && progress !== "unavailable" ? progress : null;
    const restoreBlock =
      saved && saved.chapter === chapterNumber && saved.block > 1
        ? saved.block
        : null;
    const target =
      restoreBlock === null
        ? null
        : document.querySelector(`.blocks [data-position="${restoreBlock}"]`);
    if (target) {
      skipSavesRef.current = true;
      target.scrollIntoView();
      const guard = window.setTimeout(() => {
        skipSavesRef.current = false;
      }, RESTORE_SCROLL_GUARD_MS);
      return () => window.clearTimeout(guard);
    }
    skipSavesRef.current = false;
    window.scrollTo(0, 0);
  }, [ready, progressLoaded, chapterNumber, progress]);

  // Autosave: announce the chapter start, then follow scrolling. When the
  // saved position could not be asked for, write nothing until a real
  // scroll produces an observed position. The last pending position is
  // flushed on chapter switch / unmount / pagehide.
  useEffect(() => {
    if (!ready || !progressLoaded) return;
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
