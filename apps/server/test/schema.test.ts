import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../src/database.js";
import { failInterruptedImports } from "../src/import/import-task.js";

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

// Databases created before ticket 08 have no import-status columns. The
// books table is altered in place: every pre-async book was fully inserted
// or never inserted, so existing rows are readable books.
describe("book import status migration (ticket 08)", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "lingualeaf-schema-"));
    databasePath = join(directory, "pre-async.sqlite");
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function createPreTicket08Database(): void {
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    database
      .prepare("INSERT INTO books (title, format, created_at) VALUES (?, ?, ?)")
      .run("An old book", "markdown", "2026-10-17T00:00:00.000Z");
    database.close();
  }

  it("adds the import status columns in place, defaulting old books to ready", () => {
    createPreTicket08Database();

    const database = openDatabase(databasePath);
    const book = database
      .prepare(
        "SELECT status, import_stage, import_percent, import_error FROM books"
      )
      .get() as {
      status: string;
      import_stage: string | null;
      import_percent: number | null;
      import_error: string | null;
    };
    expect(book).toEqual({
      status: "ready",
      import_stage: null,
      import_percent: null,
      import_error: null,
    });

    // The new columns carry real import state.
    database
      .prepare(
        "UPDATE books SET status = 'importing', import_stage = 'translating', import_percent = 40"
      )
      .run();
    expect(
      (
        database.prepare("SELECT status, import_percent FROM books").get() as {
          status: string;
          import_percent: number;
        }
      ).import_percent
    ).toBe(40);
    database.close();

    // The migration is one-time work: reopening the migrated file is stable.
    const reopened = openDatabase(databasePath);
    expect(
      (
        reopened.prepare("SELECT COUNT(*) AS n FROM books").get() as {
          n: number;
        }
      ).n
    ).toBe(1);
    reopened.close();
  });
});

// A server restart orphans its in-flight imports: the task is gone and can
// never resume. The startup sweep fails those rows so the shelf never shows
// a book stuck importing; settled books are untouched (ticket 08).
describe("interrupted import sweep (ticket 08)", () => {
  it("fails stale importing rows and leaves settled books alone", () => {
    const database = openDatabase(":memory:");
    const insert = database.prepare(
      "INSERT INTO books (title, format, created_at, status, import_stage, import_percent) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const importingId = Number(
      insert.run(
        "Interrupted",
        "epub",
        "2026-10-18T00:00:00.000Z",
        "importing",
        "translating",
        40
      ).lastInsertRowid
    );
    insert.run(
      "Finished",
      "markdown",
      "2026-10-18T00:00:00.000Z",
      "ready",
      null,
      null
    );

    failInterruptedImports(database);

    const importing = database
      .prepare(
        "SELECT status, import_stage, import_percent, import_error FROM books WHERE id = ?"
      )
      .get(importingId) as {
      status: string;
      import_stage: string | null;
      import_percent: number | null;
      import_error: string | null;
    };
    expect(importing.status).toBe("failed");
    expect(importing.import_stage).toBeNull();
    expect(importing.import_percent).toBeNull();
    expect(importing.import_error).toBeTruthy();

    const finished = database
      .prepare("SELECT status, import_error FROM books WHERE status = 'ready'")
      .get() as { status: string; import_error: string | null };
    expect(finished).toEqual({ status: "ready", import_error: null });
    database.close();
  });
});
