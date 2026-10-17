import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";

const sampleBookPath = fileURLToPath(
  new URL("./fixtures/sample-book.md", import.meta.url)
);

describe("Markdown import through the HTTP API seam", () => {
  let database: Database.Database;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    app = createApp(database);
  });
  afterEach(() => {
    database.close();
  });

  async function importSampleBook() {
    return request(app).post("/api/books").attach("file", sampleBookPath);
  }

  it("imports a markdown file and lists the book on the bookshelf", async () => {
    const created = await importSampleBook();
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
    const created = await importSampleBook();
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
    const created = await importSampleBook();

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
        ipaText: null,
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
        ipaText: null,
        translationText: null,
      },
      {
        position: 2,
        kind: "sentence",
        originalText: "The morning was quiet, and the sea was calm.",
        ipaText: null,
        translationText: null,
      },
      {
        position: 3,
        kind: "sentence",
        originalText: "He wrote a failing test first.",
        ipaText: null,
        translationText: null,
      },
      {
        position: 4,
        kind: "sentence",
        originalText: "Then he made it pass!",
        ipaText: null,
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
        ipaText: null,
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
    const created = await importSampleBook();
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
        ipaText: null,
        translationText: null,
      },
      {
        position: 2,
        kind: "sentence",
        originalText: "Write the failing test first.",
        ipaText: null,
        translationText: null,
      },
      {
        position: 3,
        kind: "sentence",
        originalText: "Refactor with the suite green.",
        ipaText: null,
        translationText: null,
      },
      {
        position: 4,
        kind: "sentence",
        originalText: "Keep the list short.",
        ipaText: null,
        translationText: null,
      },
      {
        position: 5,
        kind: "sentence",
        originalText:
          "A test that passes the moment it is written has told you nothing.",
        ipaText: null,
        translationText: null,
      },
      {
        position: 6,
        kind: "sentence",
        originalText: "It merely records the code as it is.",
        ipaText: null,
        translationText: null,
      },
    ]);
  });

  it("returns an empty block list for a heading-only chapter", async () => {
    const created = await importSampleBook();
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
    const created = await importSampleBook();
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

  it("rejects uploads that are not markdown and leaves the shelf empty", async () => {
    const response = await request(app)
      .post("/api/books")
      .attach("file", Buffer.from("<html>not a book</html>"), {
        filename: "book.epub",
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

describe("HTTP API seam", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });
  afterEach(() => {
    database.close();
  });

  it("reports a healthy server with a real SQLite connection", async () => {
    const response = await request(createApp(database)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ status: "ok" });
  });

  it("returns an API 404 instead of the frontend HTML", async () => {
    const response = await request(createApp(database)).get("/api/missing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "API route not found" });
  });
});
