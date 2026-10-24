import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/database.js";
import {
  beginChapterTranslation,
  createImportingBook,
  findChapterRow,
  persistBook,
  type BlockRow,
} from "../../src/book-store.js";
import {
  CHAPTER_TRANSLATION_FAILURE_MESSAGE,
  runChapterTranslationTask,
} from "../../src/translate/chapter-task.js";
import { drainTasks } from "../../src/task-lifecycle.js";
import type { Translator } from "../../src/translate/translator.js";

// Direct chapter-task tests: no HTTP — the api suite pins the trigger
// route, the percent steps, and the 留空 semantics on the wire. These pin
// what only the task module can prove: the shutdown drain holds until the
// task settles (the import task's same envelope), and an unexpected fault
// settles the chapter failed instead of rejecting past the router's void.

const sentence = (text: string): BlockRow => ({
  kind: "sentence",
  text,
  ipaSlots: null,
  ipaText: null,
  translation: null,
});

describe("runChapterTranslationTask (direct)", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  // One claimed chapter — the claim is the route's half of the handshake,
  // and every task write is guarded on it.
  function claimedChapter(): { bookId: number; chapterId: number } {
    const bookId = createImportingBook(database, "A Title", "markdown", null);
    persistBook(database, bookId, [
      { title: "One", level: 1, blocks: [sentence("First.")] },
    ]);
    const chapterId = findChapterRow(database, bookId, 1)!.id;
    beginChapterTranslation(database, chapterId);
    return { bookId, chapterId };
  }

  it("drainTasks resolves only after the in-flight task settles", async () => {
    let release!: (value: (string | null)[]) => void;
    const translator: Translator = {
      translateBatch: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const { chapterId } = claimedChapter();
    const task = runChapterTranslationTask({ database, translator }, chapterId);

    let drained = false;
    const draining = drainTasks(10_000).then(() => {
      drained = true;
    });
    await Promise.resolve();
    // Still in flight: the drain holds (its grace deadline is far away).
    expect(drained).toBe(false);

    release(["译:First."]);
    await task;
    await draining;
    expect(drained).toBe(true);
  });

  it("an unexpected fault settles the chapter failed instead of rejecting", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      // The Translator contract is total, so a throwing one is the
      // unreachable-in-practice fault the catch exists for.
      const translator: Translator = {
        translateBatch: () => Promise.reject(new Error("boom")),
      };
      const { bookId, chapterId } = claimedChapter();

      await expect(
        runChapterTranslationTask({ database, translator }, chapterId)
      ).resolves.toBeUndefined();
      expect(findChapterRow(database, bookId, 1)).toMatchObject({
        translation_status: "failed",
        translation_error: CHAPTER_TRANSLATION_FAILURE_MESSAGE,
        translation_percent: null,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
