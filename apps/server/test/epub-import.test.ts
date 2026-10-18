import { readFileSync } from "node:fs";
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
import { buildEpub, createSampleEpub } from "./fixtures/epub.js";

describe("EPUB import through the HTTP API seam", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof openDictionary>;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
    // The translator rides along to prove the annotation pipeline behind the
    // EPUB front half is the same one Markdown uses (ticket 07).
    app = createApp(
      database,
      dictionary,
      createFakeTranslator((batch) => batch.map((sentence) => `译:${sentence}`))
    );
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  async function importSampleEpub(): Promise<number> {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await createSampleEpub(), {
        filename: "sample-book.epub",
        contentType: "application/epub+zip",
      });
    // The import finishes asynchronously (ticket 08); chapter content is
    // only queryable once the book settles ready on the shelf.
    expect(created.status).toBe(202);
    await waitForShelfBook(app, created.body.id, "ready");
    return created.body.id as number;
  }

  it("imports spine-order chapters under the package title and lists the book", async () => {
    const bookId = await importSampleEpub();

    const toc = await request(app).get(`/api/books/${bookId}`);
    expect(toc.status).toBe(200);
    // The package dc:title names the book, not the first chapter heading.
    expect(toc.body).toMatchObject({
      id: bookId,
      title: "Sample EPUB Book",
      format: "epub",
    });
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "The Sample EPUB", level: 1 },
      { position: 2, title: "Chapter One: Pictures", level: 2 },
      { position: 3, title: "Chapter Two: Words", level: 2 },
    ]);

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books[0]).toMatchObject({
      id: bookId,
      title: "Sample EPUB Book",
      format: "epub",
    });
  });

  it("returns sentence and image blocks split from the spine documents", async () => {
    const bookId = await importSampleEpub();

    const titlePage = await request(app).get(`/api/books/${bookId}/chapters/1`);
    expect(titlePage.status).toBe(200);
    expect(titlePage.body.blocks).toEqual([
      {
        position: 1,
        kind: "sentence",
        originalText: "He wrote the book on quiet reading.",
        ipaSlots: ["hi", "roʊt", "", "bʊk", "", "", ""],
        ipaText: "hi roʊt  bʊk",
        translationText: "译:He wrote the book on quiet reading.",
      },
      {
        position: 2,
        kind: "sentence",
        originalText: "A second paragraph keeps the spine honest.",
        ipaSlots: ["ə", "", "", "", "", "", ""],
        ipaText: "ə",
        translationText: "译:A second paragraph keeps the spine honest.",
      },
    ]);

    const pictures = await request(app).get(`/api/books/${bookId}/chapters/2`);
    expect(pictures.status).toBe(200);
    // Images hold their reading-order position between the sentences, as
    // placeholder blocks; headings never become sentence blocks.
    expect(pictures.body.blocks).toEqual([
      {
        position: 1,
        kind: "sentence",
        originalText: "A picture sits between two sentences.",
        ipaSlots: ["ə", "", "", "", "", ""],
        ipaText: "ə",
        translationText: "译:A picture sits between two sentences.",
      },
      { position: 2, kind: "image", originalText: "A red dot" },
      {
        position: 3,
        kind: "sentence",
        originalText: "The story continues after the picture.",
        ipaSlots: ["", "", "", "", "", ""],
        ipaText: "",
        translationText: "译:The story continues after the picture.",
      },
      { position: 4, kind: "image", originalText: "A blue square" },
      {
        position: 5,
        kind: "sentence",
        originalText: "The square closes the chapter.",
        ipaSlots: ["", "", "", "", ""],
        ipaText: "",
        translationText: "译:The square closes the chapter.",
      },
    ]);

    const words = await request(app).get(`/api/books/${bookId}/chapters/3`);
    expect(words.status).toBe(200);
    expect(
      words.body.blocks.map(
        (block: { originalText: string }) => block.originalText
      )
    ).toEqual(["Zebras cannot read.", "Yet the book remains calm!"]);
  });

  it("rejects uploads that are neither markdown nor epub with 415", async () => {
    const response = await request(app)
      .post("/api/books")
      .attach("file", Buffer.from("plain text, not a book"), {
        filename: "book.txt",
      });
    expect(response.status).toBe(415);
    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books).toEqual([]);
  });

  it("returns 400 for a .epub that is not a zip at all", async () => {
    const response = await request(app)
      .post("/api/books")
      .attach("file", Buffer.from("definitely not a zip"), {
        filename: "broken.epub",
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
    expect((await request(app).get("/api/books")).body.books).toEqual([]);
  });

  it("returns 400 for a zip that has no package document behind the container", async () => {
    const response = await request(app)
      .post("/api/books")
      .attach(
        "file",
        await buildEpub({ title: "Broken", docs: [], omitPackage: true }),
        { filename: "broken.epub" }
      );
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
    expect((await request(app).get("/api/books")).body.books).toEqual([]);
  });
});

// Messy shapes real EPUBs contain (CODING_STANDARDS: fixtures mirror
// real-data shapes) — each exercises a path the clean sample never reaches.
describe("messy EPUB shapes through the HTTP API seam", () => {
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

  async function upload(book: Promise<Buffer>, filename: string) {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await book, { filename });
    return created;
  }

  it("resolves URL-encoded manifest hrefs to zip paths with spaces", async () => {
    const created = await upload(
      buildEpub({
        title: "Encoded",
        docs: [
          {
            href: "text/chapter one.xhtml",
            manifestHref: "text/chapter%20one.xhtml",
            body: "<h1>Encoded Path</h1><p>It still imports.</p>",
          },
        ],
      }),
      "encoded.epub"
    );
    expect(created.status).toBe(202);
    await waitForShelfBook(app, created.body.id, "ready");
    const toc = await request(app).get(`/api/books/${created.body.id}`);
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "Encoded Path", level: 1 },
    ]);
  });

  it("gives a headingless spine document its own chapter titled from <head><title>", async () => {
    const created = await upload(
      buildEpub({
        title: "With Cover",
        docs: [
          {
            href: "cover.xhtml",
            title: "Cover",
            body: `<p><img src="cover.png" alt="Front cover"/></p>`,
          },
          { href: "ch1.xhtml", body: "<h1>Chapter One</h1><p>Real text.</p>" },
        ],
        images: [{ href: "cover.png" }],
      }),
      "cover.epub"
    );
    expect(created.status).toBe(202);
    await waitForShelfBook(app, created.body.id, "ready");
    const toc = await request(app).get(`/api/books/${created.body.id}`);
    // The cover keeps its spine position instead of merging into chapter one.
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "Cover", level: null },
      { position: 2, title: "Chapter One", level: 1 },
    ]);
    const cover = await request(app).get(
      `/api/books/${created.body.id}/chapters/1`
    );
    expect(cover.body.blocks).toEqual([
      { position: 1, kind: "image", originalText: "Front cover" },
    ]);
  });

  it("falls back to the first heading when the package has no dc:title", async () => {
    const created = await upload(
      buildEpub({
        docs: [{ href: "a.xhtml", body: "<h1>Heading Title</h1><p>Text.</p>" }],
      }),
      "untitled.epub"
    );
    expect(created.status).toBe(202);
    expect(created.body.title).toBe("Heading Title");
  });

  it("returns 400 when a spine document is missing from the archive", async () => {
    const created = await upload(
      buildEpub({
        title: "Hole",
        docs: [
          { href: "here.xhtml", body: "<h1>Here</h1><p>Text.</p>" },
          { href: "gone.xhtml", body: "<h1>Ghost</h1><p>Never shipped.</p>" },
        ],
        dropFiles: ["OEBPS/gone.xhtml"],
      }),
      "hole.epub"
    );
    expect(created.status).toBe(400);
    expect(created.body.error).toContain("gone.xhtml");
    expect((await request(app).get("/api/books")).body.books).toEqual([]);
  });
});

// The committed binary exists for manual acceptance uploads; this keeps it
// from drifting away from the builder that documents its structure.
describe("committed sample fixture", () => {
  it("sample-book.epub is byte-identical to the builder output", async () => {
    const committed = readFileSync(
      fileURLToPath(new URL("./fixtures/sample-book.epub", import.meta.url))
    );
    expect(committed.equals(await createSampleEpub())).toBe(true);
  });
});
