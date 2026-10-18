import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import type { Translator } from "../translate/translator.js";
import { translateChapters } from "../translate/batch.js";
import {
  buildChapterBlocks,
  persistBook,
  type BookFormat,
  type PreparedBook,
} from "./pipeline.js";

// The shelf states of a book (ticket 08). 'importing' covers everything
// between the POST that created the row and the annotation transaction;
// the reader-facing states are 'ready' and 'failed'.
export type BookStatus = "importing" | "ready" | "failed";

// The stages the bookshelf shows while importing. IPA lookups and insert
// are effectively instant; only 'translating' lasts long enough to be
// watched, so it is the one stage that carries a percent.
export type ImportStage = "annotating" | "translating" | "saving";

// Stored on books.import_error. The synchronous POST already reports
// specific parse problems (400/415); everything that can still fail after
// that is an unexpected server fault, so the shelf shows a plain retry
// hint while the details go to the server log.
const TASK_FAILURE_MESSAGE = "导入过程中出错，请重试";
// A server restart orphans any in-flight import — its task is gone and can
// never resume. The startup sweep moves those rows to 'failed' so the
// shelf never shows a permanently importing book.
export const INTERRUPTED_MESSAGE = "服务重启，导入中断";

// Creates the book row the moment parsing has succeeded: the POST answers
// with this id while the annotation task keeps running in the background.
export function createImportingBook(
  database: Database.Database,
  title: string,
  format: BookFormat
): number {
  return Number(
    database
      .prepare(
        "INSERT INTO books (title, format, created_at, status, import_stage) VALUES (?, ?, ?, 'importing', 'annotating')"
      )
      .run(title, format, new Date().toISOString()).lastInsertRowid
  );
}

// Progress updates are single UPDATEs guarded on status = 'importing', so a
// book deleted (or already failed) mid-import is never resurrected.
function setImportProgress(
  database: Database.Database,
  bookId: number,
  stage: ImportStage,
  percent: number | null
): void {
  database
    .prepare(
      "UPDATE books SET import_stage = ?, import_percent = ? WHERE id = ? AND status = 'importing'"
    )
    .run(stage, percent, bookId);
}

// The "import settled" SET shape, shared by the task's completion paths and
// the startup sweep so the columns live in exactly one place.
const SETTLED_ASSIGNMENT =
  "status = ?, import_stage = NULL, import_percent = NULL, import_error = ?";

function markImportSettled(
  database: Database.Database,
  bookId: number,
  status: "ready" | "failed",
  error: string | null
): void {
  database
    .prepare(
      `UPDATE books SET ${SETTLED_ASSIGNMENT} WHERE id = ? AND status = 'importing'`
    )
    .run(status, error, bookId);
}

// Runs one book's annotation pass to completion. The Translator contract is
// total (it reports failures as nulls, never throws), so the only errors
// reaching the catch are genuine faults; they fail the book's import with
// a clear shelf message instead of leaving it importing forever. This
// function never throws — the router fires it without awaiting.
export async function runImportTask(
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
    const sentencesByChapter = chapterBlocks.map((blocks) =>
      blocks
        .filter((block) => block.kind === "sentence")
        .map((block) => block.text)
    );
    const sentenceCount = sentencesByChapter.flat().length;

    if (translator && sentenceCount > 0) {
      setImportProgress(database, bookId, "translating", 0);
      const translationsByChapter = await translateChapters(
        translator,
        sentencesByChapter,
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
      chapterBlocks.forEach((blocks, chapterIndex) => {
        const translations = translationsByChapter[chapterIndex] ?? [];
        let sentenceIndex = 0;
        for (const block of blocks) {
          if (block.kind === "sentence") {
            block.translation = translations[sentenceIndex] ?? null;
            sentenceIndex += 1;
          }
        }
      });
    }

    setImportProgress(database, bookId, "saving", null);
    const persisted = persistBook(database, bookId, book, chapterBlocks);
    if (persisted) {
      markImportSettled(database, bookId, "ready", null);
    }
    // Not persisted: the book was deleted mid-import; nothing to settle.
  } catch (error) {
    console.error(`Import of book ${bookId} failed:`, error);
    markImportSettled(database, bookId, "failed", TASK_FAILURE_MESSAGE);
  }
}

// Startup recovery for imports orphaned by a server restart. Any row still
// 'importing' belongs to a task that no longer exists.
export function failInterruptedImports(database: Database.Database): void {
  const interrupted = database
    .prepare(
      `UPDATE books SET ${SETTLED_ASSIGNMENT} WHERE status = 'importing'`
    )
    .run("failed", INTERRUPTED_MESSAGE);
  if (interrupted.changes > 0) {
    console.warn(
      `${interrupted.changes} import(s) were interrupted by a restart and are marked failed on the shelf.`
    );
  }
}
