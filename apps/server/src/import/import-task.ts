import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import type { Translator } from "../translate/translator.js";
import { translateChapters } from "../translate/batch.js";
import { buildChapterBlocks, type PreparedBook } from "./pipeline.js";
import { persistBook, setImportProgress, settleImport } from "../book-store.js";

// Stored on books.import_error. The synchronous POST already reports
// specific parse problems (400/415); everything that can still fail after
// that is an unexpected server fault, so the shelf shows a plain retry
// hint while the details go to the server log.
const TASK_FAILURE_MESSAGE = "导入过程中出错，请重试";

// The in-flight tasks, so shutdown can give running imports a grace
// window before SQLite closes instead of snapping writes mid-batch
// (audit 2026-10-23).
const inFlight = new Set<Promise<void>>();

// Resolves when no import task is running, or after the grace deadline —
// whichever comes first. Shutdown awaits this before closing the database.
export function drainImportTasks(graceMs: number): Promise<void> {
  const running = [...inFlight];
  if (running.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let waiting = running.length;
    const settled = (): void => {
      waiting -= 1;
      if (waiting === 0) resolve();
    };
    for (const task of running) {
      task.then(settled, settled);
    }
    setTimeout(resolve, graceMs).unref();
  });
}

// Runs one book's annotation pass to completion. The Translator contract is
// total (it reports failures as nulls, never throws), so the only errors
// reaching the catch are genuine faults; they fail the book's import with
// a clear shelf message instead of leaving it importing forever. This
// function never throws — the router fires it without awaiting. All writes
// go through the book store, whose guards keep a deleted (or already
// settled) book from being resurrected by a late tick.
export async function runImportTask(
  deps: {
    database: Database.Database;
    dictionary: Dictionary;
    translator?: Translator | null;
  },
  bookId: number,
  book: PreparedBook
): Promise<void> {
  const task = runImportTaskInner(deps, bookId, book);
  inFlight.add(task);
  try {
    await task;
  } finally {
    inFlight.delete(task);
  }
}

async function runImportTaskInner(
  deps: {
    database: Database.Database;
    dictionary: Dictionary;
    translator?: Translator | null;
  },
  bookId: number,
  book: PreparedBook
): Promise<void> {
  const { database, dictionary, translator } = deps;
  try {
    const chapterBlocks = buildChapterBlocks(book, dictionary);
    // One traversal holds the sentence-block references. The translator's
    // input is their text at the call site below, and the write-back
    // mutates these same objects, so the join back into chapterBlocks —
    // and into persistBook — is object identity, not a second filtered
    // count that could drift from this one (.scratch/translation-join/).
    const sentenceBlocksByChapter = chapterBlocks.map((blocks) =>
      blocks.filter((block) => block.kind === "sentence")
    );
    const sentenceCount = sentenceBlocksByChapter.flat().length;

    if (translator && sentenceCount > 0) {
      setImportProgress(database, bookId, "translating", 0);
      const translationsByChapter = await translateChapters(
        translator,
        sentenceBlocksByChapter.map((blocks) =>
          blocks.map((block) => block.text)
        ),
        (done) => {
          // Retry rounds re-process sentences that already counted, so the
          // slot counter can reach total while work is still in flight;
          // 99 is the honest ceiling until the loop itself returns.
          setImportProgress(
            database,
            bookId,
            "translating",
            Math.min(99, Math.round((done / sentenceCount) * 100))
          );
        }
      );
      sentenceBlocksByChapter.forEach((blocks, chapterIndex) => {
        const translations = translationsByChapter[chapterIndex] ?? [];
        blocks.forEach((block, index) => {
          block.translation = translations[index] ?? null;
        });
      });
    }

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
