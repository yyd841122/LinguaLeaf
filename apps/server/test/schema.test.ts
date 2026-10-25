import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../src/database.js";
import { failInterruptedImports } from "../src/book-store.js";

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
    // Annotations seeded: the rebuild must carry them, not just kind/text
    // (audit 2026-10-23 — the old fixture could not notice a dropped
    // ipa_slots or translation column).
    database
      .prepare(
        "INSERT INTO blocks (chapter_id, position, kind, original_text, ipa_slots, ipa_text, translation_text) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        chapterId,
        1,
        "sentence",
        "A sentence from before EPUB support.",
        '["\u0259"]',
        "\u0259",
        "旧的译文"
      );
    database.close();
  }

  it("rebuilds the blocks table to accept image blocks, keeping existing rows", () => {
    createPreTicket07Database();

    const database = openDatabase(databasePath);
    const rows = database
      .prepare(
        "SELECT kind, original_text, ipa_slots, ipa_text, translation_text FROM blocks ORDER BY position"
      )
      .all() as {
      kind: string;
      original_text: string;
      ipa_slots: string | null;
      ipa_text: string | null;
      translation_text: string | null;
    }[];
    expect(rows).toEqual([
      {
        kind: "sentence",
        original_text: "A sentence from before EPUB support.",
        ipa_slots: '["\u0259"]',
        ipa_text: "\u0259",
        translation_text: "旧的译文",
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

// Databases from before the PDF import carry no page_count column. It is
// altered in place like the ticket 08 columns: existing rows are readable
// books whose (absent) page count is simply null.
describe("book page count migration (pdf-import ticket 03)", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "lingualeaf-schema-"));
    databasePath = join(directory, "pre-page-count.sqlite");
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function createPrePageCountDatabase(): void {
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        import_stage TEXT,
        import_percent INTEGER,
        import_error TEXT
      );
    `);
    database
      .prepare("INSERT INTO books (title, format, created_at) VALUES (?, ?, ?)")
      .run("An old book", "markdown", "2026-10-17T00:00:00.000Z");
    database.close();
  }

  it("adds page_count in place, leaving existing rows readable with a null count", () => {
    createPrePageCountDatabase();

    const database = openDatabase(databasePath);
    const book = database
      .prepare("SELECT status, page_count FROM books")
      .get() as { status: string; page_count: number | null };
    expect(book).toEqual({ status: "ready", page_count: null });

    // The new column carries a real page count for the shelf's hint.
    database.prepare("UPDATE books SET page_count = ? WHERE id = 1").run(320);
    expect(
      (
        database.prepare("SELECT page_count FROM books").get() as {
          page_count: number;
        }
      ).page_count
    ).toBe(320);
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

// Databases created before on-demand translation (ADR-0004) have no
// chapter translation columns. They are altered in place like every
// status-column migration before them, and each existing chapter's status
// is derived once by the block-presence rule (spec decision 5: a chapter
// holding sentence blocks has been through the import translation, so it
// counts translated — otherwise old books would flip to untranslated and
// break "old books behave unchanged").
describe("chapter translation status migration (on-demand-translation ticket 01)", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "lingualeaf-schema-"));
    databasePath = join(directory, "pre-on-demand.sqlite");
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function createPreOnDemandDatabase(): void {
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
    const translatedChapterId = Number(
      database
        .prepare(
          "INSERT INTO chapters (book_id, position, title, level) VALUES (?, ?, ?, ?)"
        )
        .run(bookId, 1, "A translated chapter", 1).lastInsertRowid
    );
    // A chapter with a sentence block counts translated, even though the
    // sentence's own translation is NULL (block presence, not translation
    // presence, is the derivation).
    database
      .prepare(
        "INSERT INTO blocks (chapter_id, position, kind, original_text) VALUES (?, ?, ?, ?)"
      )
      .run(translatedChapterId, 1, "sentence", "An old sentence.");
    database
      .prepare(
        "INSERT INTO blocks (chapter_id, position, kind, original_text) VALUES (?, ?, ?, ?)"
      )
      .run(translatedChapterId, 2, "code", "npm test");
    // A heading-only chapter holds no sentence block and stays untranslated.
    database
      .prepare(
        "INSERT INTO chapters (book_id, position, title, level) VALUES (?, ?, ?, ?)"
      )
      .run(bookId, 2, "An empty chapter", null);
    database.close();
  }

  it("adds the translation columns in place, deriving each chapter's status from its blocks", () => {
    createPreOnDemandDatabase();

    const database = openDatabase(databasePath);
    const chapters = database
      .prepare(
        "SELECT position, translation_status, translation_error, translation_percent FROM chapters ORDER BY position"
      )
      .all() as {
      position: number;
      translation_status: string;
      translation_error: string | null;
      translation_percent: number | null;
    }[];
    expect(chapters).toEqual([
      {
        position: 1,
        translation_status: "translated",
        translation_error: null,
        translation_percent: null,
      },
      {
        position: 2,
        translation_status: "untranslated",
        translation_error: null,
        translation_percent: null,
      },
    ]);

    // The new columns carry real translation state.
    database
      .prepare(
        "UPDATE chapters SET translation_status = 'translating', translation_percent = 40 WHERE position = 2"
      )
      .run();
    expect(
      (
        database
          .prepare(
            "SELECT translation_status, translation_percent FROM chapters WHERE position = 2"
          )
          .get() as { translation_status: string; translation_percent: number }
      ).translation_percent
    ).toBe(40);
    database.close();

    // The migration is one-time work: reopening the migrated file is stable.
    const reopened = openDatabase(databasePath);
    expect(
      (
        reopened.prepare("SELECT COUNT(*) AS n FROM chapters").get() as {
          n: number;
        }
      ).n
    ).toBe(2);
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

// The word_states table (ADR-0005, vocabulary-states ticket 01) postdates
// every database above. New is a row's absence, so the migration story is
// only "the table exists": a pre-vocabulary .data file grows it on its
// next open, and the CHECK keeps the three stored states the only values
// a row can carry.
describe("word_states table migration (vocabulary-states ticket 01)", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "lingualeaf-schema-"));
    databasePath = join(directory, "pre-vocab.sqlite");
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function createPreVocabularyDatabase(): void {
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    database.close();
  }

  it("grows a pre-vocabulary database the word_states table, CHECK intact", () => {
    createPreVocabularyDatabase();

    const database = openDatabase(databasePath);
    database
      .prepare(
        "INSERT INTO word_states (lemma, status, updated_at) VALUES (?, ?, ?)"
      )
      .run("book", "learning", "2026-10-25T00:00:00.000Z");
    expect(
      (
        database
          .prepare("SELECT status FROM word_states WHERE lemma = ?")
          .get("book") as { status: string }
      ).status
    ).toBe("learning");
    // The CHECK admits only the three stored states — New is absence.
    expect(() =>
      database
        .prepare(
          "INSERT INTO word_states (lemma, status, updated_at) VALUES (?, ?, ?)"
        )
        .run("go", "new", "2026-10-25T00:00:00.000Z")
    ).toThrow();
    database.close();

    // The migration is one-time work: reopening the migrated file is stable.
    const reopened = openDatabase(databasePath);
    expect(
      (
        reopened.prepare("SELECT COUNT(*) AS n FROM word_states").get() as {
          n: number;
        }
      ).n
    ).toBe(1);
    reopened.close();
  });
});
