import { NOTE_TYPES } from "../../server/src/wire";
import { describe, expect, it } from "vitest";
import {
  createMemoryNotesStore,
  createNotesStore,
} from "../src/store/notes-store";

const anchor = {
  type: "progress" as const,
  docId: "doc:One",
  chapterIndex: 0,
  blockIndex: 2,
};

describe("extension notes storage contract", () => {
  it("enforces the 10,000-character boundary without replacing a saved note on failure", async () => {
    const store = createMemoryNotesStore();
    await store.save(anchor, "x".repeat(10_000));
    await expect(store.save(anchor, "y".repeat(10_001))).rejects.toThrow(
      "10,000"
    );
    expect((await store.list(anchor.docId))[0]?.text).toBe("x".repeat(10_000));
  });

  it("serializes the 100-note boundary, allows edits at capacity and frees capacity on delete", async () => {
    const store = createMemoryNotesStore();
    await Promise.all(
      Array.from({ length: 99 }, (_, blockIndex) =>
        store.save({ ...anchor, blockIndex }, "Saved")
      )
    );
    const finalWrites = await Promise.allSettled([
      store.save({ ...anchor, blockIndex: 99 }, "Last"),
      store.save({ ...anchor, blockIndex: 100 }, "Too many"),
    ]);
    expect(finalWrites.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await store.save(anchor, "Edited at capacity");
    expect(await store.list(anchor.docId)).toHaveLength(100);
    await store.save(
      { ...anchor, docId: "doc:Different" },
      "Independent limit"
    );
    await store.delete(anchor);
    await store.save({ ...anchor, blockIndex: 100 }, "New after delete");
    expect(await store.list(anchor.docId)).toHaveLength(100);
  });

  it("edits one note per full block index, isolates books and explicitly deletes", async () => {
    const store = createMemoryNotesStore();
    await store.save(anchor, "First");
    await store.save(anchor, "Edited");
    await store.save({ ...anchor, docId: "doc:Other" }, "Other");
    expect(await store.list(anchor.docId)).toEqual([
      { ...anchor, text: "Edited" },
    ]);
    await expect(store.save(anchor, "  \n")).rejects.toThrow();
    expect(await store.list(anchor.docId)).toHaveLength(1);
    await store.delete(anchor);
    expect(await store.list(anchor.docId)).toEqual([]);
    expect(await store.list("doc:Other")).toHaveLength(1);
  });

  it("persists a versioned namespace across instances; failures do not commit and the queue recovers", async () => {
    let bag: Record<string, unknown> = {};
    let failWrite = true;
    let failRead = false;
    const storage = {
      async get() {
        if (failRead) throw new Error("read failed");
        return JSON.parse(JSON.stringify(bag));
      },
      async set(next: Record<string, unknown>) {
        if (failWrite) throw new Error("quota exceeded");
        bag = JSON.parse(JSON.stringify(next));
      },
    };
    const store = createNotesStore(storage);
    await expect(store.save(anchor, "Draft")).rejects.toThrow("quota");
    expect(await store.list(anchor.docId)).toEqual([]);
    failWrite = false;
    await Promise.all([
      store.save(anchor, "Saved"),
      store.save({ ...anchor, blockIndex: 4 }, "Second"),
    ]);
    expect(bag.notes).toMatchObject({ version: 2 });
    expect(await createNotesStore(storage).list(anchor.docId)).toHaveLength(2);
    failWrite = true;
    await expect(store.delete(anchor)).rejects.toThrow("quota");
    expect(await store.list(anchor.docId)).toHaveLength(2);
    failRead = true;
    await expect(store.list(anchor.docId)).rejects.toThrow("read failed");
  });

  it("rejects unknown or corrupt versions without overwriting them, accepts additive v1 fields", async () => {
    for (const raw of [
      { version: 3, notes: [] },
      { version: 1, notes: [{}] },
    ]) {
      let writes = 0;
      const store = createNotesStore({
        async get() {
          return { notes: raw };
        },
        async set() {
          writes++;
        },
      });
      await expect(store.list(anchor.docId)).rejects.toThrow();
      await expect(store.save(anchor, "Draft")).rejects.toThrow();
      expect(writes).toBe(0);
    }
    const store = createNotesStore({
      async get() {
        return {
          notes: {
            version: 1,
            extra: true,
            notes: [{ ...anchor, text: "Older", extra: 1 }],
          },
        };
      },
      async set() {},
    });
    expect(await store.list(anchor.docId)).toEqual([
      { ...anchor, text: "Older" },
    ]);
  });
});

describe("v2 note identities and queued migration", () => {
  it("waits for an already-started queued write before listing", async () => {
    let bag: Record<string, unknown> = {};
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const store = createNotesStore({
      async get() {
        return structuredClone(bag);
      },
      async set(next) {
        started();
        await gate;
        bag = structuredClone(next);
      },
    });
    const saving = store.save(anchor, "pending");
    const reading = store.list(anchor.docId);
    await writing;
    release();
    await saving;
    expect(await reading).toEqual([{ ...anchor, text: "pending" }]);
  });

  it("keeps four types at one anchor across instances and deletes only one type", async () => {
    let bag: Record<string, unknown> = {};
    const storage = {
      async get() {
        return structuredClone(bag);
      },
      async set(next: Record<string, unknown>) {
        bag = structuredClone(next);
      },
    };
    const store = createNotesStore(storage);
    await Promise.all(
      NOTE_TYPES.map((type) => store.save({ ...anchor, type }, type))
    );
    expect(await store.list(anchor.docId)).toHaveLength(4);
    await store.save({ ...anchor, type: "feeling" }, "edited");
    await store.delete({ ...anchor, type: "idea" });
    for (const current of [store, createNotesStore(storage)]) {
      expect(
        (await current.list(anchor.docId)).map((note) => [note.type, note.text])
      ).toEqual([
        ["progress", "progress"],
        ["feeling", "edited"],
        ["question", "question"],
      ]);
    }
  });

  it("migrates all books only on successful queued mutation; failed writes retry without dropping a sibling book", async () => {
    const legacyAnchor = {
      docId: anchor.docId,
      chapterIndex: anchor.chapterIndex,
      blockIndex: anchor.blockIndex,
    };
    const legacy = {
      version: 1,
      notes: [
        { ...legacyAnchor, text: "legacy" },
        { ...legacyAnchor, docId: "doc:Other", text: "other legacy" },
      ],
    };
    let bag: Record<string, unknown> = { notes: structuredClone(legacy) };
    let fail = true;
    let writes = 0;
    const storage = {
      async get() {
        return structuredClone(bag);
      },
      async set(next: Record<string, unknown>) {
        writes++;
        if (fail) throw new Error("quota");
        bag = structuredClone(next);
      },
    };
    const store = createNotesStore(storage);
    expect(await store.list(anchor.docId)).toEqual([
      { ...anchor, text: "legacy" },
    ]);
    expect(await store.list(anchor.docId)).toHaveLength(1);
    expect(writes).toBe(0);
    await expect(
      store.save({ ...anchor, type: "idea" }, "draft")
    ).rejects.toThrow("quota");
    expect(bag["notes"]).toEqual(legacy);
    fail = false;
    await Promise.all([
      store.save({ ...anchor, type: "idea" }, "idea"),
      store.save({ ...anchor, docId: "doc:Other", type: "feeling" }, "feeling"),
    ]);
    expect(bag["notes"]).toMatchObject({ version: 2 });
    const reopened = createNotesStore(storage);
    expect(await reopened.list(anchor.docId)).toEqual([
      { ...anchor, text: "legacy" },
      { ...anchor, type: "idea", text: "idea" },
    ]);
    expect(await reopened.list("doc:Other")).toEqual([
      { ...anchor, docId: "doc:Other", text: "other legacy" },
      { ...anchor, docId: "doc:Other", type: "feeling", text: "feeling" },
    ]);
    const migrated = structuredClone(bag);
    await reopened.list(anchor.docId);
    expect(bag).toEqual(migrated);
    expect(writes).toBe(3);
  });

  it("rejects v2 missing/illegal types and duplicate identities on reads and mutations without changing storage", async () => {
    const untyped = {
      docId: anchor.docId,
      chapterIndex: anchor.chapterIndex,
      blockIndex: anchor.blockIndex,
    };
    for (const notes of [
      [{ ...untyped, text: "missing" }],
      [{ ...anchor, type: "constructor", text: "illegal" }],
      [{ ...anchor, type: null, text: "illegal" }],
      [
        { ...anchor, text: "one" },
        { ...anchor, text: "duplicate" },
      ],
    ]) {
      const original = { version: 2, notes };
      const storage = {
        async get() {
          return { notes: structuredClone(original) };
        },
        async set() {
          throw new Error("must not write");
        },
      };
      const store = createNotesStore(storage);
      await expect(store.list(anchor.docId)).rejects.toThrow("损坏");
      await expect(store.save(anchor, "overwrite")).rejects.toThrow("损坏");
      await expect(store.delete(anchor)).rejects.toThrow("损坏");
      expect(await storage.get()).toEqual({ notes: original });
    }
  });

  it("counts the 100-note quota across types and leaves other namespaces untouched", async () => {
    let bag: Record<string, unknown> = { unrelated: { keep: true } };
    let writes = 0;
    const storage = {
      async get() {
        return structuredClone(bag);
      },
      async set(next: Record<string, unknown>) {
        writes++;
        bag = { ...bag, ...structuredClone(next) };
      },
    };
    const store = createNotesStore(storage);
    await store.list(anchor.docId);
    await store.delete(anchor);
    expect(writes).toBe(0);
    for (let i = 0; i < 100; i++) {
      await store.save(
        { ...anchor, blockIndex: Math.floor(i / 4), type: NOTE_TYPES[i % 4]! },
        "saved"
      );
    }
    await expect(
      store.save({ ...anchor, blockIndex: 25, type: "question" }, "draft")
    ).rejects.toThrow("100");
    await store.save({ ...anchor, type: "feeling" }, "edit at capacity");
    expect(await store.list(anchor.docId)).toHaveLength(100);
    expect(bag.unrelated).toEqual({ keep: true });
  });
});
