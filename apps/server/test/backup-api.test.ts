import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import {
  createImportingBook,
  persistBook,
  saveProgress,
  saveSentenceTranslations,
  settleImport,
  listSentenceBlocks,
} from "../src/book-store.js";
import { setWordState } from "../src/vocab-store.js";
import { BACKUP_APP, BACKUP_VERSION } from "../src/wire.js";

// The PC's full-backup export (mobile-app ticket 05): one GET assembles
// the versioned payload — vocabulary, anchored notes, progress, bookmarks
// and settled translations, all keyed on book titles (the one join key
// the phone derives). Book-level notes have no phone-side block grid:
// they are skipped and the count rides the diagnostic header.

describe("GET /api/export/backup", () => {
  let db: ReturnType<typeof openDatabase>;
  let dict: ReturnType<typeof createFixtureDictionary>;
  let app: ReturnType<typeof createApp>;
  let bookId: number;
  beforeEach(() => {
    db = openDatabase(":memory:");
    dict = createFixtureDictionary();
    app = createApp(db, dict);
    bookId = createImportingBook(db, "PC Book", "markdown", null);
    persistBook(db, bookId, [
      {
        title: "One",
        level: null,
        blocks: [
          {
            kind: "sentence",
            text: "Words arrive.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
          {
            kind: "raw",
            text: "A block",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
          {
            kind: "sentence",
            text: "More follow.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
        ],
      },
    ]);
    settleImport(db, bookId, "ready", null);
  });
  afterEach(() => {
    db.close();
    dict.close();
  });

  it("assembles the versioned payload from every asset store", async () => {
    setWordState(db, "word", "learning");
    await request(app)
      .post(`/api/books/${bookId}/notes`)
      .send({
        type: "feeling",
        text: "锚定笔记",
        chapter: 1,
        block: 1,
      })
      .expect(201);
    await request(app)
      .post(`/api/books/${bookId}/notes`)
      .send({
        type: "idea",
        text: "书级笔记",
      })
      .expect(201);
    await request(app)
      .post(`/api/books/${bookId}/bookmarks`)
      .send({ chapter: 1, block: 3 })
      .expect(201);
    saveProgress(db, bookId, 1, 1);
    const blocks = listSentenceBlocks(
      db,
      // the first chapter row of the book
      (
        db.prepare("SELECT id FROM chapters WHERE book_id = ?").get(bookId) as {
          id: number;
        }
      ).id
    );
    saveSentenceTranslations(db, [
      { id: blocks[0]!.id, translation: "译文一行" },
    ]);

    const response = await request(app)
      .get("/api/export/backup")
      .expect(200)
      .expect("Content-Type", /json/);
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="lingualeaf-backup-v1-\d{8}-\d{4}\.json"$/
    );
    const body = response.body;
    expect(body.app).toBe(BACKUP_APP);
    expect(body.version).toBe(BACKUP_VERSION);
    expect(typeof body.exportedAt).toBe("string");
    expect(body.books).toEqual([{ title: "PC Book" }]);
    expect(body.assets.vocabulary).toEqual({ word: "learning" });
    // PC's 1-based (chapter 1, block 1) rides the format as phone
    // semantics: 0-based indices (the wire.ts coordinate convention).
    expect(body.assets.notes).toEqual([
      {
        bookTitle: "PC Book",
        chapterIndex: 0,
        blockIndex: 0,
        type: "feeling",
        text: "锚定笔记",
      },
    ]);
    expect(body.assets.progress).toEqual({
      "PC Book": { chapterIndex: 0, blockIndex: 0 },
    });
    expect(body.assets.bookmarks).toHaveLength(1);
    expect(body.assets.bookmarks[0]).toMatchObject({
      bookTitle: "PC Book",
      chapter: 0,
      block: 2,
    });
    expect(body.assets.bookmarks[0]!.createdAt).toEqual(expect.any(String));
    expect(body.assets.translations).toEqual({
      "PC Book": { "0": { "0": "译文一行" } },
    });
    // The book-level note was skipped, not silently: the diagnostic
    // header names the count (its body stays the clean format).
    expect(response.headers["x-backup-skipped-book-notes"]).toBe("1");
  });

  it("answers an empty-but-valid payload on an empty database", async () => {
    db.close();
    db = openDatabase(":memory:");
    dict = createFixtureDictionary();
    app = createApp(db, dict);
    const response = await request(app).get("/api/export/backup").expect(200);
    expect(response.body.assets).toEqual({
      vocabulary: {},
      notes: [],
      progress: {},
      bookmarks: [],
      translations: {},
    });
    expect(response.body.books).toEqual([]);
  });

  it("keeps a book literally titled constructor: own key, not the prototype's", async () => {
    // "constructor" is a real English word — a legal book title. Nested
    // on a bare `out[title] ??=` it hits the inherited Object member,
    // the ??= skips the assignment, and the book's translations vanish
    // from the backup. The export must carry it as an own key.
    const ctorId = createImportingBook(db, "constructor", "markdown", null);
    persistBook(db, ctorId, [
      {
        title: "One",
        level: null,
        blocks: [
          {
            kind: "sentence",
            text: "Ctors build.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
        ],
      },
    ]);
    settleImport(db, ctorId, "ready", null);
    const blocks = listSentenceBlocks(
      db,
      (
        db.prepare("SELECT id FROM chapters WHERE book_id = ?").get(ctorId) as {
          id: number;
        }
      ).id
    );
    saveSentenceTranslations(db, [
      { id: blocks[0]!.id, translation: "构造函数" },
    ]);

    const response = await request(app).get("/api/export/backup").expect(200);
    const translations = response.body.assets.translations;
    expect(Object.hasOwn(translations, "constructor")).toBe(true);
    expect(translations).toEqual({ constructor: { "0": { "0": "构造函数" } } });
    expect(response.body.books).toEqual([
      { title: "constructor" },
      { title: "PC Book" },
    ]);
  });
});
