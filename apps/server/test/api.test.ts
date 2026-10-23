import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { openDictionary } from "../src/dict/dictionary.js";
import {
  createImportingBook,
  persistBook,
  settleImport,
} from "../src/book-store.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { createFakeTranslator } from "./fixtures/translator.js";

// Dictionaries opened inline per test, closed after every test — scattered
// handles leaked WAL files past the run (audit 2026-10-23).
const openDictionaries: ReturnType<typeof openDictionary>[] = [];
function openTrackedDictionary(): ReturnType<typeof openDictionary> {
  const dictionary = openDictionary(":memory:");
  openDictionaries.push(dictionary);
  return dictionary;
}

afterEach(() => {
  for (const dictionary of openDictionaries.splice(0)) dictionary.close();
});
import { waitForShelfBook } from "./fixtures/async-import.js";

const sampleBookPath = fileURLToPath(
  new URL("./fixtures/sample-book.md", import.meta.url)
);

// Shared by every describe that needs a book on the shelf through the real
// upload seam. The import finishes asynchronously (ticket 08): the POST
// returns once the book row exists; reading paths need it ready first.
async function importSampleBook(app: Express) {
  return request(app).post("/api/books").attach("file", sampleBookPath);
}

async function importSampleBookReady(app: Express): Promise<number> {
  const created = await importSampleBook(app);
  expect(created.status).toBe(202);
  await waitForShelfBook(app, created.body.id, "ready");
  return created.body.id as number;
}

describe("Markdown import through the HTTP API seam", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof openDictionary>;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
    app = createApp(database, dictionary);
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  it("creates the book importing and settles it ready on the shelf", async () => {
    const created = await importSampleBook(app);
    // 202, not 201: the annotation work may still be running when the POST
    // answers (ticket 08). Without a translator the task can even finish
    // synchronously first, so only the shape is pinned here — the visible
    // importing state has its own test with a held translator.
    expect(created.status).toBe(202);
    expect(created.body).toMatchObject({
      title: "The Way of the Test",
      format: "markdown",
      // Page counts are a PDF fact; other formats stay null.
      pageCount: null,
    });
    expect(Number.isInteger(created.body.id)).toBe(true);
    expect(typeof created.body.createdAt).toBe("string");

    await waitForShelfBook(app, created.body.id, "ready");
    const shelf = await request(app).get("/api/books");
    expect(shelf.status).toBe(200);
    expect(shelf.body.books).toHaveLength(1);
    expect(shelf.body.books[0]).toMatchObject({
      id: created.body.id,
      title: "The Way of the Test",
      format: "markdown",
      status: "ready",
      importStage: null,
      importPercent: null,
      importError: null,
      pageCount: null,
    });
  });

  it("returns the table of contents divided by headings", async () => {
    const bookId = await importSampleBookReady(app);
    const toc = await request(app).get(`/api/books/${bookId}`);
    expect(toc.status).toBe(200);
    expect(toc.body).toMatchObject({
      id: bookId,
      title: "The Way of the Test",
      format: "markdown",
    });
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "The Way of the Test", level: 1 },
      { position: 2, title: "Chapter One: Red", level: 2 },
      { position: 3, title: "Chapter Two: Green", level: 2 },
      { position: 4, title: "Interlude: The Command", level: 3 },
      { position: 5, title: "Chapter Three: Evidence", level: 2 },
    ]);
  });

  it("returns chapter blocks with sentences split and passthrough items intact", async () => {
    const bookId = await importSampleBookReady(app);

    const titlePage = await request(app).get(`/api/books/${bookId}/chapters/1`);
    expect(titlePage.status).toBe(200);
    expect(titlePage.body).toMatchObject({
      position: 1,
      title: "The Way of the Test",
      level: 1,
    });
    expect(titlePage.body.blocks).toEqual([
      {
        position: 1,
        kind: "sentence",
        originalText:
          "A short sample used by LinguaLeaf's API seam tests and manual demos.",
        ipaSlots: ["ə", "", "", "", "", "", "", "", "", "", "", ""],
        ipaText: "ə",
        translationText: null,
      },
    ]);

    const red = await request(app).get(`/api/books/${bookId}/chapters/2`);
    expect(red.status).toBe(200);
    expect(red.body.title).toBe("Chapter One: Red");
    expect(red.body.blocks).toEqual([
      {
        position: 1,
        kind: "sentence",
        originalText: "Mr. Gupta woke early.",
        ipaSlots: ["", "", "", ""],
        ipaText: "",
        translationText: null,
      },
      {
        position: 2,
        kind: "sentence",
        originalText: "The morning was quiet, and the sea was calm.",
        ipaSlots: ["", "", "", "", "", "", "", "", ""],
        ipaText: "",
        translationText: null,
      },
      {
        position: 3,
        kind: "sentence",
        originalText: "He wrote a failing test first.",
        ipaSlots: ["hi", "roʊt", "ə", "ˈfeɪlɪŋ", "test", "fɜːst"],
        ipaText: "hi roʊt ə ˈfeɪlɪŋ test fɜːst",
        translationText: null,
      },
      {
        position: 4,
        kind: "sentence",
        originalText: "Then he made it pass!",
        ipaSlots: ["", "hi", "", "", ""],
        ipaText: "hi",
        translationText: null,
      },
    ]);

    const interlude = await request(app).get(`/api/books/${bookId}/chapters/4`);
    expect(interlude.status).toBe(200);
    expect(interlude.body.blocks).toEqual([
      {
        position: 1,
        kind: "sentence",
        originalText: "Run the whole suite with:",
        ipaSlots: ["", "", "", "", ""],
        ipaText: "",
        translationText: null,
      },
      { position: 2, kind: "code", originalText: "npm test -- --filter core" },
      {
        position: 3,
        kind: "raw",
        originalText: "Reading more: the official handbook. It is free.",
      },
    ]);
  });

  it("splits list items and blockquotes into annotated sentences", async () => {
    const bookId = await importSampleBookReady(app);
    const evidence = await request(app).get(`/api/books/${bookId}/chapters/5`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.title).toBe("Chapter Three: Evidence");
    expect(evidence.body.blocks).toEqual([
      {
        position: 1,
        kind: "sentence",
        originalText: "The community kept three rules:",
        ipaSlots: ["", "", "", "", ""],
        ipaText: "",
        translationText: null,
      },
      {
        position: 2,
        kind: "sentence",
        originalText: "Write the failing test first.",
        ipaSlots: ["raɪt", "", "ˈfeɪlɪŋ", "test", "fɜːst"],
        ipaText: "raɪt  ˈfeɪlɪŋ test fɜːst",
        translationText: null,
      },
      {
        position: 3,
        kind: "sentence",
        originalText: "Refactor with the suite green.",
        ipaSlots: ["", "", "", "", ""],
        ipaText: "",
        translationText: null,
      },
      {
        position: 4,
        kind: "sentence",
        originalText: "Keep the list short.",
        ipaSlots: ["", "", "", ""],
        ipaText: "",
        translationText: null,
      },
      {
        position: 5,
        kind: "sentence",
        originalText:
          "A test that passes the moment it is written has told you nothing.",
        ipaSlots: ["ə", "test", "", "", "", "", "", "", "raɪt", "", "", "", ""],
        ipaText: "ə test       raɪt",
        translationText: null,
      },
      {
        position: 6,
        kind: "sentence",
        originalText: "It merely records the code as it is.",
        ipaSlots: ["", "", "", "", "", "", "", ""],
        ipaText: "",
        translationText: null,
      },
    ]);
  });

  it("returns an empty block list for a heading-only chapter", async () => {
    const bookId = await importSampleBookReady(app);
    const green = await request(app).get(`/api/books/${bookId}/chapters/3`);
    expect(green.status).toBe(200);
    expect(green.body).toMatchObject({
      position: 3,
      title: "Chapter Two: Green",
      level: 2,
    });
    expect(green.body.blocks).toEqual([]);
  });

  it("returns 404 for chapters outside the book", async () => {
    const bookId = await importSampleBookReady(app);
    expect(
      (await request(app).get(`/api/books/${bookId}/chapters/99`)).status
    ).toBe(404);
    expect(
      (await request(app).get(`/api/books/${bookId}/chapters/zero`)).status
    ).toBe(404);
    expect((await request(app).get("/api/books/999/chapters/1")).status).toBe(
      404
    );
  });

  it("rejects uploads that are neither markdown nor epub and leaves the shelf empty", async () => {
    const response = await request(app)
      .post("/api/books")
      .attach("file", Buffer.from("<html>not a book</html>"), {
        filename: "book.txt",
      });
    expect(response.status).toBe(415);
    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books).toEqual([]);
  });

  it("returns 404 for a book that was never imported", async () => {
    const response = await request(app).get("/api/books/999");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "book not found" });
  });
});

describe("GET /api/lookup/:word", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof openDictionary>;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
    app = createApp(database, dictionary);
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  it("returns IPA, part of speech, and translation for a common word", async () => {
    const response = await request(app).get("/api/lookup/book");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      word: "book",
      lemma: null,
      ipa: "bʊk",
      pos: "n. v.",
      translation: "n. 书, 簿, 账册\nv. 预订, 登记",
    });
  });

  it("resolves inflected forms back to their lemma", async () => {
    const wrote = await request(app).get("/api/lookup/wrote");
    expect(wrote.status).toBe(200);
    expect(wrote.body).toEqual({
      word: "wrote",
      lemma: "write",
      ipa: "roʊt",
      pos: "v.",
      translation: "v. 写, 作曲, 写信",
    });
    // "books" has its own American IPA entry: /s/ stays on the plural.
    const books = await request(app).get("/api/lookup/books");
    expect(books.status).toBe(200);
    expect(books.body).toMatchObject({ lemma: "book", ipa: "bʊks" });
  });

  it("ignores case and surrounding punctuation from the path", async () => {
    const response = await request(app).get(
      `/api/lookup/${encodeURIComponent("Book,")}`
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ word: "book" });
  });

  it("returns 404 for words no source knows", async () => {
    const response = await request(app).get("/api/lookup/iguana");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "word not found" });
  });
});

describe("import with an empty dictionary", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });
  afterEach(() => {
    database.close();
  });

  it("still imports, with the IPA line generated but entirely blank", async () => {
    const app = createApp(database, openTrackedDictionary());
    const sampleBookPath = fileURLToPath(
      new URL("./fixtures/sample-book.md", import.meta.url)
    );
    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(202);
    await waitForShelfBook(app, created.body.id, "ready");
    const chapter = await request(app).get(
      `/api/books/${created.body.id}/chapters/2`
    );
    expect(chapter.status).toBe(200);
    for (const block of chapter.body.blocks) {
      expect(block.ipaText).toBe("");
      expect(Array.isArray(block.ipaSlots)).toBe(true);
      expect(block.ipaSlots.every((slot: string) => slot === "")).toBe(true);
    }
  });
});

describe("HTTP API seam", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });
  afterEach(() => {
    database.close();
  });

  it("reports a healthy server with a real SQLite connection", async () => {
    const response = await request(
      createApp(database, openTrackedDictionary())
    ).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns an API 404 instead of the frontend HTML", async () => {
    const response = await request(
      createApp(database, openTrackedDictionary())
    ).get("/api/missing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "API route not found" });
  });
});

describe("reading progress and book deletion through the HTTP API seam", () => {
  let database: Database.Database;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    app = createApp(database, openTrackedDictionary());
  });
  afterEach(() => {
    database.close();
  });

  async function importBookId() {
    return importSampleBookReady(app);
  }

  it("saves reading progress and returns it for restore, with the shelf listing it", async () => {
    const bookId = await importBookId();

    // Real positions in the sample book (chapter 2 is Red, 4 blocks;
    // chapter 4 is the Interlude: a code block and a link paragraph).
    const saved = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .send({ chapter: 2, block: 1 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ chapter: 2, block: 1 });

    const restored = await request(app).get(`/api/books/${bookId}/progress`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ chapter: 2, block: 1 });

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books[0].progress).toEqual({ chapter: 2, block: 1 });

    const moved = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .send({ chapter: 4, block: 2 });
    expect(moved.status).toBe(200);
    expect(
      (await request(app).get(`/api/books/${bookId}/progress`)).body
    ).toMatchObject({ chapter: 4, block: 2 });
  });

  it("rejects progress payloads that are not positive integer positions", async () => {
    const bookId = await importBookId();

    for (const payload of [
      { chapter: "3", block: 1 },
      { chapter: 3 },
      { chapter: 0, block: 1 },
      { chapter: 3, block: 0 },
    ]) {
      const saved = await request(app)
        .put(`/api/books/${bookId}/progress`)
        .send(payload);
      expect(saved.status).toBe(400);
    }
    // Nothing was stored by the rejected attempts.
    expect(
      (await request(app).get(`/api/books/${bookId}/progress`)).status
    ).toBe(404);
  });

  it("404s progress for books that have none or do not exist", async () => {
    const bookId = await importBookId();
    expect(
      (await request(app).get(`/api/books/${bookId}/progress`)).body
    ).toEqual({ error: "no reading progress" });
    expect((await request(app).get("/api/books/999/progress")).body).toEqual({
      error: "book not found",
    });
    const saved = await request(app)
      .put("/api/books/999/progress")
      .send({ chapter: 1, block: 1 });
    expect(saved.status).toBe(404);
  });

  it("deletes a book together with its chapters, blocks, and progress", async () => {
    const bookId = await importBookId();
    await request(app)
      .put(`/api/books/${bookId}/progress`)
      .send({ chapter: 2, block: 3 });

    const deleted = await request(app).delete(`/api/books/${bookId}`);
    expect(deleted.status).toBe(204);
    expect(deleted.body).toEqual({});

    expect((await request(app).get(`/api/books/${bookId}`)).status).toBe(404);
    expect((await request(app).get("/api/books")).body.books).toEqual([]);
    expect(
      (await request(app).get(`/api/books/${bookId}/progress`)).status
    ).toBe(404);

    // The cascade must reach every child table, not just the shelf listing.
    for (const table of ["chapters", "blocks", "reading_progress"]) {
      const row = database
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      expect(row.n).toBe(0);
    }

    expect((await request(app).delete(`/api/books/${bookId}`)).status).toBe(
      404
    );
  });
});

// Everything that fails after the POST's parse (which answers 400/415
// synchronously) is a fault inside the task: the shelf must say so clearly
// and no half-built book may remain (ticket 08). The dictionary seam is
// where the fault is injected: the pipeline's very first dictionary query
// throws, the way a corrupted dictionary file would.
describe("failed imports at the HTTP API seam", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });
  afterEach(() => {
    database.close();
  });

  function createBrokenDictionaryApp() {
    const dictionary = createFixtureDictionary();
    const broken = new Proxy(dictionary, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            if (String(sql).includes("dict_")) {
              throw new Error("dictionary file corrupted");
            }
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as typeof dictionary;
    return createApp(database, broken);
  }

  it("marks the book failed on the shelf with no half-built content", async () => {
    const app = createBrokenDictionaryApp();

    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(202);

    await waitForShelfBook(app, created.body.id, "failed");
    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books[0]).toMatchObject({
      id: created.body.id,
      status: "failed",
      importStage: null,
      importPercent: null,
    });
    expect(shelf.body.books[0].importError).toBeTruthy();

    // The failure happened before the insert transaction: not one chapter
    // or block may exist.
    for (const table of ["chapters", "blocks"]) {
      const row = database
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      expect(row.n).toBe(0);
    }

    // A failed import is removed like any other book.
    expect(
      (await request(app).delete(`/api/books/${created.body.id}`)).status
    ).toBe(204);
    expect((await request(app).get("/api/books")).body.books).toEqual([]);
  });

  it("refuses reading routes for a failed book", async () => {
    const app = createBrokenDictionaryApp();
    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    await waitForShelfBook(app, created.body.id, "failed");

    const chapter = await request(app).get(
      `/api/books/${created.body.id}/chapters/1`
    );
    expect(chapter.status).toBe(409);
    expect(
      (await request(app).get(`/api/books/${created.body.id}`)).body.status
    ).toBe("failed");
  });
});

// The importing state is visible to more than the shelf: reading routes
// must refuse a book whose chapters do not exist yet, and a reader deleting
// an importing book must win over whatever the task had left behind
// (ticket 08). The pipeline no longer has a slow stage to hold a real
// import open (on-demand-translation ticket 02 — the task's writes land
// inside the POST), so the mid-flight state is planted the way a crashed
// import leaves it: an importing row without its settle, which the startup
// sweep fails on the next boot.
describe("import lifecycle guards at the HTTP API seam", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof openDictionary>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  it("answers 409 for reading routes while a book is still importing", async () => {
    const app = createApp(database, dictionary);
    const bookId = createImportingBook(
      database,
      "The Way of the Test",
      "markdown",
      null
    );

    // The book itself is listable with its live status and no chapters.
    const book = await request(app).get(`/api/books/${bookId}`);
    expect(book.status).toBe(200);
    expect(book.body).toMatchObject({ status: "importing", chapters: [] });

    const chapter = await request(app).get(`/api/books/${bookId}/chapters/1`);
    expect(chapter.status).toBe(409);
    expect(chapter.body).toEqual({ error: "book is not ready for reading" });
    expect(
      (await request(app).get(`/api/books/${bookId}/progress`)).status
    ).toBe(409);
    expect(
      (
        await request(app)
          .put(`/api/books/${bookId}/progress`)
          .send({ chapter: 1, block: 1 })
      ).status
    ).toBe(409);

    // The task's own settle writes — driven here through the store, the
    // seam the task uses — are what open the same routes.
    persistBook(database, bookId, [
      {
        title: "One",
        level: 1,
        blocks: [
          {
            kind: "sentence",
            text: "One.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
        ],
      },
    ]);
    settleImport(database, bookId, "ready", null);
    expect(
      (await request(app).get(`/api/books/${bookId}/chapters/1`)).status
    ).toBe(200);
  });

  it("deleting an importing book takes the row and any half-built content with it", async () => {
    const app = createApp(database, dictionary);
    const bookId = createImportingBook(
      database,
      "The Way of the Test",
      "markdown",
      null
    );
    // Half-built content — the shape a crash mid-import leaves, and the
    // thing a task still in flight must not resurrect. The store's
    // never-resurrect guards stay pinned at the store level
    // (book-store.test.ts); the delete route itself carries no not-ready
    // guard, so a mid-import delete answers 204.
    persistBook(database, bookId, [
      {
        title: "One",
        level: 1,
        blocks: [
          {
            kind: "sentence",
            text: "One.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
        ],
      },
    ]);

    const deleted = await request(app).delete(`/api/books/${bookId}`);
    expect(deleted.status).toBe(204);

    expect((await request(app).get("/api/books")).body.books).toEqual([]);
    for (const table of ["books", "chapters", "blocks"]) {
      const row = database
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      expect(row.n).toBe(0);
    }
  });
});

// The import no longer translates (on-demand-translation ticket 02):
// chapters land with IPA and NULL translations, and even a translator
// assembled for the chapter route is never dialed at import time. The
// 留空-on-retry semantics that once governed the import's batches moved to
// the chapter task — pinned in the chapter-translation describe below —
// and the translating stage's shelf progress went with it, so the old
// percent pins have no subject left.
describe("the import leaves the translation work to the chapter route", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof openDictionary>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  it("lands every chapter with NULL translation lines, never dialing the assembled translator", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );
    const app = createApp(database, dictionary, translator);

    const bookId = await importSampleBookReady(app);

    // Not one sentence went out at import time — the translator belongs to
    // the chapter trigger route alone.
    expect(translator.calls).toEqual([]);
    const red = await request(app).get(`/api/books/${bookId}/chapters/2`);
    expect(red.status).toBe(200);
    expect(red.body).toMatchObject({ translationStatus: "untranslated" });
    expect(
      red.body.blocks.map(
        (block: { translationText: string | null }) => block.translationText
      )
    ).toEqual([null, null, null, null]);
  });

  it("imports with empty translation lines when no translator is configured", async () => {
    const app = createApp(database, dictionary);

    const bookId = await importSampleBookReady(app);

    const red = await request(app).get(`/api/books/${bookId}/chapters/2`);
    for (const block of red.body.blocks as {
      translationText: string | null;
    }[]) {
      expect(block.translationText).toBeNull();
    }
  });
});

describe("chapter translation at the HTTP API seam (on-demand-translation ticket 01)", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof openDictionary>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  // A translator whose armed calls park until released: since ticket 02
  // the import makes no translator calls at all, so every call this fake
  // sees belongs to the chapter task — arm before triggering, and the
  // chapter's first batch parks (its synchronous prefix has run by the
  // time the trigger POST answers, so a release is queued).
  function gatedChapterTranslator() {
    let parked = false;
    const releases: (() => void)[] = [];
    const translator = createFakeTranslator(
      (sentences) =>
        new Promise((resolve) => {
          if (!parked) {
            resolve(sentences.map((sentence) => `译:${sentence}`));
            return;
          }
          releases.push(() =>
            resolve(sentences.map((sentence) => `译:${sentence}`))
          );
        })
    );
    return {
      translator,
      arm: () => {
        parked = true;
      },
      releaseAll: () => releases.splice(0).forEach((release) => release()),
    };
  }

  it("triggers a chapter translation with a 202 and settles it translated", async () => {
    const gate = gatedChapterTranslator();
    const app = createApp(database, dictionary, gate.translator);
    const bookId = await importSampleBookReady(app);
    gate.arm();

    const triggered = await request(app).post(
      `/api/books/${bookId}/chapters/2/translate`
    );
    expect(triggered.status).toBe(202);
    // The 202 body is the chapter payload in its brand-new translating
    // state — the same shape the reading page polls.
    expect(triggered.body).toMatchObject({
      position: 2,
      translationStatus: "translating",
      translationPercent: 0,
      translationError: null,
    });

    gate.releaseAll();
    await vi.waitFor(async () => {
      const chapter = await request(app).get(`/api/books/${bookId}/chapters/2`);
      expect(chapter.body).toMatchObject({
        translationStatus: "translated",
        translationPercent: null,
        translationError: null,
      });
    });
    // The refreshed lines are visible through the same payload.
    const chapter = await request(app).get(`/api/books/${bookId}/chapters/2`);
    expect(
      (chapter.body.blocks as { translationText: string | null }[]).map(
        (block) => block.translationText
      )
    ).toEqual([
      "译:Mr. Gupta woke early.",
      "译:The morning was quiet, and the sea was calm.",
      "译:He wrote a failing test first.",
      "译:Then he made it pass!",
    ]);
  });

  it("409s a second trigger on the translating chapter and lets another chapter translate in parallel", async () => {
    const gate = gatedChapterTranslator();
    const app = createApp(database, dictionary, gate.translator);
    const bookId = await importSampleBookReady(app);
    gate.arm();

    await request(app).post(`/api/books/${bookId}/chapters/2/translate`);
    // Same chapter, still translating: the claim is the 409's other half.
    const second = await request(app).post(
      `/api/books/${bookId}/chapters/2/translate`
    );
    expect(second.status).toBe(409);
    // A different chapter is its own lifecycle — never rejected for
    // chapter 2's sake (spec: 不同章允许并行).
    const other = await request(app).post(
      `/api/books/${bookId}/chapters/1/translate`
    );
    expect(other.status).toBe(202);
    expect(other.body).toMatchObject({ position: 1 });

    gate.releaseAll();
    await vi.waitFor(async () => {
      const first = await request(app).get(`/api/books/${bookId}/chapters/1`);
      const second = await request(app).get(`/api/books/${bookId}/chapters/2`);
      expect(first.body.translationStatus).toBe("translated");
      expect(second.body.translationStatus).toBe("translated");
    });
  });

  it("409s the trigger on a book that is not ready, joining the reading family", async () => {
    // The pipeline no longer has a slow stage to hold a real import open
    // (ticket 02), so the importing state is planted the way a crashed
    // import leaves it — an importing row with no settle. The trigger must
    // get the same 409 the reading routes answer.
    const app = createApp(
      database,
      dictionary,
      createFakeTranslator((batch) => batch.map((s) => `译:${s}`))
    );
    const bookId = createImportingBook(
      database,
      "The Way of the Test",
      "markdown",
      null
    );

    const triggered = await request(app).post(
      `/api/books/${bookId}/chapters/1/translate`
    );
    expect(triggered.status).toBe(409);

    // The task's own settle writes open the route: a claimed chapter comes
    // back in its brand-new translating state.
    persistBook(database, bookId, [
      {
        title: "One",
        level: 1,
        blocks: [
          {
            kind: "sentence",
            text: "One.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
        ],
      },
    ]);
    settleImport(database, bookId, "ready", null);
    const triggered2 = await request(app).post(
      `/api/books/${bookId}/chapters/1/translate`
    );
    expect(triggered2.status).toBe(202);
    expect(triggered2.body).toMatchObject({ translationStatus: "translating" });
  });

  it("409s the trigger when no translator is configured", async () => {
    const app = createApp(database, dictionary);
    const bookId = await importSampleBookReady(app);

    const triggered = await request(app).post(
      `/api/books/${bookId}/chapters/2/translate`
    );
    expect(triggered.status).toBe(409);
    // The chapter stays as it was: a refused trigger claims nothing. Since
    // ticket 02 a fresh import's resting state is untranslated — every
    // book starts here until its chapters are translated on demand.
    const chapter = await request(app).get(`/api/books/${bookId}/chapters/2`);
    expect(chapter.body.translationStatus).toBe("untranslated");
  });

  it("leaves an exhausted sentence empty after three rounds and still settles translated", async () => {
    // The 留空 semantics on the new path: a sentence the translator never
    // delivers comes back null after MAX_TRANSLATION_ROUNDS requests, and
    // the chapter counts translated anyway (spec decision 3).
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) =>
        sentence.includes("failing") ? null : `译:${sentence}`
      )
    );
    const app = createApp(database, dictionary, translator);
    const bookId = await importSampleBookReady(app);

    const triggered = await request(app).post(
      `/api/books/${bookId}/chapters/2/translate`
    );
    expect(triggered.status).toBe(202);

    await vi.waitFor(async () => {
      const chapter = await request(app).get(`/api/books/${bookId}/chapters/2`);
      expect(chapter.body.translationStatus).toBe("translated");
    });
    // Every call is the chapter task's (the import makes none since
    // ticket 02): chapter 2 holds four sentences — round 1 requests all
    // four, rounds 2 and 3 re-request only the failed one, then the
    // rounds run out.
    expect(translator.calls).toEqual([
      [
        "Mr. Gupta woke early.",
        "The morning was quiet, and the sea was calm.",
        "He wrote a failing test first.",
        "Then he made it pass!",
      ],
      ["He wrote a failing test first."],
      ["He wrote a failing test first."],
    ]);
    const chapter = await request(app).get(`/api/books/${bookId}/chapters/2`);
    const blocks = chapter.body.blocks as {
      originalText: string;
      translationText: string | null;
    }[];
    expect(
      blocks.find((block) => block.originalText.includes("failing"))
    ).toMatchObject({ translationText: null });
    expect(
      blocks.find((block) => block.originalText.startsWith("Mr."))
    ).toMatchObject({ translationText: "译:Mr. Gupta woke early." });
  });

  it("moves the chapter percent forward batch by batch and clears it on settle", async () => {
    // 45 sentences in one heading-less chapter make three 20-sentence
    // batches; each parks until released, so the percent steps are read
    // through the same chapter payload the reading page polls. The 99
    // ceiling and the settle-to-NULL mirror the shelf's import percent.
    const paragraphs = Array.from(
      { length: 45 },
      (_, index) =>
        `Sentence ${index + 1} opens with a quiet walk beside the river.`
    );
    const releases: (() => void)[] = [];
    const translator = createFakeTranslator(
      (sentences) =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve(sentences.map((sentence) => `译:${sentence}`))
          );
        })
    );
    const app = createApp(database, dictionary, translator);
    const created = await request(app)
      .post("/api/books")
      .attach("file", Buffer.from(paragraphs.join("\n\n")), {
        filename: "forty-five-sentences.md",
        contentType: "text/markdown",
      });
    expect(created.status).toBe(202);
    // The import settles inside the POST now (ticket 02) — it parks
    // nothing — so the 45 sentences sit in chapter 1 before the trigger;
    // the chapter task's batches park exactly as the shelf's used to.
    await waitForShelfBook(app, created.body.id, "ready");

    const triggered = await request(app).post(
      `/api/books/${created.body.id}/chapters/1/translate`
    );
    expect(triggered.status).toBe(202);
    expect(triggered.body).toMatchObject({ translationPercent: 0 });

    const observed: number[] = [0];
    for (;;) {
      releases.shift()!();
      const chapter = await request(app).get(
        `/api/books/${created.body.id}/chapters/1`
      );
      if (chapter.body.translationStatus !== "translating") {
        expect(chapter.body).toMatchObject({
          translationStatus: "translated",
          translationPercent: null,
        });
        break;
      }
      observed.push(chapter.body.translationPercent as number);
    }
    // One step per released batch plus the floor: 20 of 45 rounds to 44%,
    // 40 of 45 to 89%. Monotonic, never 100 while translating.
    expect(observed).toEqual([0, 44, 89]);
    expect([...observed].sort((a, b) => a - b)).toEqual(observed);
    expect(Math.max(...observed)).toBeLessThan(100);
  });
});
