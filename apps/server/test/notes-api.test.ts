import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import {
  addNote,
  createImportingBook,
  persistBook,
  settleImport,
  MAX_NOTES_PER_BOOK,
  MAX_NOTE_TEXT_LENGTH,
} from "../src/book-store.js";

describe("notes HTTP matrix", () => {
  let db: ReturnType<typeof openDatabase>;
  let dict: ReturnType<typeof createFixtureDictionary>;
  let app: ReturnType<typeof createApp>;
  let id: number;
  beforeEach(() => {
    db = openDatabase(":memory:");
    dict = createFixtureDictionary();
    app = createApp(db, dict);
    id = createImportingBook(db, "Notes", "markdown", null);
    persistBook(db, id, [
      {
        title: "One",
        level: null,
        blocks: Array.from({ length: MAX_NOTES_PER_BOOK + 1 }, () => ({
          kind: "raw",
          text: "A block",
          ipaSlots: null,
          ipaText: null,
          translation: null,
        })),
      },
    ]);
    settleImport(db, id, "ready", null);
  });
  afterEach(() => {
    db.close();
    dict.close();
  });
  const path = (book: number) => `/api/books/${book}/notes`;

  it("creates defaults, conflicts with existing data, replaces content, and deletes idempotently", async () => {
    const created = await request(app)
      .post(path(id))
      .send({ text: "Book note" })
      .expect(201);
    expect(created.body.note).toEqual({
      id: expect.any(Number),
      chapter: null,
      block: null,
      type: "idea",
      text: "Book note",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const duplicate = await request(app)
      .post(path(id))
      .send({ text: "New draft" })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      code: "note-exists",
      note: created.body.note,
    });
    const block = await request(app)
      .post(path(id))
      .send({ chapter: 1, block: 2, type: "feeling", text: "A feeling" })
      .expect(201);
    expect(
      (
        await request(app)
          .post(path(id))
          .send({ chapter: 1, block: 2, text: "Another" })
          .expect(409)
      ).body
    ).toMatchObject({ code: "note-exists", note: block.body.note });
    const edited = await request(app)
      .put(`${path(id)}/${created.body.note.id}`)
      .send({ type: "question", text: "Why?" })
      .expect(200);
    expect(edited.body.note).toMatchObject({
      id: created.body.note.id,
      chapter: null,
      block: null,
      type: "question",
      text: "Why?",
    });
    expect((await request(app).get(path(id)).expect(200)).body.notes).toEqual([
      edited.body.note,
      block.body.note,
    ]);
    const other = createImportingBook(db, "Other", "markdown", null);
    settleImport(db, other, "ready", null);
    await request(app)
      .put(`${path(other)}/${created.body.note.id}`)
      .send({ type: "idea", text: "Wrong owner" })
      .expect(404);
    await request(app)
      .delete(`${path(other)}/${created.body.note.id}`)
      .expect(204);
    expect((await request(app).get(path(id))).body.notes).toHaveLength(2);
    await request(app)
      .delete(`${path(id)}/${created.body.note.id}`)
      .expect(204);
    await request(app)
      .delete(`${path(id)}/${created.body.note.id}`)
      .expect(204);
  });

  it.each([
    { chapter: 1, text: "half" },
    { block: 1, text: "half" },
    { chapter: null, block: 1, text: "half" },
    { chapter: 1, block: null, text: "half" },
    { chapter: 0, block: 1, text: "zero" },
    { chapter: 1.5, block: 1, text: "fraction" },
    { chapter: "1", block: 1, text: "string" },
    { text: "" },
    { text: " \n\t" },
    { text: "x".repeat(MAX_NOTE_TEXT_LENGTH + 1) },
    { text: "bad type", type: "constructor" },
    { text: 42 },
    {},
  ])("rejects invalid create body %#", async (body) => {
    const result = await request(app).post(path(id)).send(body).expect(400);
    expect(result.body.code).toMatch(/^invalid-/);
    expect((await request(app).get(path(id))).body.notes).toEqual([]);
  });

  it("requires complete PUT content and forbids anchor changes", async () => {
    const created = await request(app).post(path(id)).send({ text: "Keep" });
    for (const body of [
      { text: "No type" },
      { type: "idea" },
      { type: "bad", text: "No" },
      { type: "idea", text: " " },
      { type: "idea", text: "x".repeat(MAX_NOTE_TEXT_LENGTH + 1) },
      { type: "idea", text: "Move", chapter: 1, block: 1 },
    ]) {
      await request(app)
        .put(`${path(id)}/${created.body.note.id}`)
        .send(body)
        .expect(400);
    }
    expect((await request(app).get(path(id))).body.notes).toEqual([
      created.body.note,
    ]);
  });

  it("distinguishes missing books/targets, non-ready books, and capacity including the book row", async () => {
    expect(
      (
        await request(app)
          .post(path(id))
          .send({ chapter: 99, block: 1, text: "Missing" })
          .expect(404)
      ).body.code
    ).toBe("note-target-not-found");
    for (const method of ["get", "post", "put", "delete"] as const) {
      const url =
        method === "put" || method === "delete" ? `${path(999)}/1` : path(999);
      const client = request(app);
      const result = await client[method](url)
        .send({ type: "idea", text: "Missing" })
        .expect(404);
      expect(result.body.code).toBe("book-not-found");
    }
    const importing = createImportingBook(db, "Importing", "markdown", null);
    for (const method of ["get", "post", "put"] as const) {
      const url = method === "put" ? `${path(importing)}/1` : path(importing);
      const client = request(app);
      expect(
        (
          await client[method](url)
            .send({ type: "idea", text: "Wait" })
            .expect(409)
        ).body.code
      ).toBe("book-not-ready");
    }
    await request(app)
      .delete(`${path(importing)}/1`)
      .expect(204);
    addNote(
      db,
      id,
      { chapter: null, block: null },
      { type: "idea", text: "Book" }
    );
    for (let block = 1; block < MAX_NOTES_PER_BOOK; block++)
      addNote(db, id, { chapter: 1, block }, { type: "idea", text: "Block" });
    expect(
      (
        await request(app)
          .post(path(id))
          .send({ chapter: 1, block: MAX_NOTES_PER_BOOK, text: "Full" })
          .expect(409)
      ).body.code
    ).toBe("note-limit-reached");
    const existing = await request(app)
      .post(path(id))
      .send({ text: "Duplicate at cap" })
      .expect(409);
    expect(existing.body.code).toBe("note-exists");
    await request(app)
      .put(`${path(id)}/${existing.body.note.id}`)
      .send({ type: "progress", text: "Edit at cap" })
      .expect(200);
  });
});
