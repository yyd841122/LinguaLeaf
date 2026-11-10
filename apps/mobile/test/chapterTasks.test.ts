import { describe, expect, it, vi } from "vitest";
import {
  createChapterTaskRegistry,
  type ChapterTaskEvent,
} from "../src/translate/chapter-tasks";
import type { Translator } from "../src/translate/translator";
import {
  createMemoryTranslationStore,
  type TranslationStore,
} from "../src/store/translation-store";
import type { ExtChapter } from "../src/reader/import-book";
import { createFakeTranslator } from "./fixtures/translator";

// The chapter task registry (mobile-app ticket 04): the phone-side analog
// of the server's runChapterTranslationTask + fireTask envelope. The task
// is module-level (it outlives chapter switches and face remounts), the
// percent walks under the 99 ceiling (retry rounds recount slots — 100
// would be a lie until the body returns), the write-back goes through the
// held sentence-block references, and a chapter whose every sentence came
// back failed settles as failed so the reader gets a flag, not silence
// (server semantics settle translated with empty lines; the phone has no
// task list to read that state off — the flag IS the surface).

const chapter = (blocks: ExtChapter["blocks"]): ExtChapter => ({
  title: "One",
  level: 1,
  blocks,
});

const sentenceAt = (index: number): ExtChapter["blocks"][number] => ({
  kind: "sentence",
  text: `Sentence ${index}.`,
  ipaSlots: [],
});

const okTranslator = (): Translator & { calls: string[][] } =>
  createFakeTranslator((batch) => batch.map((s) => `译:${s}`));

function deferred(): {
  promise: Promise<(string | null)[]>;
  release: (value: (string | null)[]) => void;
} {
  let release!: (value: (string | null)[]) => void;
  const promise = new Promise<(string | null)[]>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("createChapterTaskRegistry", () => {
  it("writes translations back by the held block indices, not by sentence count", async () => {
    // Plain blocks interleave: sentence, raw, sentence, image, sentence —
    // the translations must land on block indices 0, 2 and 4.
    const translations = createMemoryTranslationStore();
    const registry = createChapterTaskRegistry();
    registry.start(
      { translator: okTranslator(), translations },
      "doc:A",
      0,
      chapter([
        sentenceAt(0),
        { kind: "raw", text: "—" },
        sentenceAt(1),
        { kind: "image", text: "pic" },
        sentenceAt(2),
      ])
    );
    await vi.waitFor(() => expect(registry.isRunning("doc:A", 0)).toBe(false));
    expect(await translations.getChapter("doc:A", 0)).toEqual({
      0: "译:Sentence 0.",
      2: "译:Sentence 1.",
      4: "译:Sentence 2.",
    });
  });

  it("reports progress percent per batch under the 99 ceiling, then settles translated", async () => {
    const registry = createChapterTaskRegistry();
    const events: ChapterTaskEvent[] = [];
    const sentences = Array.from({ length: 45 }, (_, i) => sentenceAt(i));
    registry.subscribe("doc:A", 0, (event) => events.push(event));
    registry.start(
      {
        translator: okTranslator(),
        translations: createMemoryTranslationStore(),
      },
      "doc:A",
      0,
      chapter(sentences)
    );
    await vi.waitFor(() =>
      expect(events.some((e) => e.kind === "settled")).toBe(true)
    );
    // 0 at start, then 20/45 → 44, 40/45 → 89, 45/45 → clamped 99 (100
    // only at settle).
    expect(events.filter((e) => e.kind === "progress")).toEqual([
      { kind: "progress", percent: 0 },
      { kind: "progress", percent: 44 },
      { kind: "progress", percent: 89 },
      { kind: "progress", percent: 99 },
    ]);
    expect(events.at(-1)).toEqual({ kind: "settled", outcome: "translated" });
    expect(registry.isRunning("doc:A", 0)).toBe(false);
  });

  it("settles failed and writes nothing when every sentence came back null", async () => {
    const translations = createMemoryTranslationStore();
    const registry = createChapterTaskRegistry();
    const events: ChapterTaskEvent[] = [];
    registry.subscribe("doc:A", 0, (event) => events.push(event));
    registry.start(
      {
        translator: createFakeTranslator(() => [null, null]),
        translations,
      },
      "doc:A",
      0,
      chapter([sentenceAt(0), sentenceAt(1)])
    );
    await vi.waitFor(() =>
      expect(events.at(-1)).toEqual({ kind: "settled", outcome: "failed" })
    );
    expect(await translations.getChapter("doc:A", 0)).toEqual({});
  });

  it("settles translated when at least one sentence landed, and retries filled the gaps", async () => {
    const translations = createMemoryTranslationStore();
    const registry = createChapterTaskRegistry();
    const events: ChapterTaskEvent[] = [];
    registry.subscribe("doc:A", 0, (event) => events.push(event));
    const translator = createFakeTranslator((batch) =>
      // Round 1: only the first sentence fails; round 2 re-requests it
      // alone and lands it. The retry rounds recount slots, so progress
      // pushes past earlier percents — the ceiling holds it at 99.
      translator.calls.length === 1
        ? batch.map((s) => (s === "Sentence 0." ? null : `译:${s}`))
        : batch.map((s) => `译:${s}`)
    );
    registry.start(
      { translator, translations },
      "doc:A",
      0,
      chapter([sentenceAt(0), sentenceAt(1)])
    );
    await vi.waitFor(() =>
      expect(events.at(-1)).toEqual({ kind: "settled", outcome: "translated" })
    );
    expect(translator.calls).toEqual([
      ["Sentence 0.", "Sentence 1."],
      ["Sentence 0."],
    ]);
    expect(await translations.getChapter("doc:A", 0)).toEqual({
      0: "译:Sentence 0.",
      1: "译:Sentence 1.",
    });
  });

  it("a heading-only chapter settles translated without calling the translator", async () => {
    const translator = okTranslator();
    const registry = createChapterTaskRegistry();
    const events: ChapterTaskEvent[] = [];
    registry.subscribe("doc:A", 0, (event) => events.push(event));
    registry.start(
      { translator, translations: createMemoryTranslationStore() },
      "doc:A",
      0,
      chapter([{ kind: "raw", text: "Chapter text" }])
    );
    await vi.waitFor(() =>
      expect(events.at(-1)).toEqual({ kind: "settled", outcome: "translated" })
    );
    expect(translator.calls).toEqual([]);
  });

  it("a second start on a running chapter is refused", async () => {
    const registry = createChapterTaskRegistry();
    const gate = deferred();
    const translator: Translator = {
      translateBatch: () => gate.promise,
    };
    registry.start(
      { translator, translations: createMemoryTranslationStore() },
      "doc:A",
      0,
      chapter([sentenceAt(0)])
    );
    expect(
      registry.start(
        {
          translator: okTranslator(),
          translations: createMemoryTranslationStore(),
        },
        "doc:A",
        0,
        chapter([sentenceAt(0)])
      )
    ).toBe(false);
    expect(registry.isRunning("doc:A", 0)).toBe(true);
    gate.release(["译:Only."]);
    await vi.waitFor(() => expect(registry.isRunning("doc:A", 0)).toBe(false));
    // After settle a fresh start goes through (the retry path).
    expect(
      registry.start(
        {
          translator: okTranslator(),
          translations: createMemoryTranslationStore(),
        },
        "doc:A",
        0,
        chapter([sentenceAt(0)])
      )
    ).toBe(true);
    await vi.waitFor(() => expect(registry.isRunning("doc:A", 0)).toBe(false));
  });

  it("subscribe replays the running percent immediately", async () => {
    const registry = createChapterTaskRegistry();
    const gate = deferred();
    registry.start(
      {
        translator: { translateBatch: () => gate.promise },
        translations: createMemoryTranslationStore(),
      },
      "doc:A",
      0,
      chapter(Array.from({ length: 10 }, (_, i) => sentenceAt(i)))
    );
    const events: ChapterTaskEvent[] = [];
    registry.subscribe("doc:A", 0, (event) => events.push(event));
    // No batch has settled yet, but the reader re-entering the chapter
    // mid-task must see the task, not a fresh 翻译 button.
    expect(events).toEqual([{ kind: "progress", percent: 0 }]);
    gate.release(Array.from({ length: 10 }, () => "译"));
    await vi.waitFor(() =>
      expect(events.at(-1)).toEqual({ kind: "settled", outcome: "translated" })
    );
  });

  it("an unexpected fault settles failed instead of rejecting past the start", async () => {
    // The Translator contract is total, so the fault the catch exists for
    // is the store write dying mid-task.
    const translations: TranslationStore = {
      getChapter: async () => ({}),
      saveTranslations: () => Promise.reject(new Error("disk gone")),
    };
    const registry = createChapterTaskRegistry();
    const events: ChapterTaskEvent[] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      registry.subscribe("doc:A", 0, (event) => events.push(event));
      expect(() =>
        registry.start(
          { translator: okTranslator(), translations },
          "doc:A",
          0,
          chapter([sentenceAt(0)])
        )
      ).not.toThrow();
      await vi.waitFor(() =>
        expect(events.at(-1)).toEqual({ kind: "settled", outcome: "failed" })
      );
      expect(registry.isRunning("doc:A", 0)).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("unsubscribe stops the events", async () => {
    const registry = createChapterTaskRegistry();
    const gate = deferred();
    registry.start(
      {
        translator: { translateBatch: () => gate.promise },
        translations: createMemoryTranslationStore(),
      },
      "doc:A",
      0,
      chapter([sentenceAt(0)])
    );
    const events: ChapterTaskEvent[] = [];
    const stop = registry.subscribe("doc:A", 0, (event) => events.push(event));
    stop();
    gate.release(["译"]);
    await vi.waitFor(() => expect(registry.isRunning("doc:A", 0)).toBe(false));
    // Only the replayed snapshot was seen; the settle landed after unsub.
    expect(events).toEqual([{ kind: "progress", percent: 0 }]);
  });
});
