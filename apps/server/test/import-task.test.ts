import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  createImportingBook,
  loadChapter,
  type BlockData,
} from "../src/book-store.js";
import { runImportTask } from "../src/import/import-task.js";
import type { PreparedBook } from "../src/import/pipeline.js";
import type { Translator } from "../src/translate/translator.js";
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

// One seeded import run both tests observe: the translator records the
// sentence texts it was handed, the store holds what the join wrote.
async function runJoinProbe(
  database: Database.Database,
  dictionary: ReturnType<typeof createFixtureDictionary>,
  translator: Translator
): Promise<number> {
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
  return bookId;
}

// The join's read shape: only sentence blocks carry a translation line.
const translationTexts = (blocks: BlockData[] | undefined): (string | null)[] =>
  (blocks ?? []).map((block) =>
    block.kind === "sentence" ? block.translationText : null
  );

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
    const bookId = await runJoinProbe(database, dictionary, translator);

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
    expect(translationTexts(mixed?.blocks)).toEqual([
      "译:Alpha begins here.",
      "译:Beta follows it.",
      null,
      null,
      "译:Gamma closes the chapter.",
    ]);

    expect(translationTexts(loadChapter(database, bookId, 2)?.blocks)).toEqual([
      "译:Delta stands alone.",
    ]);
  });

  it("hands the translator exactly the sentence texts in book order", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );
    await runJoinProbe(database, dictionary, translator);

    expect(translator.calls.flat()).toEqual([
      "Alpha begins here.",
      "Beta follows it.",
      "Gamma closes the chapter.",
      "Delta stands alone.",
    ]);
  });
});
