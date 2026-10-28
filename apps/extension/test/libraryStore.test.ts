import { describe, expect, it } from "vitest";
import type { ExtBook } from "../src/reader/import-book";
import { createMemoryLibraryStore } from "../src/store/library-store";

const BOOK = (title: string): ExtBook => ({
  title,
  chapters: [
    {
      title: "One",
      level: 1,
      blocks: [{ kind: "sentence", text: "Words.", ipaSlots: [""] }],
    },
  ],
});

describe("LibraryStore — progress + recents (ticket 05)", () => {
  it("saves a document, lists it, and reads it back", async () => {
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "doc:a",
      title: "Book A",
      book: BOOK("Book A"),
    });
    const entries = await library.listDocuments();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "doc:a", title: "Book A" });
    const book = await library.openDocument("doc:a");
    expect(book?.title).toBe("Book A");
  });

  it("remembers per-document progress independently", async () => {
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "doc:a",
      title: "Book A",
      book: BOOK("Book A"),
    });
    await library.saveDocument({
      id: "doc:b",
      title: "Book B",
      book: BOOK("Book B"),
    });
    await library.setProgress("doc:a", { chapterIndex: 3, blockIndex: 7 });
    await library.setProgress("doc:b", { chapterIndex: 0, blockIndex: 0 });
    const entries = await library.listDocuments();
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("doc:a")?.progress).toEqual({
      chapterIndex: 3,
      blockIndex: 7,
    });
    expect(byId.get("doc:b")?.progress).toEqual({
      chapterIndex: 0,
      blockIndex: 0,
    });
  });

  it("recents sort by last opened, most recent first", async () => {
    // A ticking clock: same-millisecond touches would tie the sort.
    let tick = 1000;
    const library = createMemoryLibraryStore(() => ++tick);
    await library.saveDocument({
      id: "doc:a",
      title: "Book A",
      book: BOOK("Book A"),
    });
    await library.saveDocument({
      id: "doc:b",
      title: "Book B",
      book: BOOK("Book B"),
    });
    await library.openDocument("doc:a"); // a touched last
    let entries = await library.listDocuments();
    expect(entries[0]?.id).toBe("doc:a");
    await library.openDocument("doc:b"); // now b is newest
    entries = await library.listDocuments();
    expect(entries[0]?.id).toBe("doc:b");
  });

  it("re-saving the same document id replaces it, keeping progress", async () => {
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "doc:a",
      title: "Book A",
      book: BOOK("Book A"),
    });
    await library.setProgress("doc:a", { chapterIndex: 2, blockIndex: 1 });
    await library.saveDocument({
      id: "doc:a",
      title: "Book A",
      book: BOOK("Book A v2"),
    });
    const book = await library.openDocument("doc:a");
    expect(book?.title).toBe("Book A v2");
    const entries = await library.listDocuments();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.progress).toEqual({ chapterIndex: 2, blockIndex: 1 });
  });

  it("an unknown document reads back null", async () => {
    const library = createMemoryLibraryStore();
    expect(await library.openDocument("doc:none")).toBeNull();
  });
});
