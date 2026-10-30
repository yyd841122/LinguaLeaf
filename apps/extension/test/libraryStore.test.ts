import { describe, expect, it } from "vitest";
import type { ExtBook } from "../src/reader/import-book";
import {
  createChromeLibraryStore,
  createMemoryLibraryStore,
} from "../src/store/library-store";

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

// The chrome backend's write queue (ext-reuse-convergence, ticket 07's
// vocabulary fix made uniform): clone-on-read storage makes the lost-update
// interleaving deterministic — both writers read the same base snapshot,
// and without the queue the later set erases the earlier field.
type ChromeStub = {
  storage: {
    local: {
      get(namespace: string): Promise<Record<string, unknown>>;
      set(bag: Record<string, unknown>): Promise<void>;
    };
  };
};

function installChrome(stub: ChromeStub | undefined): void {
  (globalThis as unknown as Record<string, unknown>).chrome = stub;
}

describe("LibraryStore — chrome backend write serialization", () => {
  it("serializes overlapping writes so neither save nor progress is lost", async () => {
    let stored: unknown = undefined;
    const lag = <T>(value: T): Promise<T> =>
      new Promise((resolve) => setTimeout(() => resolve(value), 0));
    installChrome({
      storage: {
        local: {
          async get(namespace) {
            const snapshot =
              stored === undefined
                ? undefined
                : JSON.parse(JSON.stringify(stored));
            return lag({ [namespace]: snapshot });
          },
          async set(bag) {
            const [, record] = Object.entries(bag)[0]!;
            stored = JSON.parse(JSON.stringify(record));
          },
        },
      },
    });
    try {
      const library = createChromeLibraryStore();
      await library.saveDocument({
        id: "doc:a",
        title: "Book A",
        book: BOOK("Book A"),
      });
      // A (debounced-style) progress save overlaps a re-save touching the
      // entry's other half: both must land.
      const progress = library.setProgress("doc:a", {
        chapterIndex: 1,
        blockIndex: 2,
      });
      const resave = library.saveDocument({
        id: "doc:a",
        title: "Book A2",
        book: BOOK("Book A2"),
      });
      await Promise.all([progress, resave]);
      const entry = (await library.listDocuments()).find(
        (e) => e.id === "doc:a"
      )!;
      expect(entry.title).toBe("Book A2");
      expect(entry.progress).toEqual({ chapterIndex: 1, blockIndex: 2 });
    } finally {
      installChrome(undefined);
    }
  });
});
