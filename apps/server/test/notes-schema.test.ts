import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { listNotes } from "../src/book-store.js";
import { migrateSchema } from "../src/schema.js";

function assertConstraints(db: Database.Database) {
  const insert = db.prepare(
    "INSERT INTO notes (book_id, chapter_position, block_position, type, text, created_at, updated_at) VALUES (1, ?, ?, ?, ?, 'now', 'now')"
  );
  for (const [chapter, block] of [
    [null, null],
    [1, 1],
  ]) {
    for (const type of ["progress", "feeling", "idea", "question"]) {
      insert.run(chapter, block, type, type);
      expect(() => insert.run(chapter, block, type, "Duplicate")).toThrow(
        /UNIQUE/
      );
    }
  }
  for (const [chapter, block] of [
    [null, 1],
    [1, null],
  ])
    expect(() => insert.run(chapter, block, "idea", "Half anchor")).toThrow(
      /CHECK/
    );
  expect(() => insert.run(2, 1, "other", "Bad type")).toThrow(/CHECK/);
  db.prepare("DELETE FROM books WHERE id = 1").run();
  expect(listNotes(db, 1)).toEqual([]);
}

it("grows a database with no notes table and enforces both per-type UNIQUEs, CHECKs and cascade", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-migration-"));
  const path = join(dir, "old.sqlite");
  try {
    const old = new Database(path);
    old.exec(`CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, format TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO books (title, format, created_at) VALUES ('Original book', 'markdown', '2026-11-04');`);
    old.close();
    const db = openDatabase(path);
    try {
      expect(db.prepare("SELECT title FROM books WHERE id = 1").get()).toEqual({
        title: "Original book",
      });
      assertConstraints(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rebuilds a v1 notes table without changing any row, id, timestamp or AUTOINCREMENT sequence", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-v1-"));
  const path = join(dir, "v1.sqlite");
  try {
    const old = openDatabase(path);
    old.exec(`DROP TABLE notes;
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chapter_position INTEGER, block_position INTEGER,
        type TEXT NOT NULL CHECK (type IN ('progress', 'feeling', 'idea', 'question')),
        text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK ((chapter_position IS NULL AND block_position IS NULL) OR (chapter_position IS NOT NULL AND block_position IS NOT NULL)),
        UNIQUE (book_id, chapter_position, block_position));
      CREATE UNIQUE INDEX notes_book_anchor ON notes(book_id) WHERE chapter_position IS NULL;
      INSERT INTO books (title, format, created_at) VALUES ('Original', 'markdown', '2026-11-04'), ('Other', 'markdown', '2026-11-05');
      INSERT INTO notes VALUES
        (2, 1, NULL, NULL, 'feeling', 'Whole book\n空白保留 ', '2026-11-04', '2026-11-05'),
        (7, 1, 1, 3, 'idea', 'A thought', 'created', 'edited'),
        (11, 1, 2, 1, 'question', 'Why?', 'then', 'later'),
        (12, 2, NULL, NULL, 'progress', 'Another book', 'first', 'last'),
        (19, 2, 1, 1, 'idea', 'Deleted', 'now', 'now');
      DELETE FROM notes WHERE id = 19;`);
    const before = old.prepare("SELECT * FROM notes ORDER BY id").all();
    old.close();
    const db = openDatabase(path);
    try {
      expect(db.prepare("SELECT * FROM notes ORDER BY id").all()).toEqual(
        before
      );
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(
        db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notes'").get()
      ).toEqual({ seq: 19 });
      db.prepare("DELETE FROM notes").run();
      assertConstraints(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("skips rebuilding an already-current table on repeated migrations and reopens", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-current-"));
  const path = join(dir, "current.sqlite");
  try {
    const db = openDatabase(path);
    db.exec(`INSERT INTO books (title, format, created_at) VALUES ('Current', 'markdown', 'now');
      INSERT INTO notes (book_id, type, text, created_at, updated_at) VALUES (1, 'idea', 'Preserved', 'then', 'now');`);
    const schema = db
      .prepare(
        "SELECT * FROM sqlite_master WHERE tbl_name = 'notes' ORDER BY name"
      )
      .all();
    const rows = db.prepare("SELECT * FROM notes").all();
    const version = db.pragma("schema_version", { simple: true });
    migrateSchema(db);
    migrateSchema(db);
    expect(db.pragma("schema_version", { simple: true })).toBe(version);
    expect(
      db
        .prepare(
          "SELECT * FROM sqlite_master WHERE tbl_name = 'notes' ORDER BY name"
        )
        .all()
    ).toEqual(schema);
    db.close();
    const reopened = openDatabase(path);
    try {
      expect(reopened.pragma("schema_version", { simple: true })).toBe(version);
      expect(reopened.prepare("SELECT * FROM notes").all()).toEqual(rows);
      reopened.prepare("DELETE FROM notes").run();
      assertConstraints(reopened);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
