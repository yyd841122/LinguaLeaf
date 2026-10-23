import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  createImportingBook,
  findBookRow,
  loadChapter,
} from "../src/book-store.js";
import { runImportTask } from "../src/import/import-task.js";
import type { PreparedBook } from "../src/import/pipeline.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { createFakeTranslator } from "./fixtures/translator.js";

// Direct import-task tests: no HTTP, no polling — the task's promise is
// the whole wait. The api suite pins translation at the wire (progress,
// failed sentences, the shelf); these pin what only the join itself can
// see: translations landing on sentence blocks in a chapter where
// sentences and non-sentence blocks interleave (.scratch/translation-join/).

const joinProbeBook: PreparedBook = {
  title: "Join Probe",
  format: "markdown",
  chapters: [
    {
      title: "Mixed",
      level: 2,
      items: [
        { kind: "paragraph", text: "Alpha begins here. Beta follows it." },
        { kind: "image", text: "A map of the islands" },
        { kind: "code", text: "npm test" },
        { kind: "paragraph", text: "Gamma closes the chapter." },
      ],
    },
    {
      title: "Single",
      level: 2,
      items: [{ kind: "paragraph", text: "Delta stands alone." }],
    },
  ],
};

describe("runImportTask (the translation join, direct)", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof createFixtureDictionary>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
  });

  afterEach(() => {
    database.close();
    dictionary.close();
  });

  it("lands translations on sentence blocks by order, not by raw block index", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );
    const bookId = createImportingBook(
      database,
      joinProbeBook.title,
      joinProbeBook.format,
      null
    );

    await runImportTask(
      { database, dictionary, translator },
      bookId,
      joinProbeBook
    );

    const mixed = loadChapter(database, bookId, 1);
    expect(
      mixed?.blocks.map((block) => [block.kind, block.originalText])
    ).toEqual([
      ["sentence", "Alpha begins here."],
      ["sentence", "Beta follows it."],
      ["image", "A map of the islands"],
      ["code", "npm test"],
      ["sentence", "Gamma closes the chapter."],
    ]);
    // A raw-index join would put 译:Alpha on the image; the sentence-order
    // join leaves the interleaved non-sentence blocks null instead.
    expect(
      mixed?.blocks.map((block) =>
        block.kind === "sentence" ? block.translationText : null
      )
    ).toEqual([
      "译:Alpha begins here.",
      "译:Beta follows it.",
      null,
      null,
      "译:Gamma closes the chapter.",
    ]);

    expect(
      loadChapter(database, bookId, 2)?.blocks.map((block) =>
        block.kind === "sentence" ? block.translationText : null
      )
    ).toEqual(["译:Delta stands alone."]);

    expect(findBookRow(database, bookId)?.status).toBe("ready");
  });

  it("hands the translator exactly the sentence texts in book order", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );
    const bookId = createImportingBook(
      database,
      joinProbeBook.title,
      joinProbeBook.format,
      null
    );

    await runImportTask(
      { database, dictionary, translator },
      bookId,
      joinProbeBook
    );

    expect(translator.calls.flat()).toEqual([
      "Alpha begins here.",
      "Beta follows it.",
      "Gamma closes the chapter.",
      "Delta stands alone.",
    ]);
  });
});
