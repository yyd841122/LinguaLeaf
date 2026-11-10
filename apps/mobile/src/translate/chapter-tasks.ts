import type { Translator } from "./translator";
import { translateSentences } from "./batch";
import type {
  TranslationStore,
  TranslationEntry,
} from "../store/translation-store";
import type { ExtChapter } from "../reader/import-book";

// The chapter task registry (mobile-app ticket 04): the phone-side analog
// of the server's runChapterTranslationTask + fireTask envelope. On the
// phone there is no server process to own a background task — the task
// lives in the page — so the registry is module-level: the task outlives
// chapter switches and reader-face remounts, writes its results through
// the translation store, and readers subscribe for the percent and the
// settle verdict (the speak router's module-binding precedent).
//
// The envelope's rules carry over, once, here:
// - never-throw: start() fires the body without awaiting; a fault settles
//   the task as failed instead of rejecting past the click handler;
// - the 99 ceiling: retry rounds recount slots, so the percent can reach
//   its input maximum while work is still in flight — 100 would be a lie
//   until the body itself returns (the settle event is the 100);
// - pairing by references: the sentence blocks are held once (blockIndex
//   with each text) and the results write back through those held
//   indices — never a second traversal re-deriving the alignment.
//
// Verdict: a chapter where EVERY sentence came back null settles failed —
// the phone has no task page to read 留空 state off; the flag is the
// surface (wrong key and network-down both land here). Any settled
// translation makes the chapter translated, server semantics.

export type ChapterTaskOutcome = "translated" | "failed";

export type ChapterTaskEvent =
  | { kind: "progress"; percent: number }
  | { kind: "settled"; outcome: ChapterTaskOutcome };

export type ChapterTaskDeps = {
  translator: Translator;
  translations: TranslationStore;
};

export interface ChapterTaskRegistry {
  // Fires one chapter's translation task. Returns false when the chapter
  // already has a task in flight (the route's 409 on the phone) — no
  // second task for the same chapter.
  start(
    deps: ChapterTaskDeps,
    docId: string,
    chapterIndex: number,
    chapter: ExtChapter
  ): boolean;
  isRunning(docId: string, chapterIndex: number): boolean;
  // Live events for one chapter's task, whether it starts before or after
  // this subscription (the reader mounts its subscription with the
  // chapter; the trigger click comes later). Subscribing while a task
  // runs replays its current percent immediately, so a reader re-entering
  // the chapter mid-task sees the task, not a fresh trigger.
  subscribe(
    docId: string,
    chapterIndex: number,
    listener: (event: ChapterTaskEvent) => void
  ): () => void;
}

type RunningTask = { percent: number };

export function createChapterTaskRegistry(): ChapterTaskRegistry {
  // Nested maps: docIds are reader-built strings (`doc:${title}`) and a
  // title may contain any character — a joined string key could collide.
  const running = new Map<string, Map<number, RunningTask>>();
  // Listeners live at the registry level, not on the task instance: a
  // subscription armed before the trigger click must catch that click's
  // task, and listeners survive the task's settle (the next start
  // re-uses them).
  const listeners = new Map<
    string,
    Map<number, Set<(event: ChapterTaskEvent) => void>>
  >();

  const taskFor = (docId: string, chapterIndex: number): RunningTask | null =>
    running.get(docId)?.get(chapterIndex) ?? null;

  const listenersFor = (
    docId: string,
    chapterIndex: number
  ): Set<(event: ChapterTaskEvent) => void> => {
    const chapters = listeners.get(docId) ?? new Map();
    const set = chapters.get(chapterIndex) ?? new Set();
    chapters.set(chapterIndex, set);
    listeners.set(docId, chapters);
    return set;
  };

  const emit = (
    docId: string,
    chapterIndex: number,
    event: ChapterTaskEvent
  ) => {
    for (const listener of [...listenersFor(docId, chapterIndex)])
      listener(event);
  };

  return {
    start(deps, docId, chapterIndex, chapter) {
      if (taskFor(docId, chapterIndex)) return false;
      const task: RunningTask = { percent: 0 };
      const chapters = running.get(docId) ?? new Map();
      chapters.set(chapterIndex, task);
      running.set(docId, chapters);

      const settle = (outcome: ChapterTaskOutcome) => {
        const chapters = running.get(docId);
        if (chapters && chapters.get(chapterIndex) === task) {
          chapters.delete(chapterIndex);
          if (chapters.size === 0) running.delete(docId);
        }
        emit(docId, chapterIndex, { kind: "settled", outcome });
      };

      // The body runs synchronously into its first await (the route's
      // 202-carrying-state precedent) — the task is registered before
      // start returns, and the registered fact reaches listeners at once:
      // the trigger must flip the button into 翻译中 0% without waiting
      // for the first batch to land.
      emit(docId, chapterIndex, { kind: "progress", percent: 0 });
      void (async () => {
        try {
          // The sentence blocks held once: blockIndex rides with the text,
          // and the write-back goes through these same entries.
          const entries: { blockIndex: number; text: string }[] = [];
          chapter.blocks.forEach((block, blockIndex) => {
            if (block.kind === "sentence")
              entries.push({ blockIndex, text: block.text });
          });
          const results = await translateSentences(
            deps.translator,
            entries.map((entry) => entry.text),
            (done, total) => {
              task.percent = Math.min(99, Math.round((done / total) * 100));
              emit(docId, chapterIndex, {
                kind: "progress",
                percent: task.percent,
              });
            }
          );
          const landed: TranslationEntry[] = [];
          results.forEach((translation, position) => {
            const entry = entries[position];
            if (translation !== null && entry)
              landed.push({ blockIndex: entry.blockIndex, translation });
          });
          if (landed.length > 0)
            await deps.translations.saveTranslations(
              docId,
              chapterIndex,
              landed
            );
          settle(
            landed.length === 0 && entries.length > 0 ? "failed" : "translated"
          );
        } catch (error) {
          console.error(
            `Translation of ${docId}:${chapterIndex} failed:`,
            error
          );
          settle("failed");
        }
      })();
      return true;
    },
    isRunning(docId, chapterIndex) {
      return taskFor(docId, chapterIndex) !== null;
    },
    subscribe(docId, chapterIndex, listener) {
      const set = listenersFor(docId, chapterIndex);
      set.add(listener);
      const task = taskFor(docId, chapterIndex);
      if (task) listener({ kind: "progress", percent: task.percent });
      return () => {
        set.delete(listener);
      };
    },
  };
}

// The app-wide registry: one per page session, module-level like the
// speak router. Tests build fresh ones with createChapterTaskRegistry().
export const chapterTasks: ChapterTaskRegistry = createChapterTaskRegistry();
