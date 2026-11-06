import { describe, expect, it } from "vitest";
import {
  pdfFingerprint,
  PDF_DOC_ID_PREFIX,
} from "../src/store/pdf-fingerprint";
import { createPdfNotesStore } from "../src/store/pdf-notes-store";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const anchor = {
  docId: `${PDF_DOC_ID_PREFIX}${"a".repeat(64)}`,
  page: 1,
  lineIndex: 0,
  lineText: "First line.",
};
function backend(initial: Record<string, unknown> = {}) {
  const bag = structuredClone(initial);
  return {
    bag,
    async get() {
      return structuredClone(bag);
    },
    async set(next: Record<string, unknown>) {
      Object.assign(bag, structuredClone(next));
    },
  };
}

describe("PDF identity and notes decision table", () => {
  it("hashes the entire file: identical heads and different tails never share notes", async () => {
    const head = "%PDF-1.7\n" + "same first three pages".repeat(100);
    const a = await pdfFingerprint(bytes(head + "tail A"));
    const b = await pdfFingerprint(bytes(head + "tail B"));
    expect(a).toMatch(/^pdf:sha256-v1:[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(await pdfFingerprint(bytes(head + "tail A"))).toBe(a);
    const storage = backend();
    const store = createPdfNotesStore(storage);
    expect(await store.list(a)).toEqual([]);
    expect(storage.bag).toEqual({});
    const note = await store.save({ ...anchor, docId: a }, "A note");
    expect(await store.list(b)).toEqual([]);
    expect(await store.list(a)).toEqual([note]);
    await store.save({ ...anchor, docId: b }, "B note");
    expect(await store.list(a)).toEqual([note]);
  });

  it("reads after an already-started save settles and never creates an empty record on a missing delete", async () => {
    const storage = backend();
    const store = createPdfNotesStore(storage);
    await store.delete(anchor);
    expect(storage.bag).toEqual({});
    const saving = store.save(anchor, "pending");
    const reading = store.list(anchor.docId);
    await saving;
    expect(await reading).toEqual([{ ...anchor, text: "pending" }]);
  });

  it("updates and deletes only the exact page/line and serializes overlapping writes", async () => {
    const store = createPdfNotesStore(backend());
    await Promise.all([
      store.save(anchor, "one"),
      store.save({ ...anchor, page: 2 }, "two"),
    ]);
    await store.save(anchor, "updated");
    expect(await store.list(anchor.docId)).toHaveLength(2);
    await store.delete(anchor);
    expect(await store.list(anchor.docId)).toEqual([
      { ...anchor, page: 2, text: "two" },
    ]);
  });

  it("enforces 10,000/100, allows editing at capacity, and preserves data on failures", async () => {
    const store = createPdfNotesStore(backend());
    await expect(store.save(anchor, " ")).rejects.toThrow();
    await expect(store.save({ ...anchor, page: 0 }, "bad")).rejects.toThrow();
    await store.save(anchor, "x".repeat(10_000));
    await expect(store.save(anchor, "x".repeat(10_001))).rejects.toThrow(
      "10,000"
    );
    for (let lineIndex = 1; lineIndex < 100; lineIndex++)
      await store.save({ ...anchor, lineIndex }, "saved");
    await expect(
      store.save({ ...anchor, lineIndex: 100 }, "extra")
    ).rejects.toThrow("100");
    await store.save(anchor, "edit");
    expect(await store.list(anchor.docId)).toHaveLength(100);
  });

  it("accepts additive v1 fields but refuses unknown versions, malformed anchors and duplicate notes", async () => {
    const note = { ...anchor, text: "kept", extra: true };
    const storage = backend({
      "pdf-notes": { version: 1, notes: [note], extra: true },
    });
    expect(await createPdfNotesStore(storage).list(anchor.docId)).toEqual([
      { ...anchor, text: "kept" },
    ]);
    for (const record of [
      { version: 2, notes: [note] },
      { version: 1, notes: [{ ...note, page: 0 }] },
      { version: 1, notes: [{ ...note, lineText: null }] },
      { version: 1, notes: [note, note] },
    ]) {
      const bad = backend({ "pdf-notes": record });
      const store = createPdfNotesStore(bad);
      await expect(store.list(anchor.docId)).rejects.toThrow();
      await expect(store.save(anchor, "overwrite")).rejects.toThrow();
      expect(bad.bag["pdf-notes"]).toEqual(record);
    }
    const failing = createPdfNotesStore({
      async get() {
        throw new Error("read");
      },
      async set() {
        throw new Error("must not write");
      },
    });
    await expect(failing.list(anchor.docId)).rejects.toThrow("read");
  });
});
