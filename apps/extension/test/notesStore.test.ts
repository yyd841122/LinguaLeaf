import { describe, expect, it } from "vitest";
import {
  createMemoryNotesStore,
  createNotesStore,
} from "../src/store/notes-store";

const anchor = { docId: "doc:One", chapterIndex: 0, blockIndex: 2 };

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
    expect(bag.notes).toMatchObject({ version: 1 });
    expect(await createNotesStore(storage).list(anchor.docId)).toHaveLength(2);
    failWrite = true;
    await expect(store.delete(anchor)).rejects.toThrow("quota");
    expect(await store.list(anchor.docId)).toHaveLength(2);
    failRead = true;
    await expect(store.list(anchor.docId)).rejects.toThrow("read failed");
  });

  it("rejects unknown or corrupt versions without overwriting them, accepts additive v1 fields", async () => {
    for (const raw of [
      { version: 2, notes: [] },
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
