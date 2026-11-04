import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { listNotes } from "../src/book-store.js";

it("grows an old database, preserving books and enforcing both UNIQUEs, paired anchors, type and cascade", () => {
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
      const insert = db.prepare(
        "INSERT INTO notes (book_id, chapter_position, block_position, type, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      insert.run(1, null, null, "idea", "Book", "now", "now");
      insert.run(1, 1, 1, "question", "Block", "now", "now");
      expect(() =>
        insert.run(1, null, null, "feeling", "Duplicate book", "now", "now")
      ).toThrow(/UNIQUE/);
      expect(() =>
        insert.run(1, 1, 1, "idea", "Duplicate block", "now", "now")
      ).toThrow(/UNIQUE/);
      for (const [chapter, block] of [
        [null, 1],
        [1, null],
      ])
        expect(() =>
          insert.run(1, chapter, block, "idea", "Half anchor", "now", "now")
        ).toThrow(/CHECK/);
      expect(() =>
        insert.run(1, 2, 1, "other", "Bad type", "now", "now")
      ).toThrow(/CHECK/);
    } finally {
      db.close();
    }
    const reopened = openDatabase(path);
    try {
      expect(listNotes(reopened, 1).map((note) => note.text)).toEqual([
        "Book",
        "Block",
      ]);
      reopened.prepare("DELETE FROM books WHERE id = 1").run();
      expect(listNotes(reopened, 1)).toEqual([]);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
