import type Database from "better-sqlite3";

// Schema for the import pipeline. `ipa_slots` (JSON array, one entry per
// word token) and `ipa_text` (flat fallback line) are filled at import time
// from the local dictionary (ticket 03); `translation_text` is filled at
// import time by the configured translator (ticket 04) and stays NULL for
// sentences whose translation failed or when none is configured. NULL
// renders as an empty placeholder in the reading view. `reading_progress`
// (ticket 05) remembers where each book was last read — one row per book,
// server-side so reopening on any device restores the position. Blocks of
// kind 'image' (ticket 07) hold the illustration's alt text in
// original_text and never carry annotations.
const booksTable = `
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      format TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
`;

const chaptersTable = `
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      level INTEGER,
      UNIQUE (book_id, position)
    );
`;

const blocksTable = (name: string) => `
    CREATE TABLE IF NOT EXISTS ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('sentence', 'code', 'raw', 'image')),
      original_text TEXT NOT NULL,
      ipa_slots TEXT,
      ipa_text TEXT,
      translation_text TEXT,
      UNIQUE (chapter_id, position)
    );
`;

const readingProgressTable = `
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      chapter_position INTEGER NOT NULL,
      block_position INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
`;

export function migrateSchema(database: Database.Database): void {
  database.exec(
    `${booksTable}${chaptersTable}${blocksTable("blocks")}${readingProgressTable}`
  );
  // Databases created before ticket 03's word-pairing work lack the slots
  // column; add it in place so an existing .data file keeps working. Runs
  // before the kind rebuild below so the rebuild's copy can read the column.
  const blockColumns = database.prepare("PRAGMA table_info(blocks)").all() as {
    name: string;
  }[];
  if (!blockColumns.some((column) => column.name === "ipa_slots")) {
    database.exec("ALTER TABLE blocks ADD COLUMN ipa_slots TEXT");
  }
  // Databases created before ticket 07 carry a kind CHECK without 'image'.
  // SQLite cannot alter a CHECK constraint; the table is rebuilt in place
  // (sqlite.org/lang_altertable.html) with every row carried over.
  const blocksSql = (
    database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'blocks'"
      )
      .get() as { sql: string } | undefined
  )?.sql;
  if (blocksSql && !blocksSql.includes("'image'")) {
    database.pragma("foreign_keys = OFF");
    try {
      database.transaction(() => {
        database.exec(blocksTable("blocks_new"));
        database.exec(`INSERT INTO blocks_new
            (id, chapter_id, position, kind, original_text, ipa_slots, ipa_text, translation_text)
          SELECT id, chapter_id, position, kind, original_text, ipa_slots, ipa_text, translation_text
            FROM blocks`);
        database.exec("DROP TABLE blocks");
        database.exec("ALTER TABLE blocks_new RENAME TO blocks");
      })();
    } finally {
      database.pragma("foreign_keys = ON");
    }
  }
}
