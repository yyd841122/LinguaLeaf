import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import { buildChapterBlocks } from "./pipeline.js";
import type { PreparedBook } from "@lingualeaf/import-core";
import { persistBook, setImportProgress, settleImport } from "../book-store.js";
import { fireTask } from "../task-lifecycle.js";

// Stored on books.import_error. The synchronous POST already reports
// specific parse problems (400/415); everything that can still fail after
// that is an unexpected server fault, so the shelf shows a plain retry
// hint while the details go to the server log.
const TASK_FAILURE_MESSAGE = "导入过程中出错，请重试";

// Runs one book's annotation pass to completion: sentence splitting and
// per-word IPA from the local dictionary, then the block insert. Network
// translation left the pipeline in on-demand-translation (ADR-0004 ticket
// 02) — chapters land untranslated and the reading page's 翻译本章 trigger
// owns that work. The lifecycle around this body — never-throw, the
// guarded failure settle below, the shutdown drain — is task-lifecycle.ts's;
// this file assembles the task: the domain body and the fault verdict.
// All writes go through the book store, whose guards keep a deleted (or
// already settled) book from being resurrected by a late write.
export function runImportTask(
  deps: {
    database: Database.Database;
    dictionary: Dictionary;
  },
  bookId: number,
  book: PreparedBook
): Promise<void> {
  const { database, dictionary } = deps;
  return fireTask({
    label: `Import of book ${bookId}`,
    settleFailed: () =>
      settleImport(database, bookId, "failed", TASK_FAILURE_MESSAGE),
    run: async () => {
      const chapterBlocks = buildChapterBlocks(book, dictionary);
      setImportProgress(database, bookId, "saving", null);
      const persisted = persistBook(
        database,
        bookId,
        book.chapters.map((chapter, index) => ({
          title: chapter.title,
          level: chapter.level,
          blocks: chapterBlocks[index] ?? [],
        }))
      );
      if (persisted) {
        settleImport(database, bookId, "ready", null);
      }
      // Not persisted: the book was deleted mid-import; nothing to settle.
    },
  });
}
