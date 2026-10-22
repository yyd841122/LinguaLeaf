import type Database from "better-sqlite3";

// The book store: every SQL statement over the four book tables — books,
// chapters, blocks, reading_progress — lives here and nowhere else. The
// interface is plain functions (dictionary.ts idiom), database first. What
// the module hides: the column lists (one per table), the ipa_slots JSON
// codec, the decode from snake_case rows to the readers' camelCase shapes,
// the transaction boundary around an import's writes, and the resurrection
// guards — no import write may touch a book that is gone, and progress
// writes only touch a book that is still importing. Callers hold the
// envelopes: books-router the HTTP, import-task the orchestration, export
// the rendering. schema.ts keeps DDL and migrations, which by nature run
// before any of these shapes exist.

// The shelf states of a book (ticket 08). 'importing' covers everything
// between the POST that created the row and the settle write; the
// reader-facing states are 'ready' and 'failed'.
export type BookStatus = "importing" | "ready" | "failed";

// The stages the bookshelf shows while importing. IPA lookups and insert
// are effectively instant; only 'translating' lasts long enough to be
// watched, so it is the one stage that carries a percent.
export type ImportStage = "annotating" | "translating" | "saving";

// The block kinds the data model stores — mirrors the blocks.kind CHECK in
// schema.ts (SQL cannot import it); adding a kind means touching this union
// and the schema CHECK together.
export type BlockKind = "sentence" | "code" | "raw" | "image";

// One block row as the import writes it: everything the insert needs,
// derived in pipeline.ts's single pass over the extracted chapters so the
// translation alignment can never drift from what gets inserted.
export type BlockRow = {
  kind: BlockKind;
  text: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translation: string | null;
};

// A chapter's head fields, handed to persistBook alongside its blocks (the
// two arrays zip by position).
export type PersistChapter = {
  title: string;
  level: number | null;
};

// A book row as the books table holds it.
export type BookRow = {
  id: number;
  title: string;
  format: string;
  created_at: string;
  status: BookStatus;
  import_stage: string | null;
  import_percent: number | null;
  import_error: string | null;
  page_count: number | null;
};

// A shelf row: the book plus where it was last read, null before the first
// reading session (LEFT JOIN from reading_progress).
export type ShelfEntry = BookRow & {
  progress_chapter: number | null;
  progress_block: number | null;
};

// A chapter head as the table-of-contents route serves it.
export type ChapterHead = {
  position: number;
  title: string;
  level: number | null;
};

// One block as the readers see it: sentence blocks carry the three
// annotation lines (slots decoded to their array), every other kind only
// its text.
export type SentenceBlockData = {
  position: number;
  kind: "sentence";
  originalText: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translationText: string | null;
};

export type PlainBlockData = {
  position: number;
  kind: Exclude<BlockKind, "sentence">;
  originalText: string;
};

export type BlockData = SentenceBlockData | PlainBlockData;

// A chapter as both readers (the chapter route, the export) consume it.
export type ChapterData = ChapterHead & {
  blocks: BlockData[];
};

// The books columns every reader query fetches, kept in one place so the
// BookRow cast cannot drift from what the SELECTs deliver (a missed column
// would typecheck through the cast and fail only at runtime).
const BOOK_COLUMNS = [
  "id",
  "title",
  "format",
  "created_at",
  "status",
  "import_stage",
  "import_percent",
  "import_error",
  "page_count",
] as const;
const bookColumnSql = (prefix: string) =>
  BOOK_COLUMNS.map((column) => `${prefix}${column}`).join(", ");

// The ipa_slots codec: the column holds a JSON array with one transcription
// per word token, written by persistBook and read back by both readers. A
// row that is not valid JSON (or not an array) throws at the read — loud
// and local, instead of a silently wrong IPA line.
const encodeIpaSlots = (slots: string[] | null): string | null =>
  slots === null ? null : JSON.stringify(slots);

const decodeIpaSlots = (value: string | null): string[] | null => {
  if (value === null) return null;
  const slots: unknown = JSON.parse(value);
  if (!Array.isArray(slots)) {
    throw new Error(`corrupt ipa_slots row: ${value}`);
  }
  return slots;
};

// One snake_case block row → its decoded shape. Both readers share this so
// the kind narrowing (sentence vs everything else) lives in exactly one
// place.
type BlockSqlRow = {
  position: number;
  kind: string;
  original_text: string;
  ipa_slots: string | null;
  ipa_text: string | null;
  translation_text: string | null;
};

const decodeBlock = (row: BlockSqlRow): BlockData =>
  row.kind === "sentence"
    ? {
        position: row.position,
        kind: "sentence",
        originalText: row.original_text,
        ipaSlots: decodeIpaSlots(row.ipa_slots),
        ipaText: row.ipa_text,
        translationText: row.translation_text,
      }
    : {
        position: row.position,
        kind: row.kind as PlainBlockData["kind"],
        originalText: row.original_text,
      };

// Creates the book row the moment parsing has succeeded: the POST answers
// with this id while the annotation task keeps running in the background.
// The row starts 'importing' in the 'annotating' stage; pageCount (PDF
// only, null otherwise) lands with the row so the shelf can show the
// long-book hint for the whole import.
export function createImportingBook(
  database: Database.Database,
  title: string,
  format: string,
  pageCount: number | null
): number {
  return Number(
    database
      .prepare(
        "INSERT INTO books (title, format, created_at, status, import_stage, page_count) VALUES (?, ?, ?, 'importing', 'annotating', ?)"
      )
      .run(title, format, new Date().toISOString(), pageCount).lastInsertRowid
  );
}

// Inserts the finished chapters and blocks under an existing book row, in
// one transaction: a crash partway through leaves no half-built book, and
// the reader only ever sees a book whose every block is there. Returns
// false when the book row disappeared while the task ran — the reader
// deleted the book mid-import, and their intent wins.
export function persistBook(
  database: Database.Database,
  bookId: number,
  chapters: PersistChapter[],
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
      for (const block of chapterBlocks[chapterIndex] ?? []) {
        position += 1;
        insertBlock.run(
          chapterId,
          position,
          block.kind,
          block.text,
          encodeIpaSlots(block.ipaSlots),
          block.ipaText,
          block.translation
        );
      }
    });
    return true;
  });
  return persist();
}

// Progress updates are single UPDATEs guarded on status = 'importing', so a
// book deleted (or already settled) mid-import is never resurrected.
export function setImportProgress(
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

// Flips an importing book to its settled state ('ready' or 'failed'),
// clearing the live progress columns. Guarded like every import write: a
// book already settled or deleted stays as it is.
export function settleImport(
  database: Database.Database,
  bookId: number,
  status: Exclude<BookStatus, "importing">,
  error: string | null
): void {
  database
    .prepare(
      `UPDATE books SET ${SETTLED_ASSIGNMENT} WHERE id = ? AND status = 'importing'`
    )
    .run(status, error, bookId);
}

// Stored on books.import_error for a book the startup sweep settled: the
// import's task died with the previous server process, so there is nothing
// specific to report — the shelf shows the restart as the reason.
export const INTERRUPTED_MESSAGE = "服务重启，导入中断";

// Startup recovery for imports orphaned by a server restart. Any row still
// 'importing' belongs to a task that no longer exists and can never resume;
// the sweep moves those rows to 'failed' so the shelf never shows a
// permanently importing book. Returns how many rows it settled (the
// caller logs — a store stays quiet).
export function failInterruptedImports(database: Database.Database): number {
  const interrupted = database
    .prepare(
      `UPDATE books SET ${SETTLED_ASSIGNMENT} WHERE status = 'importing'`
    )
    .run("failed", INTERRUPTED_MESSAGE);
  return interrupted.changes;
}

export function findBookRow(
  database: Database.Database,
  id: number
): BookRow | undefined {
  return database
    .prepare(`SELECT ${bookColumnSql("")} FROM books WHERE id = ?`)
    .get(id) as BookRow | undefined;
}

// The shelf: every book in id order with its last reading position, one
// LEFT JOIN so a book before its first session still lists (progress null).
export function listShelf(database: Database.Database): ShelfEntry[] {
  return database
    .prepare(
      `SELECT ${bookColumnSql("b.")},
              p.chapter_position AS progress_chapter,
              p.block_position AS progress_block
       FROM books b
       LEFT JOIN reading_progress p ON p.book_id = b.id
       ORDER BY b.id`
    )
    .all() as ShelfEntry[];
}

// The table of contents: every chapter head in reading order.
export function listChapters(
  database: Database.Database,
  bookId: number
): ChapterHead[] {
  return database
    .prepare(
      "SELECT position, title, level FROM chapters WHERE book_id = ? ORDER BY position"
    )
    .all(bookId) as ChapterHead[];
}

// The saved reading position, or undefined before the first session (the
// route answers a distinct 404 — a missing book is a different 404).
export function getProgress(
  database: Database.Database,
  bookId: number
): { chapter: number; block: number } | undefined {
  const row = database
    .prepare(
      "SELECT chapter_position, block_position FROM reading_progress WHERE book_id = ?"
    )
    .get(bookId) as
    { chapter_position: number; block_position: number } | undefined;
  return row
    ? { chapter: row.chapter_position, block: row.block_position }
    : undefined;
}

// Upserts the reading position — one row per book, server-side so
// reopening on any device restores the position.
export function saveProgress(
  database: Database.Database,
  bookId: number,
  chapter: number,
  block: number
): void {
  database
    .prepare(
      `INSERT INTO reading_progress (book_id, chapter_position, block_position, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         chapter_position = excluded.chapter_position,
         block_position = excluded.block_position,
         updated_at = excluded.updated_at`
    )
    .run(bookId, chapter, block, new Date().toISOString());
}

// Deletes the book; its chapters, blocks, and reading_progress go with it
// through their ON DELETE CASCADE foreign keys (the pragma is on).
export function deleteBook(database: Database.Database, bookId: number): void {
  database.prepare("DELETE FROM books WHERE id = ?").run(bookId);
}

// One chapter, decoded: the chapter head plus its blocks in reading order.
// undefined when the book has no such chapter.
export function loadChapter(
  database: Database.Database,
  bookId: number,
  chapterPosition: number
): ChapterData | undefined {
  const chapter = database
    .prepare(
      "SELECT id, position, title, level FROM chapters WHERE book_id = ? AND position = ?"
    )
    .get(bookId, chapterPosition) as (ChapterHead & { id: number }) | undefined;
  if (!chapter) return undefined;
  const blockRows = database
    .prepare(
      "SELECT position, kind, original_text, ipa_slots, ipa_text, translation_text FROM blocks WHERE chapter_id = ? ORDER BY position"
    )
    .all(chapter.id) as BlockSqlRow[];
  return {
    position: chapter.position,
    title: chapter.title,
    level: chapter.level,
    blocks: blockRows.map(decodeBlock),
  };
}

// The whole book in one joined pass (the export is the only consumer that
// needs every chapter at once): chapters LEFT JOIN blocks so a
// heading-only chapter still renders (its section just has no blocks).
export function loadWholeBook(
  database: Database.Database,
  bookId: number
): ChapterData[] {
  const rows = database
    .prepare(
      `SELECT c.position AS chapter_position, c.title AS chapter_title, c.level AS chapter_level,
              b.position AS block_position, b.kind, b.original_text,
              b.ipa_slots, b.ipa_text, b.translation_text
       FROM chapters c
       LEFT JOIN blocks b ON b.chapter_id = c.id
       WHERE c.book_id = ?
       ORDER BY c.position, b.position`
    )
    .all(bookId) as {
    chapter_position: number;
    chapter_title: string;
    chapter_level: number | null;
    block_position: number | null;
    kind: string | null;
    original_text: string | null;
    ipa_slots: string | null;
    ipa_text: string | null;
    translation_text: string | null;
  }[];

  const chapters: ChapterData[] = [];
  for (const row of rows) {
    let chapter = chapters.at(-1);
    if (!chapter || chapter.position !== row.chapter_position) {
      chapter = {
        position: row.chapter_position,
        title: row.chapter_title,
        level: row.chapter_level,
        blocks: [],
      };
      chapters.push(chapter);
    }
    // A block row carries its position; the LEFT JOIN's null side (kind
    // null, no blocks) is skipped — a heading-only chapter keeps [].
    if (row.kind !== null) {
      chapter.blocks.push(
        decodeBlock({
          position: row.block_position as number,
          kind: row.kind,
          original_text: row.original_text ?? "",
          ipa_slots: row.ipa_slots,
          ipa_text: row.ipa_text,
          translation_text: row.translation_text,
        })
      );
    }
  }
  return chapters;
}
