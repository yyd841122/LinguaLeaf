import { useEffect } from "react";
import type {
  ChapterPayload,
  ChapterTranslationState,
} from "../../server/src/wire";
import { fetchJson } from "./api";
import { useTaskFollower } from "./taskFollower";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";

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
  // trigger POST did not land; it clears on its own recovery (a retry, a
  // landing response, or a route change) — a loop's last state must not
  // outlive its credibility (CODING_STANDARDS). The running poll's outage
  // flag lives in the task-follower below. The flag rides the shared
  // settle channel (settle-channel 01); the clears below are intent-side
  // writes — the channel never clears on run's start.
  const owner = useOwner(bookId, chapterNumber);
  const { failed: startFailed, clear, run } = useSettle(owner);

  useEffect(() => {
    clear();
  }, [bookId, chapterNumber, clear]);

  // The translate trigger: the POST's 202 body is the chapter in its
  // brand-new translating state, patched in immediately (the shelf's
  // "202 body joins first" precedent — a failed refresh cannot masquerade
  // as a failed trigger). From there the poll below follows the lifecycle;
  // the button's disabled state keys on the server's status, never on the
  // POST having returned. No invalidate at arm: the double-click's losing
  // 409 may still speak until the winning 202 lands and clears it.
  const start = () => {
    clear();
    void run(translateChapter(bookId, chapterNumber), {
      onFresh: (state) => onTranslationState(state),
    });
  };

  // While this chapter translates, follow the task on the shared
  // task-follower (it owns the interval, the staleness discard, and the
  // outage rules): the percent moves the disabled button's label, and the
  // response that leaves 'translating' carries the fresh lines with it.
  // The active fact rides the payload, so route changes and settle both
  // tear the follow down; a landed tick is also the trigger-failure
  // notice's recovery — an explicit intent-side clear, freshness already
  // judged by the follower's own channel.
  const { outage: pollFailed } = useTaskFollower({
    active,
    fetchTick: () =>
      fetchJson<ChapterPayload>(
        `/api/books/${bookId}/chapters/${chapterNumber}`
      ),
    onTick: (chapterData) => {
      onTick(chapterData);
      clear();
    },
    intervalMs: TRANSLATION_POLL_MS,
  });

  return { start, startFailed, pollFailed };
}
