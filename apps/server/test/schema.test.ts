import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../src/database.js";

// Databases created before ticket 07 carry a kind CHECK without 'image'.
// openDatabase must rebuild the blocks table in place — SQLite cannot alter
// a CHECK — and keep every existing row readable.
describe("blocks kind migration (ticket 07)", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "lingualeaf-schema-"));
    databasePath = join(directory, "pre-epub.sqlite");
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function createPreTicket07Database(): void {
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        level INTEGER,
        UNIQUE (book_id, position)
      );
      CREATE TABLE blocks (
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
    const bookId = Number(
      database
        .prepare(
          "INSERT INTO books (title, format, created_at) VALUES (?, ?, ?)"
        )
        .run("An old book", "markdown", "2026-10-17T00:00:00.000Z")
        .lastInsertRowid
    );
    const chapterId = Number(
      database
        .prepare(
          "INSERT INTO chapters (book_id, position, title, level) VALUES (?, ?, ?, ?)"
        )
        .run(bookId, 1, "An old chapter", 1).lastInsertRowid
    );
    database
      .prepare(
        "INSERT INTO blocks (chapter_id, position, kind, original_text) VALUES (?, ?, ?, ?)"
      )
      .run(chapterId, 1, "sentence", "A sentence from before EPUB support.");
    database.close();
  }

  it("rebuilds the blocks table to accept image blocks, keeping existing rows", () => {
    createPreTicket07Database();

    const database = openDatabase(databasePath);
    const rows = database
      .prepare("SELECT kind, original_text FROM blocks ORDER BY position")
      .all() as { kind: string; original_text: string }[];
    expect(rows).toEqual([
      {
        kind: "sentence",
        original_text: "A sentence from before EPUB support.",
      },
    ]);

    database
      .prepare(
        "INSERT INTO blocks (chapter_id, position, kind, original_text) VALUES (?, ?, ?, ?)"
      )
      .run(1, 2, "image", "An EPUB illustration");
    const kinds = database
      .prepare("SELECT kind FROM blocks ORDER BY position")
      .all() as { kind: string }[];
    expect(kinds.map((row) => row.kind)).toEqual(["sentence", "image"]);
    database.close();

    // The rebuild is one-time work: reopening the migrated file is stable.
    const reopened = openDatabase(databasePath);
    expect(
      (
        reopened.prepare("SELECT COUNT(*) AS n FROM blocks").get() as {
          n: number;
        }
      ).n
    ).toBe(2);
    reopened.close();
  });
});
