import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  deleteBook,
  deleteNote,
  listReviewNotes,
  listShelf,
  saveProgress,
} from "../src/book-store.js";
import { seedReview } from "./fixtures/review.js";

describe("note review store", () => {
  let database: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    database = openDatabase(":memory:");
  });
  afterEach(() => database.close());

  it("returns an empty list before any notes exist", () => {
    expect(listReviewNotes(database)).toEqual([]);
  });

  it("joins titles, retains article notes, and orders by book, chapter, block and fixed type order", () => {
    const fixture = seedReview(database);
    expect(listReviewNotes(database)).toEqual(fixture.entries);
    const ids = new Set(listReviewNotes(database).map((entry) => entry.bookId));
    for (const absent of [fixture.empty, fixture.importing, fixture.failed])
      expect(ids.has(absent)).toBe(false);
    deleteBook(database, fixture.first);
    expect(listReviewNotes(database)).toEqual([fixture.entries.at(-1)]);
  });

  it("counts notes per book without multiplying progress rows, including article notes and deletion", () => {
    const fixture = seedReview(database);
    saveProgress(database, fixture.first, 2, 1);
    expect(listShelf(database).map((row) => [row.id, row.note_count])).toEqual([
      [fixture.first, 7],
      [fixture.second, 1],
      [fixture.empty, 0],
      [fixture.importing, 0],
      [fixture.failed, 0],
    ]);
    expect(listShelf(database)[0]).toMatchObject({
      progress_chapter: 2,
      progress_block: 1,
    });
    deleteNote(database, fixture.first, fixture.entries[0]!.note.id);
    expect(listShelf(database)[0]?.note_count).toBe(6);
  });
});
