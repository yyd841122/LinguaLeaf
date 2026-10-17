import { Router } from "express";
import multer from "multer";
import type Database from "better-sqlite3";
import { importMarkdownBook } from "./import/pipeline.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function createBooksRouter(database: Database.Database): Router {
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
    (request, response) => {
      const file = request.file;
      if (!file || !/\.(md|markdown)$/i.test(file.originalname)) {
        response.status(415).json({
          error: "only .md or .markdown files are accepted",
        });
        return;
      }
      const title =
        typeof request.body?.title === "string"
          ? request.body.title
          : undefined;
      const book = importMarkdownBook(database, {
        filename: file.originalname,
        content: file.buffer.toString("utf8"),
        title,
      });
      response.status(201).json(book);
    }
  );

  router.get("/", (_request, response) => {
    const rows = database
      .prepare("SELECT id, title, format, created_at FROM books ORDER BY id")
      .all() as {
      id: number;
      title: string;
      format: string;
      created_at: string;
    }[];
    response.json({
      books: rows.map((row) => ({
        id: row.id,
        title: row.title,
        format: row.format,
        createdAt: row.created_at,
      })),
    });
  });

  router.get("/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    const book = database
      .prepare("SELECT id, title, format, created_at FROM books WHERE id = ?")
      .get(id) as
      | { id: number; title: string; format: string; created_at: string }
      | undefined;
    if (!book) {
      response.status(404).json({ error: "book not found" });
      return;
    }
    const chapters = database
      .prepare(
        "SELECT position, title, level FROM chapters WHERE book_id = ? ORDER BY position"
      )
      .all(id);
    response.json({
      id: book.id,
      title: book.title,
      format: book.format,
      createdAt: book.created_at,
      chapters,
    });
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
        "SELECT position, kind, original_text, ipa_text, translation_text FROM blocks WHERE chapter_id = ? ORDER BY position"
      )
      .all(chapter.id) as {
      position: number;
      kind: string;
      original_text: string;
      ipa_text: string | null;
      translation_text: string | null;
    }[];
    const blocks = blockRows.map((row) =>
      row.kind === "sentence"
        ? {
            position: row.position,
            kind: "sentence" as const,
            originalText: row.original_text,
            ipaText: row.ipa_text,
            translationText: row.translation_text,
          }
        : {
            position: row.position,
            kind: row.kind as "code" | "raw",
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
