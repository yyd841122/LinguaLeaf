import type Database from "better-sqlite3";
import type { Translator } from "./translator.js";
import { translateSentences } from "./batch.js";
import {
  listSentenceBlocks,
  saveSentenceTranslations,
  setChapterTranslationProgress,
  settleChapterTranslation,
} from "../book-store.js";
import { fireTask } from "../task-lifecycle.js";

// Stored on chapters.translation_error when a chapter task dies of an
// unexpected fault. The Translator contract is total (failures come back
// as nulls, never throws), so anything reaching the envelope's catch is a
// genuine server fault: the reason names the retry, the details go to the
// server log.
export const CHAPTER_TRANSLATION_FAILURE_MESSAGE = "章节翻译出错，请重试";

// Runs one chapter's on-demand translation to completion (ADR-0004). The
// sentence blocks are held as references once: their texts walk into
// translateSentences in order (20 sentences per batch, failed sentences
// retried for up to three rounds and then left empty), and the results
// come back under the same indices, so the write-back cannot realign.
// Percent steps report through the envelope (the 99 ceiling lives there);
// every write is guarded on 'translating', so a chapter deleted or
// settled mid-task stays as it is.
export function runChapterTranslationTask(
  deps: { database: Database.Database; translator: Translator },
  chapterId: number
): Promise<void> {
  const { database, translator } = deps;
  return fireTask({
    label: `Translation of chapter ${chapterId}`,
    writeProgress: (percent) =>
      setChapterTranslationProgress(database, chapterId, percent),
    settleFailed: () =>
      settleChapterTranslation(
        database,
        chapterId,
        "failed",
        CHAPTER_TRANSLATION_FAILURE_MESSAGE
      ),
    run: async (report) => {
      const sentenceBlocks = listSentenceBlocks(database, chapterId);
      // An empty chapter translates to one empty result: translateSentences
      // skips the translator when there is nothing pending, and the settle
      // below still lands — a heading-only chapter is trivially done.
      const translations = await translateSentences(
        translator,
        sentenceBlocks.map((block) => block.text),
        (done, total) => report(Math.round((done / total) * 100))
      );
      saveSentenceTranslations(
        database,
        sentenceBlocks.map((block, index) => ({
          id: block.id,
          translation: translations[index] ?? null,
        }))
      );
      settleChapterTranslation(database, chapterId, "translated", null);
    },
  });
}
