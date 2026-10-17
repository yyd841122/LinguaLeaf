import type Database from "better-sqlite3";
import { renderMarkdownToChapters } from "./markdown.js";
import { splitSentences } from "./sentences.js";

export type ImportedBook = {
  id: number;
  title: string;
  format: "markdown";
  createdAt: string;
};

// Runs the whole import synchronously: extraction and sentence splitting are
// fast; the asynchronous pipeline (translation, progress reporting) arrives
// with the annotation tickets.
export function importMarkdownBook(
  database: Database.Database,
  upload: { filename: string; content: string; title?: string }
): ImportedBook {
  const chapters = renderMarkdownToChapters(upload.content);
  const title =
    normalizeTitle(upload.title) ??
    // Prefer the book's own first heading, then the file name.
    chapters.find((chapter) => chapter.level !== null)?.title ??
    baseName(upload.filename) ??
    "Untitled";
  const createdAt = new Date().toISOString();

  const importBook = database.transaction((): number => {
    const bookId = Number(
      database
        .prepare(
          "INSERT INTO books (title, format, created_at) VALUES (?, ?, ?)"
        )
        .run(title, "markdown", createdAt).lastInsertRowid
    );
    const insertChapter = database.prepare(
      "INSERT INTO chapters (book_id, position, title, level) VALUES (?, ?, ?, ?)"
    );
    const insertBlock = database.prepare(
      "INSERT INTO blocks (chapter_id, position, kind, original_text) VALUES (?, ?, ?, ?)"
    );
    chapters.forEach((chapter, chapterIndex) => {
      const chapterId = Number(
        insertChapter.run(
          bookId,
          chapterIndex + 1,
          chapter.title,
          chapter.level
        ).lastInsertRowid
      );
      let position = 0;
      for (const item of chapter.items) {
        if (item.kind === "paragraph") {
          for (const sentence of splitSentences(item.text)) {
            position += 1;
            insertBlock.run(chapterId, position, "sentence", sentence);
          }
        } else {
          position += 1;
          insertBlock.run(chapterId, position, item.kind, item.text);
        }
      }
    });
    return bookId;
  });

  return { id: importBook(), title, format: "markdown", createdAt };
}

function normalizeTitle(title: string | undefined): string | null {
  const trimmed = title?.trim();
  return trimmed ? trimmed : null;
}

function baseName(filename: string): string | null {
  const withoutExtension = filename.replace(/\.(md|markdown)$/i, "");
  return withoutExtension || null;
}
