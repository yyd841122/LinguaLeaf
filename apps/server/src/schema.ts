import type Database from "better-sqlite3";

// Schema for the import pipeline. `ipa_slots` (JSON array, one entry per
// word token) and `ipa_text` (flat fallback line) are filled at import time
// from the local dictionary (ticket 03); `translation_text` stays NULL until
// the translation ticket (04) fills them. NULL renders as an empty
// placeholder in the reading view.
export function migrateSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      format TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      level INTEGER,
      UNIQUE (book_id, position)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('sentence', 'code', 'raw')),
      original_text TEXT NOT NULL,
      ipa_slots TEXT,
      ipa_text TEXT,
      translation_text TEXT,
      UNIQUE (chapter_id, position)
    );
  `);
  // Databases created before ticket 03's word-pairing work lack the slots
  // column; add it in place so an existing .data file keeps working.
  const blockColumns = database.prepare("PRAGMA table_info(blocks)").all() as {
    name: string;
  }[];
  if (!blockColumns.some((column) => column.name === "ipa_slots")) {
    database.exec("ALTER TABLE blocks ADD COLUMN ipa_slots TEXT");
  }
}
