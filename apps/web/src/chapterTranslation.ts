import { useEffect, useRef, useState } from "react";
import type {
  ChapterPayload,
  ChapterTranslationState,
} from "../../server/src/wire";
import { fetchJson } from "./api";
import { useTaskFollower } from "./taskFollower";

// The chapter translation trigger state machine (ADR-0004): owns the POST,
// the stale-response discard after navigation, the startFailed lifecycle,
// and the poll follow through the shared task-follower. The page owns how
// trigger state merges into content and how a tick replaces it, along with
// the button and notices that render these facts.

// How often the chapter re-asks for its payload while a translation runs;
// mirrors the shelf's import poll (the task updates the percent per batch,
// so this needs to feel live, not be instant).
const TRANSLATION_POLL_MS = 1500;

// Triggers the background translation of one chapter. The 202 body is the
// chapter payload in its brand-new translating state — the same shape the
// 1.5s poll reads back until the status leaves 'translating'. A 409 (the
// chapter is already translating, or no service is configured) throws as
// ApiError, so the caller can surface a catchable notice.
async function translateChapter(
  bookId: number,
  chapterPosition: number
): Promise<ChapterTranslationState> {
  return fetchJson<ChapterTranslationState>(
    `/api/books/${bookId}/chapters/${chapterPosition}/translate`,
    { method: "POST" }
  );
}

export function useChapterTranslation(options: {
  active: boolean;
  bookId: number;
  chapterNumber: number;
  onTranslationState: (state: ChapterTranslationState) => void;
  onTick: (payload: ChapterPayload) => void;
}): { start: () => void; startFailed: boolean; pollFailed: boolean } {
  const { active, bookId, chapterNumber, onTranslationState, onTick } = options;
  // The on-demand translation flow (ADR-0004): `startFailed` says the
  // trigger POST did not land; it clears on its own recovery (a retry or
  // a landing response) — a loop's last state must not outlive its
  // credibility (CODING_STANDARDS). The running poll's outage flag lives
  // in the task-follower below.
  const [startFailed, setStartFailed] = useState(false);
  // The route as of the latest render: a trigger's 202 that resolves after
  // a navigation is stale and must not patch the new chapter's state.
  const currentRouteRef = useRef({ bookId, chapterNumber });
  currentRouteRef.current = { bookId, chapterNumber };

  useEffect(() => {
    setStartFailed(false);
  }, [bookId, chapterNumber]);

  // The translate trigger: the POST's 202 body is the chapter in its
  // brand-new translating state, patched in immediately (the shelf's
  // "202 body joins first" precedent — a failed refresh cannot masquerade
  // as a failed trigger). From there the poll below follows the lifecycle;
  // the button's disabled state keys on the server's status, never on the
  // POST having returned.
  const start = () => {
    setStartFailed(false);
    const route = { bookId, chapterNumber };
    // A navigation since the click makes the response stale: the page is
    // another chapter's now, and its own state must not be patched.
    const stale = () =>
      currentRouteRef.current.bookId !== route.bookId ||
      currentRouteRef.current.chapterNumber !== route.chapterNumber;
    translateChapter(bookId, chapterNumber)
      .then((state) => {
        if (stale()) return;
        // A landed trigger is the start-failure's recovery: in the
        // double-click race the losing 409's notice must not outlive the
        // translating state this response patches in.
        setStartFailed(false);
        onTranslationState(state);
      })
      .catch(() => {
        // The endpoint's 409s (already translating / no service) and every
        // other failure land here: a catchable notice, not a white screen.
        if (stale()) return;
        setStartFailed(true);
      });
  };

  // While this chapter translates, follow the task on the shared
  // task-follower (it owns the interval, the staleness discard, and the
  // outage rules): the percent moves the disabled button's label, and the
  // response that leaves 'translating' carries the fresh lines with it.
  // The active fact rides the payload, so route changes and settle both
  // tear the follow down; a landed tick is also the trigger-failure
  // notice's recovery.
  const { outage: pollFailed } = useTaskFollower({
    active,
    fetchTick: () =>
      fetchJson<ChapterPayload>(
        `/api/books/${bookId}/chapters/${chapterNumber}`
      ),
    onTick: (chapterData) => {
      onTick(chapterData);
      setStartFailed(false);
    },
    intervalMs: TRANSLATION_POLL_MS,
  });

  return { start, startFailed, pollFailed };
}
