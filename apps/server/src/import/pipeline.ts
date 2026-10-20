import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import { buildIpaSlots } from "../dict/ipa-line.js";
import type { ExtractedChapter } from "./extract-html.js";
import { splitSentences } from "./sentences.js";

export type BookFormat = "markdown" | "epub" | "pdf";

// The block kinds the data model stores — mirrors the blocks.kind CHECK in
// schema.ts (SQL cannot import it) and the cast in books-router.ts; adding
// a kind means touching this union and the schema CHECK together.
export type BlockKind = "sentence" | "code" | "raw" | "image";

// What the format-specific front halves (markdown.ts, epub.ts) hand to the
// shared import: extracted chapters plus the book title. Everything past
// this type — sentence splitting, IPA, translation, insert — is one path.
export type PreparedBook = {
  title: string;
  format: BookFormat;
  chapters: ExtractedChapter[];
};

// One prepared block row: everything the insert needs, derived in a single
// pass over the extracted chapters so the translation alignment below can
// never drift from what gets inserted.
export type BlockRow = {
  kind: BlockKind;
  text: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translation: string | null;
};

// The annotation pass that is pure CPU: sentence splitting plus per-word
// IPA lookups against the local dictionary (all fast). Translation — the
// slow, network-bound pass — happens later in the import task
// (import-task.ts), so its progress can be reported per batch.
export function buildChapterBlocks(
  book: PreparedBook,
  dictionary: Dictionary
): BlockRow[][] {
  return book.chapters.map((chapter) => {
    const blocks: BlockRow[] = [];
    for (const item of chapter.items) {
      if (item.kind === "paragraph") {
        for (const sentence of splitSentences(item.text)) {
          const slots = buildIpaSlots(dictionary, sentence);
          blocks.push({
            kind: "sentence",
            text: sentence,
            ipaSlots: slots,
            ipaText: slots.join(" ").trim(),
            translation: null,
          });
        }
      } else if (item.kind === "image") {
        // Images stay placeholder blocks in their reading position; the
        // alt text rides in original_text (ticket 07).
        blocks.push({
          kind: "image",
          text: item.text,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        });
      } else {
        // Code and passthrough items are never annotated (spec: 代码块与
        // 链接不做标注), so their annotation columns stay NULL.
        blocks.push({
          kind: item.kind,
          text: item.text,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        });
      }
    }
    return blocks;
  });
}

// Inserts the finished chapters and blocks under an existing book row.
// Like the synchronous import before it (tickets 02–07), everything lands
// in one transaction: a crash partway through leaves no half-built book,
// and the reader only ever sees a book whose every block is there. Returns
// false when the book row disappeared while the task ran — the reader
// deleted the book mid-import, and their intent wins.
export function persistBook(
  database: Database.Database,
  bookId: number,
  book: PreparedBook,
  chapterBlocks: BlockRow[][]
): boolean {
  const persist = database.transaction((): boolean => {
    const existing = database
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(bookId);
    if (!existing) return false;
    const insertChapter = database.prepare(
      "INSERT INTO chapters (book_id, position, title, level) VALUES (?, ?, ?, ?)"
    );
    const insertBlock = database.prepare(
      "INSERT INTO blocks (chapter_id, position, kind, original_text, ipa_slots, ipa_text, translation_text) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    book.chapters.forEach((chapter, chapterIndex) => {
      const chapterId = Number(
        insertChapter.run(
          bookId,
          chapterIndex + 1,
          chapter.title,
          chapter.level
        ).lastInsertRowid
      );
      let position = 0;
      for (const block of chapterBlocks[chapterIndex] ?? []) {
        position += 1;
        insertBlock.run(
          chapterId,
          position,
          block.kind,
          block.text,
          block.ipaSlots === null ? null : JSON.stringify(block.ipaSlots),
          block.ipaText,
          block.translation
        );
      }
    });
    return true;
  });
  return persist();
}
