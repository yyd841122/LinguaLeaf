import type Database from "better-sqlite3";
import type { Translator } from "./translator.js";
import { translateChapters } from "./batch.js";
import {
  listSentenceBlocks,
  saveSentenceTranslations,
  setChapterTranslationProgress,
  settleChapterTranslation,
} from "../book-store.js";
import { createTaskTracker } from "../task-tracker.js";

// Stored on chapters.translation_error when a chapter task dies of an
// unexpected fault. The Translator contract is total (failures come back
// as nulls, never throws), so — like the import task's catch — anything
// reaching this is a genuine server fault: the reason names the retry,
// the details go to the server log.
export const CHAPTER_TRANSLATION_FAILURE_MESSAGE = "章节翻译出错，请重试";

// The in-flight chapter translations, so shutdown gives their writes the
// same grace window imports get before SQLite closes (task-tracker.ts).
const chapterTasks = createTaskTracker();

// Resolves when no chapter translation is running, or after the grace
// deadline. Shutdown awaits this beside drainImportTasks.
export function drainChapterTranslationTasks(graceMs: number): Promise<void> {
  return chapterTasks.drain(graceMs);
}

// Runs one chapter's on-demand translation to completion (ADR-0004). The
// sentence blocks are held as references once: their texts walk into
// translateChapters (20 sentences per batch, failed sentences retried for
// up to three rounds and then left empty — the import path's exact
// semantics), and the results write back through the same references, so
// the pairing cannot realign. This function never throws — the router
// fires it without awaiting; every write is guarded on 'translating', so
// a chapter deleted or settled mid-task stays as it is.
export function runChapterTranslationTask(
  deps: { database: Database.Database; translator: Translator },
  chapterId: number
): Promise<void> {
  return chapterTasks.run(runChapterTranslationTaskInner(deps, chapterId));
}

async function runChapterTranslationTaskInner(
  deps: { database: Database.Database; translator: Translator },
  chapterId: number
): Promise<void> {
  const { database, translator } = deps;
  try {
    const sentenceBlocks = listSentenceBlocks(database, chapterId);
    // An empty chapter translates to one empty result: translateChapters
    // skips the translator for a chapter with no sentences, and the settle
    // below still lands — a heading-only chapter is trivially done.
    const translationsByChapter = await translateChapters(
      translator,
      [sentenceBlocks.map((block) => block.text)],
      (done, total) => {
        // Retry rounds re-process sentences that already counted, so the
        // slot counter can reach total while work is still in flight;
        // 99 is the honest ceiling until the loop itself returns (the
        // import task's same rule).
        setChapterTranslationProgress(
          database,
          chapterId,
          Math.min(99, Math.round((done / total) * 100))
        );
      }
    );
    const translations = translationsByChapter[0] ?? [];
    saveSentenceTranslations(
      database,
      sentenceBlocks.map((block, index) => ({
        id: block.id,
        translation: translations[index] ?? null,
      }))
    );
    settleChapterTranslation(database, chapterId, "translated", null);
  } catch (error) {
    console.error(`Translation of chapter ${chapterId} failed:`, error);
    // The task's own contract is never to throw — the router fires it
    // without awaiting — so even the settle write is guarded: a database
    // that cannot take it must not turn this promise into an unhandled
    // rejection (the import task's same shape).
    try {
      settleChapterTranslation(
        database,
        chapterId,
        "failed",
        CHAPTER_TRANSLATION_FAILURE_MESSAGE
      );
    } catch (settleError) {
      console.error(
        `Translation of chapter ${chapterId} could not be settled:`,
        settleError
      );
    }
  }
}
