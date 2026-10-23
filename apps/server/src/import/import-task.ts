import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import { buildChapterBlocks, type PreparedBook } from "./pipeline.js";
import { persistBook, setImportProgress, settleImport } from "../book-store.js";
import { createTaskTracker } from "../task-tracker.js";

// Stored on books.import_error. The synchronous POST already reports
// specific parse problems (400/415); everything that can still fail after
// that is an unexpected server fault, so the shelf shows a plain retry
// hint while the details go to the server log.
const TASK_FAILURE_MESSAGE = "导入过程中出错，请重试";

// The in-flight imports, so shutdown can give running imports a grace
// window before SQLite closes (see task-tracker.ts for the shared shape).
const importTasks = createTaskTracker();

// Resolves when no import task is running, or after the grace deadline —
// whichever comes first. Shutdown awaits this before closing the database.
export function drainImportTasks(graceMs: number): Promise<void> {
  return importTasks.drain(graceMs);
}

// Runs one book's annotation pass to completion: sentence splitting and
// per-word IPA from the local dictionary, then the block insert. Network
// translation left the pipeline in on-demand-translation (ADR-0004 ticket
// 02) — chapters land untranslated and the reading page's 翻译本章 trigger
// owns that work — so nothing here awaits anymore. The task still routes
// through the tracker and keeps the settle guards, so the shutdown drain
// and a deleted (or already settled) book stay handled by the same shape
// as before. This function never throws — the router fires it without
// awaiting. All writes go through the book store, whose guards keep a
// deleted book from being resurrected by a late tick.
export function runImportTask(
  deps: {
    database: Database.Database;
    dictionary: Dictionary;
  },
  bookId: number,
  book: PreparedBook
): Promise<void> {
  return importTasks.run(runImportTaskInner(deps, bookId, book));
}

async function runImportTaskInner(
  deps: {
    database: Database.Database;
    dictionary: Dictionary;
  },
  bookId: number,
  book: PreparedBook
): Promise<void> {
  const { database, dictionary } = deps;
  try {
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
  } catch (error) {
    console.error(`Import of book ${bookId} failed:`, error);
    // The task's own contract is never to throw — the router fires it
    // without awaiting — so even failure settlement is guarded: a database
    // that cannot take the settle write must not turn this promise into an
    // unhandled rejection (audit 2026-10-23).
    try {
      settleImport(database, bookId, "failed", TASK_FAILURE_MESSAGE);
    } catch (settleError) {
      console.error(
        `Import of book ${bookId} could not be settled:`,
        settleError
      );
    }
  }
}
