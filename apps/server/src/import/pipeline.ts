import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import { buildIpaLine } from "../dict/ipa-line.js";
import { MARKDOWN_EXTENSION, renderMarkdownToChapters } from "./markdown.js";
import { splitSentences } from "./sentences.js";

export type ImportedBook = {
  id: number;
  title: string;
  format: "markdown";
  createdAt: string;
};

// Runs the whole import synchronously: extraction, sentence splitting and
// per-word IPA lookups against the local dictionary are all fast; the
// asynchronous pipeline (translation, progress reporting) arrives with
// ticket 04. Words the dictionary does not know leave an empty slot on the
// IPA line instead of failing the sentence.
export function importMarkdownBook(
  database: Database.Database,
  upload: { filename: string; content: string },
  dictionary: Dictionary
): ImportedBook {
  const chapters = renderMarkdownToChapters(upload.content);
  // Prefer the book's own first heading, then the file name.
  const fileTitle = upload.filename.replace(MARKDOWN_EXTENSION, "").trim();
  const title =
    chapters.find((chapter) => chapter.level !== null)?.title ??
    (fileTitle || "Untitled");
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
      "INSERT INTO blocks (chapter_id, position, kind, original_text, ipa_text) VALUES (?, ?, ?, ?, ?)"
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
            insertBlock.run(
              chapterId,
              position,
              "sentence",
              sentence,
              buildIpaLine(dictionary, sentence)
            );
          }
        } else {
          position += 1;
          // Code and passthrough items are never annotated (spec: 代码块与
          // 链接不做标注), so their annotation columns stay NULL.
          insertBlock.run(chapterId, position, item.kind, item.text, null);
        }
      }
    });
    return bookId;
  });

  return { id: importBook(), title, format: "markdown", createdAt };
}
