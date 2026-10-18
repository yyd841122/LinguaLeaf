import { Router, json, type Request } from "express";
import multer from "multer";
import type Database from "better-sqlite3";
import type { Dictionary } from "./dict/dictionary.js";
import { EpubParseError, isEpubFilename, readEpubBook } from "./import/epub.js";
import { isMarkdownFilename, readMarkdownBook } from "./import/markdown.js";
import type { Translator } from "./translate/translator.js";
import { importBook, type BlockKind } from "./import/pipeline.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Shared body of both 415 branches of the upload handler.
const UNSUPPORTED_FORMAT = {
  error: "only .epub, .md or .markdown files are accepted",
};

type BookRow = {
  id: number;
  title: string;
  format: string;
  created_at: string;
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
        throw error;
      }
      const book = await importBook(database, prepared, dictionary, translator);
      response.status(201).json(book);
    }
  );

  router.get("/", (_request, response) => {
    const rows = database
      .prepare(
        `SELECT b.id, b.title, b.format, b.created_at,
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
      .prepare("SELECT id, title, format, created_at FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;

  // One parse-and-lookup for every /:id handler: a non-integer id is just a
  // book that is not there.
  const bookFromParams = (request: Request): BookRow | undefined => {
    const id = Number(request.params.id);
    return Number.isInteger(id) ? findBook(id) : undefined;
  };

  router.get("/:id/progress", (request, response) => {
    const book = bookFromParams(request);
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
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
