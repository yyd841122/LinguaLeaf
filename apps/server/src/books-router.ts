import { Router, json, type Request, type Response } from "express";
import multer from "multer";
import type Database from "better-sqlite3";
import type { Dictionary } from "./dict/dictionary.js";
import { readUpload, UNSUPPORTED_FORMAT } from "./import/format-readers.js";
import { REJECTION_STATUS, UploadRejected } from "./import/upload-rejection.js";
import {
  annotatedBookFilename,
  renderAnnotatedBook,
} from "./export/annotated-book.js";
import type { Translator } from "./translate/translator.js";
import { runChapterTranslationTask } from "./translate/chapter-task.js";
import { runImportTask } from "./import/import-task.js";
import {
  beginChapterTranslation,
  createImportingBook,
  deleteBook,
  findBookRow,
  findChapterRow,
  getProgress,
  listChapters,
  listShelf,
  loadChapter,
  loadWholeBook,
  saveProgress,
  type BookRow,
  type ShelfEntry,
} from "./book-store.js";
import type { ImportRejection } from "./wire.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// The one response path for a coded upload rejection: the wire body is
// reason + rewordable prose, the status comes from the one table.
const respondRejection = (
  response: Response,
  rejection: UploadRejected
): void => {
  response.status(REJECTION_STATUS[rejection.reason]).json({
    code: rejection.reason,
    error: rejection.message,
  } satisfies ImportRejection);
};

const toBookJson = (row: BookRow) => ({
  id: row.id,
  title: row.title,
  format: row.format,
  createdAt: row.created_at,
  status: row.status,
  importStage: row.import_stage,
  importPercent: row.import_percent,
  importError: row.import_error,
  pageCount: row.page_count,
});

const toShelfJson = (row: ShelfEntry) => ({
  ...toBookJson(row),
  progress:
    row.progress_chapter === null || row.progress_block === null
      ? null
      : { chapter: row.progress_chapter, block: row.progress_block },
});

export function createBooksRouter(
  database: Database.Database,
  dictionary: Dictionary,
  translator?: Translator | null
): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    // Only the "file" part carries data this route reads; field bytes,
    // field count, and total parts are capped too, so a client cannot
    // buffer memory in parts multer never hands over (audit 2026-10-23).
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      fieldSize: 1024 * 1024,
      fields: 10,
      parts: 10,
    },
  });

  router.post(
    "/",
    (request, response, next) => {
      upload.single("file")(request, response, (error: unknown) => {
        if (error instanceof multer.MulterError) {
          // The one MulterError the shelf reasons about is the size cap —
          // it rides the same coded-rejection path as the format readers,
          // since retrying can never succeed. Other multer rejects keep
          // the raw code echo (a deliberate, uncoded leftover).
          if (error.code === "LIMIT_FILE_SIZE") {
            respondRejection(
              response,
              new UploadRejected(
                "file-too-large",
                `uploaded file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`
              )
            );
          } else {
            response.status(400).json({ error: error.code });
          }
          return;
        }
        next(error);
      });
    },
    async (request, response) => {
      const file = request.file;
      if (!file) {
        response.status(415).json(UNSUPPORTED_FORMAT);
        return;
      }
      // Format front halves: bytes → extracted chapters through the
      // registry. A bad upload arrives as one UploadRejected carrying its
      // wire reason — which format rejected it, and at what cost, is the
      // readers' and the table's knowledge, not this file's.
      let prepared;
      try {
        prepared = await readUpload(file.originalname, file.buffer);
      } catch (error) {
        if (error instanceof UploadRejected) {
          respondRejection(response, error);
          return;
        }
        throw error;
      }
      // Parsing was the synchronous half; nothing has been stored yet, so a
      // rejected file leaves no trace. The annotation work (sentence split
      // and IPA) runs as a background task on the created row: the POST
      // answers 202 immediately, and the shelf's status carries the
      // progress (ticket 08). Translation is not the import's business
      // anymore (ADR-0004 ticket 02): chapters land untranslated and the
      // chapter trigger route owns the network work, which is why the
      // translator is not handed to the import task here.
      const bookId = createImportingBook(
        database,
        prepared.title,
        prepared.format,
        prepared.pageCount ?? null
      );
      void runImportTask({ database, dictionary }, bookId, prepared);
      const row = findBookRow(database, bookId);
      if (!row) {
        // Unreachable in practice — the row was just inserted — but keeps
        // the handler total without asserting.
        response.status(500).json({ error: "import could not start" });
        return;
      }
      response.status(202).json(toBookJson(row));
    }
  );

  router.get("/", (_request, response) => {
    response.json({ books: listShelf(database).map(toShelfJson) });
  });

  // One parse-and-lookup for every /:id handler: a non-integer id is just a
  // book that is not there.
  const bookFromParams = (request: Request): BookRow | undefined => {
    const id = Number(request.params.id);
    return Number.isInteger(id) ? findBookRow(database, id) : undefined;
  };

  // Reading routes answer only settled books: an importing book has no
  // chapters yet and a failed one never will, so both get the same 409
  // instead of a misleading 404 or empty content.
  const respondIfNotReady = (book: BookRow, response: Response): boolean => {
    if (book.status !== "ready") {
      response.status(409).json({ error: "book is not ready for reading" });
      return true;
    }
    return false;
  };

  router.get("/:id/progress", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    if (respondIfNotReady(book, response)) return;
    const progress = getProgress(database, book.id);
    if (!progress) {
      response.status(404).json({ error: "no reading progress" });
      return;
    }
    response.json(progress);
  });

  router.delete("/:id", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    deleteBook(database, book.id);
    response.status(204).end();
  });

  // Progress positions must be whole, safe positive numbers; the guard
  // doubles as the type narrowing TS needs before the values hit SQLite.
  const isPositiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

  router.put("/:id/progress", json(), (request, response) => {
    const body = request.body as { chapter?: unknown; block?: unknown };
    const chapter = body?.chapter;
    const block = body?.block;
    if (!isPositiveInteger(chapter) || !isPositiveInteger(block)) {
      response.status(400).json({
        error: "chapter and block must be positive integers",
      });
      return;
    }
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    if (respondIfNotReady(book, response)) return;
    // Positions must exist: a progress row pointing at a chapter or block
    // the book does not have would only surface later as a dead link.
    const chapterData = loadChapter(database, book.id, chapter);
    if (
      !chapterData ||
      !chapterData.blocks.some((blockRow) => blockRow.position === block)
    ) {
      response.status(404).json({ error: "progress position not found" });
      return;
    }
    saveProgress(database, book.id, chapter, block);
    response.json({ chapter, block });
  });

  // Export answers with the annotated book file (GLOSSARY.md): the same
  // reading guard as the chapter routes — only settled books have blocks to
  // render — then a self-contained HTML attachment whose filename carries
  // the book title.
  router.get("/:id/export", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    if (respondIfNotReady(book, response)) return;
    response
      .type("html")
      .attachment(annotatedBookFilename(book.title))
      .send(
        renderAnnotatedBook(
          book.title,
          loadWholeBook(database, book.id),
          dictionary
        )
      );
  });

  router.get("/:id", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    const chapters = listChapters(database, book.id);
    response.json({ ...toBookJson(book), chapters });
  });

  router.get("/:id/chapters/:chapter", (request, response) => {
    const bookId = Number(request.params.id);
    const chapterPosition = Number(request.params.chapter);
    if (!Number.isInteger(bookId) || !Number.isInteger(chapterPosition)) {
      response.status(404).json({ error: "chapter not found" });
      return;
    }
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "chapter not found" });
      return;
    }
    if (respondIfNotReady(book, response)) return;
    const chapter = loadChapter(database, bookId, chapterPosition);
    if (!chapter) {
      response.status(404).json({ error: "chapter not found" });
      return;
    }
    response.json(chapter);
  });

  // The on-demand translation trigger (ADR-0004): same guard family as the
  // reading routes above, then the chapter's own state machine — an atomic
  // claim that answers 409 while the chapter is translating, after which
  // the task runs in the background. 202 carries the chapter payload in
  // its brand-new translating state: the reading page's poll reads the
  // same shape and refreshes the lines when the state leaves translating.
  router.post("/:id/chapters/:chapter/translate", (request, response) => {
    const bookId = Number(request.params.id);
    const chapterPosition = Number(request.params.chapter);
    if (!Number.isInteger(bookId) || !Number.isInteger(chapterPosition)) {
      response.status(404).json({ error: "chapter not found" });
      return;
    }
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    if (respondIfNotReady(book, response)) return;
    const chapter = findChapterRow(database, book.id, chapterPosition);
    if (!chapter) {
      response.status(404).json({ error: "chapter not found" });
      return;
    }
    if (!translator) {
      // Ticket 03 greys the button off this condition; until then the
      // route stays honest on its own: no service, no claim, nothing to
      // poll — a 409 with the reason beside it.
      response
        .status(409)
        .json({ error: "translation service is not configured" });
      return;
    }
    // The claim is the concurrency guard: one UPDATE, so a second trigger
    // while this chapter translates cannot slip through. Different
    // chapters claim independently — no serial queue (spec decision 2).
    if (!beginChapterTranslation(database, chapter.id)) {
      response.status(409).json({ error: "chapter is already translating" });
      return;
    }
    void runChapterTranslationTask({ database, translator }, chapter.id);
    const payload = loadChapter(database, book.id, chapterPosition);
    if (!payload) {
      // Unreachable in practice — the chapter was just claimed — but keeps
      // the handler total without asserting.
      response.status(500).json({ error: "translation could not start" });
      return;
    }
    response.status(202).json(payload);
  });

  return router;
}
