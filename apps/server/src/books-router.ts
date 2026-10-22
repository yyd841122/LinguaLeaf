import { Router, json, type Request, type Response } from "express";
import multer from "multer";
import type Database from "better-sqlite3";
import type { Dictionary } from "./dict/dictionary.js";
import { EpubParseError, isEpubFilename, readEpubBook } from "./import/epub.js";
import {
  EncryptedPdfError,
  isPdfFilename,
  PdfParseError,
  readPdfBook,
  ScannedPdfError,
} from "./import/pdf.js";
import { isMarkdownFilename, readMarkdownBook } from "./import/markdown.js";
import {
  annotatedBookFilename,
  renderAnnotatedBook,
} from "./export/annotated-book.js";
import type { Translator } from "./translate/translator.js";
import { runImportTask } from "./import/import-task.js";
import {
  createImportingBook,
  deleteBook,
  findBookRow,
  getProgress,
  listChapters,
  listShelf,
  loadChapter,
  loadWholeBook,
  saveProgress,
  type BookRow,
  type ShelfEntry,
} from "./book-store.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Shared body of both 415 branches of the upload handler.
const UNSUPPORTED_FORMAT = {
  error: "only .epub, .md, .markdown or .pdf files are accepted",
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
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  router.post(
    "/",
    (request, response, next) => {
      upload.single("file")(request, response, (error: unknown) => {
        if (error instanceof multer.MulterError) {
          response
            .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
            .json({ error: error.code });
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
      // Format front halves: bytes → extracted chapters. A broken EPUB is a
      // client error (400); everything shared runs past this point.
      let prepared;
      try {
        if (isEpubFilename(file.originalname)) {
          prepared = await readEpubBook(file.buffer, file.originalname);
        } else if (isMarkdownFilename(file.originalname)) {
          prepared = readMarkdownBook(
            file.originalname,
            file.buffer.toString("utf8")
          );
        } else if (isPdfFilename(file.originalname)) {
          prepared = await readPdfBook(file.buffer, file.originalname);
        } else {
          response.status(415).json(UNSUPPORTED_FORMAT);
          return;
        }
      } catch (error) {
        if (error instanceof EpubParseError) {
          response
            .status(400)
            .json({ error: `invalid EPUB: ${error.message}` });
          return;
        }
        if (error instanceof ScannedPdfError) {
          response.status(422).json({ error: error.message });
          return;
        }
        if (error instanceof EncryptedPdfError) {
          response.status(400).json({ error: error.message });
          return;
        }
        if (error instanceof PdfParseError) {
          response.status(400).json({ error: `invalid PDF: ${error.message}` });
          return;
        }
        throw error;
      }
      // Parsing was the synchronous half; nothing has been stored yet, so a
      // rejected file leaves no trace. The annotation work (IPA, transla-
      // tion) runs as a background task on the created row: the POST
      // answers 202 immediately (a long book's translation could hold a
      // request for hours — beyond ADR 0002's envelope), and the shelf's
      // status carries the progress (ticket 08).
      const bookId = createImportingBook(
        database,
        prepared.title,
        prepared.format,
        prepared.pageCount ?? null
      );
      void runImportTask(
        { database, dictionary, translator: translator ?? null },
        bookId,
        prepared
      );
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

  // Progress positions must be whole positive numbers; the guard doubles as
  // the type narrowing TS needs before the values hit SQLite.
  const isPositiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1;

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

  return router;
}
