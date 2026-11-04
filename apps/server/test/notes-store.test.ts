import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  addNote,
  listNotes,
  updateNote,
  deleteNote,
  deleteBook,
  createImportingBook,
  persistBook,
  MAX_NOTES_PER_BOOK,
} from "../src/book-store.js";

describe("notes store", () => {
  let db: ReturnType<typeof openDatabase>;
  let book: number;
  beforeEach(() => {
    db = openDatabase(":memory:");
    book = createImportingBook(db, "Notes", "markdown", null);
    persistBook(db, book, [
      {
        title: "One",
        level: null,
        blocks: Array.from({ length: MAX_NOTES_PER_BOOK + 1 }, (_, i) => ({
          kind: (["sentence", "code", "raw", "image"] as const)[i % 4]!,
          text: `Block ${i}`,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        })),
      },
    ]);
  });
  afterEach(() => db.close());

  it("round-trips book and all four block kinds, ordered with the book first", () => {
    for (const block of [4, 2, 1, 3]) {
      expect(
        addNote(
          db,
          book,
          { chapter: 1, block },
          { type: "idea", text: `Note ${block}` }
        ).outcome
      ).toBe("created");
    }
    const result = addNote(
      db,
      book,
      { chapter: null, block: null },
      { type: "progress", text: "Stopped here" }
    );
    expect(result.outcome).toBe("created");
    const notes = listNotes(db, book);
    expect(notes.map((n) => n.block)).toEqual([null, 1, 2, 3, 4]);
    const first = notes[0]!;
    expect(first).toEqual({
      id: expect.any(Number),
      chapter: null,
      block: null,
      type: "progress",
      text: "Stopped here",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(
      addNote(
        db,
        book,
        { chapter: null, block: null },
        { type: "feeling", text: "Do not overwrite" }
      )
    ).toEqual({ outcome: "existing", note: first });
    const updated = updateNote(db, book, first.id, {
      type: "question",
      text: "Why?",
    })!;
    expect(updated).toMatchObject({
      ...first,
      type: "question",
      text: "Why?",
      updatedAt: expect.any(String),
    });
    expect(updated.updatedAt > first.updatedAt).toBe(true);
    expect(
      updateNote(db, book + 1, first.id, { type: "idea", text: "Wrong book" })
    ).toBeUndefined();
    deleteNote(db, book + 1, first.id);
    expect(listNotes(db, book)).toHaveLength(5);
    deleteNote(db, book, first.id);
    deleteNote(db, book, first.id);
    expect(listNotes(db, book)).toHaveLength(4);
    deleteBook(db, book);
    expect(listNotes(db, book)).toEqual([]);
  });

  it("counts the book note toward capacity, rejects nonexistent anchors, and edits at capacity", () => {
    expect(
      addNote(
        db,
        book,
        { chapter: 2, block: 1 },
        { type: "idea", text: "Missing" }
      ).outcome
    ).toBe("target-not-found");
    addNote(
      db,
      book,
      { chapter: null, block: null },
      { type: "idea", text: "Book" }
    );
    for (let block = 1; block < MAX_NOTES_PER_BOOK; block++) {
      addNote(db, book, { chapter: 1, block }, { type: "idea", text: "Block" });
    }
    expect(
      addNote(
        db,
        book,
        { chapter: 1, block: MAX_NOTES_PER_BOOK },
        { type: "idea", text: "Full" }
      ).outcome
    ).toBe("limit-reached");
    const first = listNotes(db, book)[0]!;
    expect(
      addNote(
        db,
        book,
        { chapter: null, block: null },
        { type: "idea", text: "Duplicate at cap" }
      ).outcome
    ).toBe("existing");
    expect(
      updateNote(db, book, first.id, { type: "feeling", text: "Allowed" })?.text
    ).toBe("Allowed");
    deleteNote(db, book, first.id);
    expect(
      addNote(
        db,
        book,
        { chapter: null, block: null },
        { type: "idea", text: "Room again" }
      ).outcome
    ).toBe("created");
  });
});
