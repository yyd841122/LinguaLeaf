import { describe, expect, it } from "vitest";
import {
  createMemoryTranslationStore,
  createTranslationStore,
} from "../src/store/translation-store";

// The translation store holds settled translations outside the fingerprinted
// book shape: re-importing the same EPUB (translations absent from the
// file) must never read as a content change, and a re-save of the book must
// never drop what was translated. keyed docId → chapterIndex → blockIndex
// (block indices count ALL blocks, sentence and plain alike).

describe("TranslationStore — memory twin", () => {
  it("reads an empty chapter as no translations", async () => {
    const store = createMemoryTranslationStore();
    expect(await store.getChapter("doc:A", 0)).toEqual({});
  });

  it("saves translations and reads them back by block index", async () => {
    const store = createMemoryTranslationStore();
    await store.saveTranslations("doc:A", 0, [
      { blockIndex: 0, translation: "第一句。" },
      { blockIndex: 2, translation: "第三句。" },
    ]);
    expect(await store.getChapter("doc:A", 0)).toEqual({
      0: "第一句。",
      2: "第三句。",
    });
  });

  it("merges a patch into an existing chapter instead of replacing it", async () => {
    const store = createMemoryTranslationStore();
    await store.saveTranslations("doc:A", 0, [
      { blockIndex: 0, translation: "第一句。" },
    ]);
    await store.saveTranslations("doc:A", 0, [
      { blockIndex: 2, translation: "第三句。" },
    ]);
    expect(await store.getChapter("doc:A", 0)).toEqual({
      0: "第一句。",
      2: "第三句。",
    });
  });

  it("keeps documents and chapters from bleeding into each other", async () => {
    const store = createMemoryTranslationStore();
    await store.saveTranslations("doc:A", 0, [
      { blockIndex: 0, translation: "A0。" },
    ]);
    await store.saveTranslations("doc:A", 1, [
      { blockIndex: 0, translation: "A1。" },
    ]);
    await store.saveTranslations("doc:B", 0, [
      { blockIndex: 0, translation: "B0。" },
    ]);
    expect(await store.getChapter("doc:A", 0)).toEqual({ 0: "A0。" });
    expect(await store.getChapter("doc:A", 1)).toEqual({ 0: "A1。" });
    expect(await store.getChapter("doc:B", 0)).toEqual({ 0: "B0。" });
    expect(await store.getChapter("doc:B", 1)).toEqual({});
  });

  it("survives a backend that hands back cloned records", async () => {
    // The IndexedDB backend clones on read (structured clone) — the store
    // must own its records, not borrow identities the clone broke.
    const backing = new Map<string, unknown>();
    const store = createTranslationStore({
      async get(namespace) {
        const snapshot = structuredClone(backing.get(namespace));
        return snapshot === undefined ? {} : { [namespace]: snapshot };
      },
      async set(bag) {
        for (const [key, value] of Object.entries(bag))
          backing.set(key, structuredClone(value));
      },
    });
    await store.saveTranslations("doc:A", 0, [
      { blockIndex: 1, translation: "存进去的。" },
    ]);
    await store.saveTranslations("doc:A", 0, [
      { blockIndex: 3, translation: "补进去的。" },
    ]);
    expect(await store.getChapter("doc:A", 0)).toEqual({
      1: "存进去的。",
      3: "补进去的。",
    });
  });
});

describe("TranslationStore — record backend write serialization", () => {
  it("serializes overlapping chapter writes so both patches land", async () => {
    let stored: unknown = undefined;
    const lag = <T>(value: T): Promise<T> =>
      new Promise((resolve) => setTimeout(() => resolve(value), 0));
    const store = createTranslationStore({
      async get(namespace) {
        const snapshot =
          stored === undefined ? undefined : JSON.parse(JSON.stringify(stored));
        return lag({ [namespace]: snapshot });
      },
      async set(bag) {
        const [, record] = Object.entries(bag)[0]!;
        stored = JSON.parse(JSON.stringify(record));
      },
    });
    // Two chapter tasks settling at once: each patch must survive the other.
    await Promise.all([
      store.saveTranslations("doc:a", 0, [
        { blockIndex: 0, translation: "第十章。" },
      ]),
      store.saveTranslations("doc:a", 1, [
        { blockIndex: 4, translation: "第十一章。" },
      ]),
    ]);
    expect(await store.getChapter("doc:a", 0)).toEqual({ 0: "第十章。" });
    expect(await store.getChapter("doc:a", 1)).toEqual({ 4: "第十一章。" });
  });
});
