import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { ExtBook } from "../src/reader/import-book";
import {
  READER_RECORDS_DATABASE,
  createIdbNamespaceStorage,
} from "../src/store/idb-namespace-storage";
import { createLibraryStore } from "../src/store/library-store";

// The WebView replacement for chrome.storage.local's namespace use
// (mobile-app ticket 02): one IndexedDB database, one out-of-line key per
// namespace record. The contract mirrors what the four stores program
// against — a missing namespace reads as an empty bag, every read answers
// a fresh clone (the lost-update determinism the write queue's tests rely
// on), and writes replace one namespace without touching the others.
describe("IndexedDB namespace storage", () => {
  it("an empty database reads back an empty bag", async () => {
    const storage = createIdbNamespaceStorage(new IDBFactory());
    expect(await storage.get("library")).toEqual({});
  });

  it("set writes the bag and get answers a fresh clone of it", async () => {
    const storage = createIdbNamespaceStorage(new IDBFactory());
    const record = { documents: { "doc:a": { title: "Book A" } } };
    await storage.set({ library: record });
    const bag = await storage.get("library");
    expect(bag).toEqual({ library: record });
    // Clone-on-read: a caller mutating the answered bag must not reach the
    // stored record (chrome.storage.local's parity — the namespace record's
    // lost-update determinism leans on it).
    (bag.library as Record<string, unknown>).documents = {};
    expect(await storage.get("library")).toEqual({ library: record });
  });

  it("a second write replaces the namespace record wholesale", async () => {
    const storage = createIdbNamespaceStorage(new IDBFactory());
    await storage.set({ vocabulary: { woke: "learning" } });
    await storage.set({ vocabulary: { pervasive: "mastered" } });
    expect(await storage.get("vocabulary")).toEqual({
      vocabulary: { pervasive: "mastered" },
    });
  });

  it("namespaces are isolated — one bag's key never leaks into another", async () => {
    const storage = createIdbNamespaceStorage(new IDBFactory());
    await storage.set({ library: { documents: {} } });
    await storage.set({ notes: { version: 2, notes: [] } });
    expect(await storage.get("vocabulary")).toEqual({});
    expect(await storage.get("library")).toEqual({
      library: { documents: {} },
    });
    expect(await storage.get("notes")).toEqual({
      notes: { version: 2, notes: [] },
    });
  });

  it("a new instance over the same factory reads prior writes", async () => {
    // Two ReaderPage mounts construct separate adapters over one database;
    // records must survive the handoff the way a killed process's reboot
    // reads them back.
    const factory = new IDBFactory();
    await createIdbNamespaceStorage(factory).set({
      vocabulary: { persistent: "learning" },
    });
    const storage = createIdbNamespaceStorage(factory);
    expect(await storage.get("vocabulary")).toEqual({
      vocabulary: { persistent: "learning" },
    });
  });

  it("database names are isolated from each other", async () => {
    const factory = new IDBFactory();
    await createIdbNamespaceStorage(factory).set({
      library: { documents: {} },
    });
    const elsewhere = createIdbNamespaceStorage(factory, "lingualeaf-other");
    expect(await elsewhere.get("library")).toEqual({});
  });

  it("composes through the real store path: library save and list over IDB", async () => {
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
    const library = createLibraryStore(
      createIdbNamespaceStorage(new IDBFactory())
    );
    await library.saveDocument({
      id: "doc:a",
      title: "Book A",
      book: BOOK("Book A"),
    });
    await library.setProgress("doc:a", { chapterIndex: 1, blockIndex: 2 });
    const entries = await library.listDocuments();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "doc:a",
      title: "Book A",
      progress: { chapterIndex: 1, blockIndex: 2 },
    });
    const book = await library.openDocument("doc:a");
    expect(book?.title).toBe("Book A");
  });

  it("names its default database with the shared constant", () => {
    expect(READER_RECORDS_DATABASE).toBe("lingualeaf-reader");
  });
});
