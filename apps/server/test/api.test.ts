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

const sampleBookPath = fileURLToPath(
  new URL("./fixtures/sample-book.md", import.meta.url)
);

// Shared by every describe that needs a book on the shelf through the real
// upload seam.
async function importSampleBook(app: Express) {
  return request(app).post("/api/books").attach("file", sampleBookPath);
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

  it("imports a markdown file and lists the book on the bookshelf", async () => {
    const created = await importSampleBook(app);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: "The Way of the Test",
      format: "markdown",
    });
    expect(Number.isInteger(created.body.id)).toBe(true);
    expect(typeof created.body.createdAt).toBe("string");

    const shelf = await request(app).get("/api/books");
    expect(shelf.status).toBe(200);
    expect(shelf.body.books).toHaveLength(1);
    expect(shelf.body.books[0]).toMatchObject({
      id: created.body.id,
      title: "The Way of the Test",
      format: "markdown",
    });
  });

  it("returns the table of contents divided by headings", async () => {
    const created = await importSampleBook(app);
    const toc = await request(app).get(`/api/books/${created.body.id}`);
    expect(toc.status).toBe(200);
    expect(toc.body).toMatchObject({
      id: created.body.id,
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
    const created = await importSampleBook(app);

    const titlePage = await request(app).get(
      `/api/books/${created.body.id}/chapters/1`
    );
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

    const red = await request(app).get(
      `/api/books/${created.body.id}/chapters/2`
    );
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

    const interlude = await request(app).get(
      `/api/books/${created.body.id}/chapters/4`
    );
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
    const created = await importSampleBook(app);
    const evidence = await request(app).get(
      `/api/books/${created.body.id}/chapters/5`
    );
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
    const created = await importSampleBook(app);
    const green = await request(app).get(
      `/api/books/${created.body.id}/chapters/3`
    );
    expect(green.status).toBe(200);
    expect(green.body).toMatchObject({
      position: 3,
      title: "Chapter Two: Green",
      level: 2,
    });
    expect(green.body.blocks).toEqual([]);
  });

  it("returns 404 for chapters outside the book", async () => {
    const created = await importSampleBook(app);
    expect(
      (await request(app).get(`/api/books/${created.body.id}/chapters/99`))
        .status
    ).toBe(404);
    expect(
      (await request(app).get(`/api/books/${created.body.id}/chapters/zero`))
        .status
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
    expect(created.status).toBe(201);
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
    const created = await importSampleBook(app);
    expect(created.status).toBe(201);
    return created.body.id as number;
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

    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(201);

    const red = await request(app).get(
      `/api/books/${created.body.id}/chapters/2`
    );
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

    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(201);

    const red = await request(app).get(
      `/api/books/${created.body.id}/chapters/2`
    );
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

  it("imports with empty translation lines when no translator is configured", async () => {
    const app = createApp(database, dictionary);

    const created = await request(app)
      .post("/api/books")
      .attach("file", sampleBookPath);
    expect(created.status).toBe(201);

    const red = await request(app).get(
      `/api/books/${created.body.id}/chapters/2`
    );
    for (const block of red.body.blocks as {
      translationText: string | null;
    }[]) {
      expect(block.translationText).toBeNull();
    }
  });
});
