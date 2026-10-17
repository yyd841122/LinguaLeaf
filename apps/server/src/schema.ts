import type Database from "better-sqlite3";

// Schema for the import pipeline. `ipa_text` is filled at import time from
// the local dictionary (ticket 03); `translation_text` stays NULL until the
// translation ticket (04) fills it. Either way NULL renders as an empty
// placeholder line in the reading view.
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
      ipa_text TEXT,
      translation_text TEXT,
      UNIQUE (chapter_id, position)
    );
  `);
}
