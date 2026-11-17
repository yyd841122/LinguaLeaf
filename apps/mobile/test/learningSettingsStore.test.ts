import { describe, expect, it } from "vitest";
import {
  createLearningSettingsStore,
  createMemoryLearningSettingsStore,
  DEFAULT_LEARNING,
} from "../src/store/learning-settings-store";

// 逐书学习开关 (redesign 02, spec review finding 2 — a NEW ability:
// today the 音标 toggle is a page-global React state and 译文 an
// EpubReader-local one, neither survives a book switch). Default =
// the current global values (both on); each book remembers its own
// override; 换书/冷启/返回书架 read per book, writes persist at once.

const storage = () => {
  const bag: Record<string, unknown> = {};
  return {
    async get() {
      return structuredClone(bag);
    },
    async set(next: Record<string, unknown>) {
      Object.assign(bag, structuredClone(next));
    },
  };
};

const storedBag = (record: unknown) => {
  const bag: Record<string, unknown> = { "learning-settings": record };
  return {
    async get() {
      return structuredClone(bag);
    },
    async set(next: Record<string, unknown>) {
      Object.assign(bag, structuredClone(next));
    },
  };
};

describe("learning settings — per-book toggles", () => {
  it("defaults both toggles on (the current global values migrate as defaults)", async () => {
    const store = createLearningSettingsStore(storage());
    expect(DEFAULT_LEARNING).toEqual({ ipa: true, translation: true });
    expect(await store.load("doc:A")).toEqual(DEFAULT_LEARNING);
  });

  it("saves per book independently — one book's override never touches another", async () => {
    const store = createLearningSettingsStore(storage());
    await store.save("doc:A", { ipa: false });
    await store.save("doc:B", { translation: false });
    expect(await store.load("doc:A")).toEqual({
      ipa: false,
      translation: true,
    });
    expect(await store.load("doc:B")).toEqual({
      ipa: true,
      translation: false,
    });
    expect(await store.load("doc:C")).toEqual(DEFAULT_LEARNING);
  });

  it("persists the whole map and reads it back after a reopen", async () => {
    const bag = storedBag(undefined);
    const store = createLearningSettingsStore(bag);
    await store.save("doc:A", { ipa: false, translation: false });
    // A fresh store over the same storage (the cold-start posture).
    const reopened = createLearningSettingsStore(bag);
    expect(await reopened.load("doc:A")).toEqual({
      ipa: false,
      translation: false,
    });
  });

  it("degrades malformed records and unknown toggle values to the defaults", async () => {
    const store = createLearningSettingsStore(
      storedBag({ version: 99, books: { "doc:A": { ipa: "yes" } } })
    );
    expect(await store.load("doc:A")).toEqual(DEFAULT_LEARNING);
    const malformed = createLearningSettingsStore(storedBag("not a record"));
    expect(await malformed.load("doc:A")).toEqual(DEFAULT_LEARNING);
  });

  it("memory twin carries the same shapes", async () => {
    const store = createMemoryLearningSettingsStore();
    expect(await store.load("doc:A")).toEqual(DEFAULT_LEARNING);
    await store.save("doc:A", { translation: false });
    expect(await store.load("doc:A")).toEqual({
      ipa: true,
      translation: false,
    });
  });
});
