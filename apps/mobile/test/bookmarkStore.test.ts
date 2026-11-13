import { describe, expect, it } from "vitest";
import {
  byReadingOrder,
  createBookmarkStore,
  createMemoryBookmarkStore,
  isEpubRow,
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
    expect(rows.filter(isEpubRow).map((r) => [r.chapter, r.block])).toEqual([
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
    expect((await store.list("doc:B")).filter(isEpubRow)[0]!.chapter).toBe(1);
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
    expect(rows.filter(isEpubRow).map((r) => r.block)).toEqual([0, 2]);
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

  it("orders page rows by page (ticket 03)", () => {
    const rows = [
      { id: 1, page: 7, createdAt: "" },
      { id: 2, page: 2, createdAt: "" },
      { id: 3, page: 4, createdAt: "" },
    ];
    expect([...rows].sort(byReadingOrder).map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("a mixed-shape pair sorts as equal — the unreachable case, pinned (ticket 03)", () => {
    // One doc never mixes shapes (EPUB doc:<title> ids vs PDF fingerprint
    // ids), so no comparator answer for the mixed pair is load-bearing;
    // the pin exists so a future change here is a decision, not a drift.
    expect(
      byReadingOrder(
        { id: 1, page: 3, createdAt: "" },
        { id: 2, chapter: 0, block: 1, createdAt: "" }
      )
    ).toBe(0);
  });
});

// PDF rows (ticket 03): the canvas face's marks target a page. One doc
// never mixes shapes — the tests below use fingerprint-style ids on the
// PDF side and doc: ids on the EPUB side, mirroring the two faces.
describe("BookmarkStore — page targets (PDF, ticket 03)", () => {
  it("memory twin: mints page rows in page order, replant idempotent", async () => {
    const store = createMemoryBookmarkStore();
    const first = await store.add("fp:A", { page: 5 });
    await store.add("fp:A", { page: 2 });
    const again = await store.add("fp:A", { page: 5 });
    expect(again).toEqual(first);
    const rows = await store.list("fp:A");
    expect(rows.map((r) => ("page" in r ? r.page : null))).toEqual([2, 5]);
    expect(rows.every((r) => r.createdAt)).toBe(true);
  });

  it("memory twin: documents stay isolated across kinds", async () => {
    const store = createMemoryBookmarkStore();
    await store.add("doc:Epub", { chapter: 0, block: 3 });
    await store.add("fp:Pdf", { page: 9 });
    expect((await store.list("doc:Epub"))[0]).toMatchObject({
      chapter: 0,
      block: 3,
    });
    expect((await store.list("fp:Pdf"))[0]).toMatchObject({ page: 9 });
    expect(await store.list("fp:Other")).toEqual([]);
  });

  it("record backend: a page row survives the process-death surrogate", async () => {
    const { storage } = cloningBackend();
    const first = createBookmarkStore(storage);
    const planted = await first.add("fp:A", { page: 12 });
    const second = createBookmarkStore(storage);
    expect(await second.list("fp:A")).toEqual([planted]);
    await second.remove("fp:A", planted.id);
    expect(await createBookmarkStore(storage).list("fp:A")).toEqual([]);
  });

  it("record backend: page rows ride exportAll in their own kind", async () => {
    const { storage } = cloningBackend();
    const store = createBookmarkStore(storage);
    await store.add("fp:A", { page: 3 });
    const exported = await store.exportAll();
    expect(exported).toEqual([
      { id: 1, page: 3, docId: "fp:A", createdAt: expect.any(String) },
    ]);
  });
});
