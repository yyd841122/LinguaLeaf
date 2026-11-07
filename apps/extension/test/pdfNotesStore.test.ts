import { NOTE_TYPES } from "../../server/src/wire";
import { describe, expect, it } from "vitest";
import {
  pdfFingerprint,
  PDF_DOC_ID_PREFIX,
} from "../src/store/pdf-fingerprint";
import { createPdfNotesStore } from "../src/store/pdf-notes-store";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const anchor = {
  type: "progress" as const,
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
      { version: 3, notes: [note] },
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
    const store = createPdfNotesStore({
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
    const store = createPdfNotesStore(storage);
    await Promise.all(
      NOTE_TYPES.map((type) => store.save({ ...anchor, type }, type))
    );
    expect(await store.list(anchor.docId)).toHaveLength(4);
    await store.save({ ...anchor, type: "feeling" }, "edited");
    await store.delete({ ...anchor, type: "idea" });
    for (const current of [store, createPdfNotesStore(storage)]) {
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
      page: anchor.page,
      lineIndex: anchor.lineIndex,
      lineText: anchor.lineText,
    };
    const legacy = {
      version: 1,
      notes: [
        { ...legacyAnchor, text: "legacy" },
        {
          ...legacyAnchor,
          docId:
            "pdf:sha256-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          text: "other legacy",
        },
      ],
    };
    let bag: Record<string, unknown> = { "pdf-notes": structuredClone(legacy) };
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
    const store = createPdfNotesStore(storage);
    expect(await store.list(anchor.docId)).toEqual([
      { ...anchor, text: "legacy" },
    ]);
    expect(await store.list(anchor.docId)).toHaveLength(1);
    expect(writes).toBe(0);
    await expect(
      store.save({ ...anchor, type: "idea" }, "draft")
    ).rejects.toThrow("quota");
    expect(bag["pdf-notes"]).toEqual(legacy);
    fail = false;
    await Promise.all([
      store.save({ ...anchor, type: "idea" }, "idea"),
      store.save(
        {
          ...anchor,
          docId:
            "pdf:sha256-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          type: "feeling",
        },
        "feeling"
      ),
    ]);
    expect(bag["pdf-notes"]).toMatchObject({ version: 2 });
    const reopened = createPdfNotesStore(storage);
    expect(await reopened.list(anchor.docId)).toEqual([
      { ...anchor, text: "legacy" },
      { ...anchor, type: "idea", text: "idea" },
    ]);
    expect(
      await reopened.list(
        "pdf:sha256-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      )
    ).toEqual([
      {
        ...anchor,
        docId:
          "pdf:sha256-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        text: "other legacy",
      },
      {
        ...anchor,
        docId:
          "pdf:sha256-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        type: "feeling",
        text: "feeling",
      },
    ]);
    const migrated = structuredClone(bag);
    await reopened.list(anchor.docId);
    expect(bag).toEqual(migrated);
    expect(writes).toBe(3);
  });

  it("rejects v2 missing/illegal types and duplicate identities on reads and mutations without changing storage", async () => {
    const untyped = {
      docId: anchor.docId,
      page: anchor.page,
      lineIndex: anchor.lineIndex,
      lineText: anchor.lineText,
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
          return { "pdf-notes": structuredClone(original) };
        },
        async set() {
          throw new Error("must not write");
        },
      };
      const store = createPdfNotesStore(storage);
      await expect(store.list(anchor.docId)).rejects.toThrow("损坏");
      await expect(store.save(anchor, "overwrite")).rejects.toThrow("损坏");
      await expect(store.delete(anchor)).rejects.toThrow("损坏");
      expect(await storage.get()).toEqual({ "pdf-notes": original });
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
    const store = createPdfNotesStore(storage);
    await store.list(anchor.docId);
    await store.delete(anchor);
    expect(writes).toBe(0);
    for (let i = 0; i < 100; i++) {
      await store.save(
        { ...anchor, lineIndex: Math.floor(i / 4), type: NOTE_TYPES[i % 4]! },
        "saved"
      );
    }
    await expect(
      store.save({ ...anchor, lineIndex: 25, type: "question" }, "draft")
    ).rejects.toThrow("100");
    await store.save({ ...anchor, type: "feeling" }, "edit at capacity");
    expect(await store.list(anchor.docId)).toHaveLength(100);
    expect(bag.unrelated).toEqual({ keep: true });
  });
});
