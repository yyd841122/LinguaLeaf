import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  createImportingBook,
  findBookRow,
  loadChapter,
  type BlockData,
} from "../src/book-store.js";
import { runImportTask } from "../src/import/import-task.js";
import { drainTasks } from "../src/task-lifecycle.js";
import type { PreparedBook } from "../src/import/pipeline.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";

// Direct import-task tests: no HTTP, no polling — the task's promise is
// the whole wait. Since on-demand-translation (ticket 02) the task holds
// no network stage; these pin what only the task level can see: blocks
// landing in reading order with IPA filled and every translation NULL for
// the chapter route to fill on demand, and the tracker drain shutdown
// leans on.

const probeBook: PreparedBook = {
  title: "Probe Book",
  format: "markdown",
  chapters: [
    {
      title: "Mixed",
      level: 2,
      items: [
        { kind: "paragraph", text: "He wrote a book. Beta follows it." },
        { kind: "image", text: "A map of the islands" },
        { kind: "code", text: "npm test" },
      ],
    },
    {
      title: "Single",
      level: 2,
      items: [{ kind: "paragraph", text: "Delta stands alone." }],
    },
  ],
};

// The translation column read straight from storage, so the NULL claim is
// about the persisted rows, not a derived view of them.
const storedTranslations = (database: Database.Database): (string | null)[] =>
  (
    database
      .prepare("SELECT translation_text AS translationText FROM blocks")
      .all() as { translationText: string | null }[]
  ).map((row) => row.translationText);

// The sentence blocks' translation lines in reading order; non-sentence
// kinds do not carry one.
const translationLines = (blocks: BlockData[] | undefined): (string | null)[] =>
  (blocks ?? []).map((block) =>
    block.kind === "sentence" ? block.translationText : null
  );

describe("runImportTask (direct)", () => {
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

  it("lands blocks in reading order with IPA filled and translations NULL", async () => {
    const bookId = createImportingBook(
      database,
      probeBook.title,
      probeBook.format,
      null
    );
    await runImportTask({ database, dictionary }, bookId, probeBook);

    const mixed = loadChapter(database, bookId, 1);
    expect(
      mixed?.blocks.map((block) => [block.kind, block.originalText])
    ).toEqual([
      ["sentence", "He wrote a book."],
      ["sentence", "Beta follows it."],
      ["image", "A map of the islands"],
      ["code", "npm test"],
    ]);
    // IPA lands as before (the fixture dictionary knows he/wrote/a/book);
    // the unknown sentence's slots stay blank, not absent.
    expect(
      mixed?.blocks.map((block) =>
        block.kind === "sentence" ? block.ipaText : null
      )
    ).toEqual(["hi roʊt ə bʊk", "", null, null]);
    expect(translationLines(mixed?.blocks)).toEqual([null, null, null, null]);
    expect(mixed).toMatchObject({ translationStatus: "untranslated" });

    expect(translationLines(loadChapter(database, bookId, 2)?.blocks)).toEqual([
      null,
    ]);
    // The NULL is the stored reality across every block row.
    expect(storedTranslations(database)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("routes through the task tracker: the shutdown drain settles with the import", async () => {
    const bookId = createImportingBook(
      database,
      probeBook.title,
      probeBook.format,
      null
    );
    await runImportTask({ database, dictionary }, bookId, probeBook);
    // The task body no longer awaits anything (the network stage left in
    // ticket 02), but it still runs through the tracker — the shutdown
    // drain stays honest with the now-instant task. chapter-task.test.ts
    // pins the holding half of the same drain with a task that can still
    // be held mid-flight.
    await drainTasks(0);
    expect(findBookRow(database, bookId)).toMatchObject({
      status: "ready",
      import_stage: null,
      import_percent: null,
      import_error: null,
    });
  });
});
