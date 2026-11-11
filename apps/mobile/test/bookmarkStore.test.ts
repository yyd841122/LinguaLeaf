import { describe, expect, it } from "vitest";
import {
  byReadingOrder,
  createBookmarkStore,
  createMemoryBookmarkStore,
} from "../src/store/bookmark-store";

// The bookmark store (mobile-app ticket 10): rows in the wire's
// BookmarkSummary shape, (chapter, block) reading order, same-position
// adds idempotent, removal idempotent-safe — the semantics the web
// reading-bookmarks routes own on the server, carried here over the
// mobile store seams (memory twin for jsdom, namespace record for the
// phone's IndexedDB).

const cloningBackend = () => {
  // The IndexedDB backend clones on read (structured clone) — the store
  // must own its records, not borrow identities the clone broke.
  const backing = new Map<string, unknown>();
  return {
    storage: {
      async get(namespace: string) {
        const snapshot = structuredClone(backing.get(namespace));
        return snapshot === undefined ? {} : { [namespace]: snapshot };
      },
      async set(bag: Record<string, unknown>) {
        for (const [key, value] of Object.entries(bag))
          backing.set(key, structuredClone(value));
      },
    },
    storedNamespaces: () => [...backing.keys()],
  };
};

describe("BookmarkStore — memory twin", () => {
  it("lists an untouched document as no bookmarks", async () => {
    const store = createMemoryBookmarkStore();
    expect(await store.list("doc:A")).toEqual([]);
  });

  it("mints rows and lists them in (chapter, block) reading order", async () => {
    const store = createMemoryBookmarkStore();
    await store.add("doc:A", { chapter: 1, block: 2 });
    await store.add("doc:A", { chapter: 0, block: 5 });
    await store.add("doc:A", { chapter: 0, block: 1 });
    const rows = await store.list("doc:A");
    expect(rows.map((r) => [r.chapter, r.block])).toEqual([
      [0, 1],
      [0, 5],
      [1, 2],
    ]);
    // Fresh ids, minted in add order (1, 2, 3) — listed in reading order
    // they read back 3, 2, 1; createdAt is a real ISO instant.
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    for (const row of rows) expect(row.createdAt).toMatch(/^\d{4}-/);
  });

  it("a same-position add returns the existing row unchanged", async () => {
    const store = createMemoryBookmarkStore();
    const first = await store.add("doc:A", { chapter: 0, block: 3 });
    const again = await store.add("doc:A", { chapter: 0, block: 3 });
    expect(again).toEqual(first);
    expect(await store.list("doc:A")).toHaveLength(1);
  });

  it("removes a row; removing an absent id is a quiet success", async () => {
    const store = createMemoryBookmarkStore();
    const row = await store.add("doc:A", { chapter: 0, block: 0 });
    await store.remove("doc:A", row.id + 99);
    expect(await store.list("doc:A")).toHaveLength(1);
    await store.remove("doc:A", row.id);
    expect(await store.list("doc:A")).toEqual([]);
  });

  it("keeps documents from bleeding into each other", async () => {
    const store = createMemoryBookmarkStore();
    await store.add("doc:A", { chapter: 0, block: 0 });
    await store.add("doc:B", { chapter: 1, block: 1 });
    expect(await store.list("doc:A")).toHaveLength(1);
    expect((await store.list("doc:B"))[0]!.chapter).toBe(1);
    expect(await store.list("doc:C")).toEqual([]);
  });
});

describe("BookmarkStore — record backend", () => {
  it("persists across store instances over one backend (杀进程不丢's surrogate)", async () => {
    const { storage } = cloningBackend();
    const first = createBookmarkStore(storage);
    const planted = await first.add("doc:A", { chapter: 2, block: 4 });
    // A fresh store over the same backend — the process died in between.
    const second = createBookmarkStore(storage);
    expect(await second.list("doc:A")).toEqual([planted]);
  });

  it("carries the same idempotence and order through the record", async () => {
    const { storage } = cloningBackend();
    const store = createBookmarkStore(storage);
    const first = await store.add("doc:A", { chapter: 0, block: 2 });
    await store.add("doc:A", { chapter: 0, block: 0 });
    const again = await store.add("doc:A", { chapter: 0, block: 2 });
    expect(again).toEqual(first);
    const rows = await store.list("doc:A");
    expect(rows.map((r) => r.block)).toEqual([0, 2]);
  });

  it("removal through the record stays removed for the next instance", async () => {
    const { storage } = cloningBackend();
    const store = createBookmarkStore(storage);
    const row = await store.add("doc:A", { chapter: 0, block: 1 });
    await store.remove("doc:A", row.id);
    expect(await createBookmarkStore(storage).list("doc:A")).toEqual([]);
  });

  it("shares one namespace key with the other record seams' discipline", async () => {
    const { storage, storedNamespaces } = cloningBackend();
    const store = createBookmarkStore(storage);
    await store.add("doc:A", { chapter: 0, block: 0 });
    expect(storedNamespaces()).toEqual(["bookmarks"]);
  });
});

describe("byReadingOrder", () => {
  it("orders by chapter first, block within it", () => {
    const rows = [
      { id: 1, chapter: 1, block: 0, createdAt: "" },
      { id: 2, chapter: 0, block: 9, createdAt: "" },
      { id: 3, chapter: 0, block: 2, createdAt: "" },
    ];
    expect([...rows].sort(byReadingOrder).map((r) => r.id)).toEqual([3, 2, 1]);
  });
});
