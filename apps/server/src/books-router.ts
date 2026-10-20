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
import type { BlockKind } from "./import/pipeline.js";
import {
  createImportingBook,
  runImportTask,
  type BookStatus,
} from "./import/import-task.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Shared body of both 415 branches of the upload handler.
const UNSUPPORTED_FORMAT = {
  error: "only .epub, .md, .markdown or .pdf files are accepted",
};

type BookRow = {
  id: number;
  title: string;
  format: string;
  created_at: string;
  // Asserted from the DB row; the write sites all use the task's own union.
  status: BookStatus;
  import_stage: string | null;
  import_percent: number | null;
  import_error: string | null;
  page_count: number | null;
};

// Shelf row: the book plus where it was last read, null before the first
// reading session (LEFT JOIN from reading_progress).
type ShelfRow = BookRow & {
  progress_chapter: number | null;
  progress_block: number | null;
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

const toShelfJson = (row: ShelfRow) => ({
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
      const row = findBook(bookId);
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
    const rows = database
      .prepare(
        `SELECT b.id, b.title, b.format, b.created_at,
                b.status, b.import_stage, b.import_percent, b.import_error,
                b.page_count,
                p.chapter_position AS progress_chapter,
                p.block_position AS progress_block
         FROM books b
         LEFT JOIN reading_progress p ON p.book_id = b.id
         ORDER BY b.id`
      )
      .all() as ShelfRow[];
    response.json({ books: rows.map(toShelfJson) });
  });

  const findBook = (id: number) =>
    database
      .prepare(
        "SELECT id, title, format, created_at, status, import_stage, import_percent, import_error, page_count FROM books WHERE id = ?"
      )
      .get(id) as BookRow | undefined;

  // One parse-and-lookup for every /:id handler: a non-integer id is just a
  // book that is not there.
  const bookFromParams = (request: Request): BookRow | undefined => {
    const id = Number(request.params.id);
    return Number.isInteger(id) ? findBook(id) : undefined;
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
    const row = database
      .prepare(
        "SELECT chapter_position, block_position FROM reading_progress WHERE book_id = ?"
      )
      .get(book.id) as
      { chapter_position: number; block_position: number } | undefined;
    if (!row) {
      response.status(404).json({ error: "no reading progress" });
      return;
    }
    response.json({ chapter: row.chapter_position, block: row.block_position });
  });

  router.delete("/:id", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    // Chapters, blocks, and reading_progress go with the book through their
    // ON DELETE CASCADE foreign keys (foreign_keys pragma is on).
    database.prepare("DELETE FROM books WHERE id = ?").run(book.id);
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
    database
      .prepare(
        `INSERT INTO reading_progress (book_id, chapter_position, block_position, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           chapter_position = excluded.chapter_position,
           block_position = excluded.block_position,
           updated_at = excluded.updated_at`
      )
      .run(book.id, chapter, block, new Date().toISOString());
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
      .send(renderAnnotatedBook(database, dictionary, book));
  });

  router.get("/:id", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    const chapters = database
      .prepare(
        "SELECT position, title, level FROM chapters WHERE book_id = ? ORDER BY position"
      )
      .all(book.id);
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
    const chapter = database
      .prepare(
        "SELECT id, position, title, level FROM chapters WHERE book_id = ? AND position = ?"
      )
      .get(bookId, chapterPosition) as
      | { id: number; position: number; title: string; level: number | null }
      | undefined;
    if (!chapter) {
      response.status(404).json({ error: "chapter not found" });
      return;
    }
    const blockRows = database
      .prepare(
        "SELECT position, kind, original_text, ipa_slots, ipa_text, translation_text FROM blocks WHERE chapter_id = ? ORDER BY position"
      )
      .all(chapter.id) as {
      position: number;
      kind: string;
      original_text: string;
      ipa_slots: string | null;
      ipa_text: string | null;
      translation_text: string | null;
    }[];
    const blocks = blockRows.map((row) =>
      row.kind === "sentence"
        ? {
            position: row.position,
            kind: "sentence" as const,
            originalText: row.original_text,
            ipaSlots: row.ipa_slots
              ? (JSON.parse(row.ipa_slots) as string[])
              : null,
            ipaText: row.ipa_text,
            translationText: row.translation_text,
          }
        : {
            position: row.position,
            kind: row.kind as Exclude<BlockKind, "sentence">,
            originalText: row.original_text,
          }
    );
    response.json({
      position: chapter.position,
      title: chapter.title,
      level: chapter.level,
      blocks,
    });
  });

  return router;
}
