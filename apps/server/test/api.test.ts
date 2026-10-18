import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { openDictionary } from "../src/dict/dictionary.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { createFakeTranslator } from "./fixtures/translator.js";
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
    const app = createApp(database, openDictionary(":memory:"));
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
      createApp(database, openDictionary(":memory:"))
    ).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns an API 404 instead of the frontend HTML", async () => {
    const response = await request(
      createApp(database, openDictionary(":memory:"))
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
    app = createApp(database, openDictionary(":memory:"));
  });
  afterEach(() => {
    database.close();
  });

  async function importBookId() {
    return importSampleBookReady(app);
  }

  it("saves reading progress and returns it for restore, with the shelf listing it", async () => {
    const bookId = await importBookId();

    const saved = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .send({ chapter: 3, block: 5 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ chapter: 3, block: 5 });

    const restored = await request(app).get(`/api/books/${bookId}/progress`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ chapter: 3, block: 5 });

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books[0].progress).toEqual({ chapter: 3, block: 5 });

    const moved = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .send({ chapter: 4, block: 1 });
    expect(moved.status).toBe(200);
    expect(
      (await request(app).get(`/api/books/${bookId}/progress`)).body
    ).toMatchObject({ chapter: 4, block: 1 });
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
// a book mid-import must win over the task still in flight (ticket 08).
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

  // An app whose translator never answers until the test releases it.
  function createHeldApp() {
    let release!: (value: (string | null)[]) => void;
    const held = new Promise<(string | null)[]>((resolve) => {
      release = resolve;
    });
    const translator = createFakeTranslator(() => held);
    const app = createApp(database, dictionary, translator);
    return { app, release: () => release([]) };
  }

  async function startImport(app: Express): Promise<number> {
    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(202);
    return created.body.id as number;
  }

  it("answers 409 for reading routes while a book is still importing", async () => {
    const { app, release } = createHeldApp();
    const bookId = await startImport(app);

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

    release();
    await waitForShelfBook(app, bookId, "ready");
    expect(
      (await request(app).get(`/api/books/${bookId}/chapters/1`)).status
    ).toBe(200);
  });

  it("deleting an importing book wins over the in-flight task", async () => {
    const { app, release } = createHeldApp();
    const bookId = await startImport(app);

    const deleted = await request(app).delete(`/api/books/${bookId}`);
    expect(deleted.status).toBe(204);

    release();
    // Let the task's continuation run out (retry rounds, persist attempt).
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await request(app).get("/api/books")).body.books).toEqual([]);
    for (const table of ["books", "chapters", "blocks"]) {
      const row = database
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      expect(row.n).toBe(0);
    }
  });
});

describe("translation at the HTTP API seam", () => {
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

  it("fills the translation lines of an imported book from the injected translator", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );
    const app = createApp(database, dictionary, translator);

    const bookId = await importSampleBookReady(app);

    const red = await request(app).get(`/api/books/${bookId}/chapters/2`);
    expect(red.status).toBe(200);
    expect(
      red.body.blocks.map(
        (block: { translationText: string | null }) => block.translationText
      )
    ).toEqual([
      "译:Mr. Gupta woke early.",
      "译:The morning was quiet, and the sea was calm.",
      "译:He wrote a failing test first.",
      "译:Then he made it pass!",
    ]);
  });

  it("leaves a sentence empty when its translation fails, and still imports the book", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) =>
        sentence.includes("failing") ? null : `译:${sentence}`
      )
    );
    const app = createApp(database, dictionary, translator);

    const bookId = await importSampleBookReady(app);

    const red = await request(app).get(`/api/books/${bookId}/chapters/2`);
    const blocks = red.body.blocks as {
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

  it("reports translating progress on the shelf while the translator works", async () => {
    // Hold the first batch: the task is mid-flight and stays there until
    // the test releases it, which pins the visible importing state.
    let release: ((value: (string | null)[]) => void) | undefined;
    const held = new Promise<(string | null)[]>((resolve) => {
      release = resolve;
    });
    const translator = createFakeTranslator(() => held);
    const app = createApp(database, dictionary, translator);

    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(202);
    // The task's synchronous prefix (IPA pass, first batch dispatch) has
    // run by the time the POST answers; the percent starts at 0.
    expect(created.body).toMatchObject({
      status: "importing",
      importStage: "translating",
      importPercent: 0,
      importError: null,
    });

    // The shelf — what the bookshelf polls — carries the same live state.
    const importing = await request(app).get("/api/books");
    expect(importing.body.books[0]).toMatchObject({
      status: "importing",
      importStage: "translating",
      importPercent: 0,
    });

    release?.([]);
    await waitForShelfBook(app, created.body.id, "ready");
    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books[0]).toMatchObject({
      status: "ready",
      importStage: null,
      importPercent: null,
      importError: null,
    });
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
