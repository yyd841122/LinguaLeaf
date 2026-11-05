import type Database from "better-sqlite3";
import type { NoteAnchor, NoteType, ReviewNoteEntry } from "../../src/wire.js";
import {
  addNote,
  createImportingBook,
  persistBook,
  settleImport,
} from "../../src/book-store.js";

// Insert out of reading order, including duplicate book/chapter titles.
// Group identity must follow ids/positions, never the display strings.
export function seedReview(database: Database.Database) {
  const first = createImportingBook(database, "Same title", "markdown", null);
  const second = createImportingBook(database, "Same title", "epub", null);
  const empty = createImportingBook(database, "No notes", "markdown", null);
  const importing = createImportingBook(database, "Importing", "pdf", 10);
  const failed = createImportingBook(database, "Failed", "pdf", 10);
  settleImport(database, failed, "failed", "Failed import");
  for (const id of [first, second, empty]) {
    persistBook(
      database,
      id,
      [1, 2].map(() => ({
        title: "Same chapter title",
        level: null,
        blocks: (["sentence", "raw"] as const).map((kind) => ({
          kind,
          text: "A block.",
          ipaSlots: null,
          ipaText: null,
          translation: null,
        })),
      }))
    );
    settleImport(database, id, "ready", null);
  }
  const entry = (
    bookId: number,
    anchor: NoteAnchor,
    type: NoteType
  ): ReviewNoteEntry => {
    const result = addNote(database, bookId, anchor, {
      type,
      text: `${bookId}:${anchor.chapter}:${anchor.block}:${type}\nFull note`,
    });
    if (result.outcome !== "created")
      throw new Error("fixture note not created");
    return {
      bookId,
      bookTitle: "Same title",
      chapterPosition: anchor.chapter ?? 0,
      chapterTitle: anchor.chapter === null ? "文章笔记" : "Same chapter title",
      note: result.note,
    };
  };
  const secondEntry = entry(second, { chapter: 1, block: 1 }, "idea");
  const lateChapter = entry(first, { chapter: 2, block: 1 }, "feeling");
  const lateBlock = entry(first, { chapter: 1, block: 2 }, "idea");
  const types = (["question", "idea", "feeling", "progress"] as const)
    .map((type) => entry(first, { chapter: 1, block: 1 }, type))
    .reverse();
  const article = entry(first, { chapter: null, block: null }, "question");
  return {
    first,
    second,
    empty,
    importing,
    failed,
    entries: [article, ...types, lateBlock, lateChapter, secondEntry],
  };
}
