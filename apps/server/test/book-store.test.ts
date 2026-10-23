import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  INTERRUPTED_MESSAGE,
  beginChapterTranslation,
  createImportingBook,
  deleteBook,
  failInterruptedImports,
  findBookRow,
  findChapterRow,
  getProgress,
  listChapters,
  listSentenceBlocks,
  listShelf,
  loadChapter,
  loadWholeBook,
  persistBook,
  saveProgress,
  saveSentenceTranslations,
  setChapterTranslationProgress,
  setImportProgress,
  settleChapterTranslation,
  settleImport,
  type BlockRow,
} from "../src/book-store.js";

// Direct store tests: no HTTP, no fetch — the four book tables' SQL is the
// whole surface here. The wire shapes stay pinned by the api and contract
// suites; these pin what those cannot see: transaction rollback, the
// resurrection guards, the startup sweep, and the ipa_slots codec.

const sentence = (
  text: string,
  ipaSlots: string[] | null = null,
  translation: string | null = null
): BlockRow => ({
  kind: "sentence",
  text,
  ipaSlots,
  ipaText: ipaSlots === null ? null : ipaSlots.join(" ").trim(),
  translation,
});

const raw = (text: string): BlockRow => ({
  kind: "raw",
  text,
  ipaSlots: null,
  ipaText: null,
  translation: null,
});

describe("book-store", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("createImportingBook plants an importing row that findBookRow reads back", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    expect(findBookRow(database, id)).toEqual({
      id,
      title: "A Title",
      format: "markdown",
      created_at: expect.any(String),
      status: "importing",
      import_stage: "annotating",
      import_percent: null,
      import_error: null,
      page_count: null,
    });
    // pageCount is a PDF fact that lands with the row (the shelf's
    // long-book hint rides on it for the whole import).
    const pdf = createImportingBook(database, "Long", "pdf", 320);
    expect(findBookRow(database, pdf)?.page_count).toBe(320);
  });

  it("persistBook writes chapters and blocks; the readers decode them back", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    expect(
      persistBook(database, id, [
        {
          title: "One",
          level: 1,
          blocks: [
            sentence("A word.", ["/wɜːd/"]),
            raw("<p>x</p>"),
            sentence("Two words.", null, "译文"),
          ],
        },
        { title: "Two", level: null, blocks: [] },
      ])
    ).toBe(true);

    // Sentence blocks decode to the three annotation lines with their
    // slots as an array; other kinds carry only their text.
    expect(loadChapter(database, id, 1)).toEqual({
      position: 1,
      title: "One",
      level: 1,
      translationStatus: "translated",
      translationPercent: null,
      translationError: null,
      blocks: [
        {
          position: 1,
          kind: "sentence",
          originalText: "A word.",
          ipaSlots: ["/wɜːd/"],
          ipaText: "/wɜːd/",
          translationText: null,
        },
        { position: 2, kind: "raw", originalText: "<p>x</p>" },
        {
          position: 3,
          kind: "sentence",
          originalText: "Two words.",
          ipaSlots: null,
          ipaText: null,
          translationText: "译文",
        },
      ],
    });
    // A chapter with no blocks still loads (its blocks array is empty),
    // and a position past the book is undefined.
    expect(loadChapter(database, id, 2)).toEqual({
      position: 2,
      title: "Two",
      level: null,
      translationStatus: "untranslated",
      translationPercent: null,
      translationError: null,
      blocks: [],
    });
    expect(loadChapter(database, id, 3)).toBeUndefined();

    const whole = loadWholeBook(database, id);
    expect(whole.map((c) => c.title)).toEqual(["One", "Two"]);
    // The LEFT JOIN's null side: a heading-only chapter survives the joined
    // read with an empty blocks array, not as a dropped row — a different
    // code path from loadChapter's two SELECTs asserted above.
    expect(whole[1]).toEqual({
      position: 2,
      title: "Two",
      level: null,
      translationStatus: "untranslated",
      translationPercent: null,
      translationError: null,
      blocks: [],
    });

    expect(listChapters(database, id)).toEqual([
      { position: 1, title: "One", level: 1 },
      { position: 2, title: "Two", level: null },
    ]);
  });

  it("persistBook is all-or-nothing: a failing insert rolls the whole call back", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    // A pre-existing chapter collides with the call's SECOND insert
    // (chapters are UNIQUE per book + position), so the first chapter and
    // its block are already written when the failure lands — and must not
    // survive the rollback.
    database
      .prepare(
        "INSERT INTO chapters (book_id, position, title, level) VALUES (?, 2, 'Pre-existing', NULL)"
      )
      .run(id);
    expect(() =>
      persistBook(database, id, [
        { title: "One", level: null, blocks: [sentence("A word.")] },
        { title: "Two", level: null, blocks: [] },
      ])
    ).toThrow();
    expect(database.prepare("SELECT title FROM chapters").all()).toEqual([
      { title: "Pre-existing" },
    ]);
    expect(database.prepare("SELECT * FROM blocks").all()).toEqual([]);
  });

  it("writes never resurrect a deleted book, and progress stops at a settled one", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    deleteBook(database, id);
    // Every import write no-ops against a deleted book: persist false, the
    // progress and settle updates quiet.
    expect(
      persistBook(database, id, [{ title: "One", level: null, blocks: [] }])
    ).toBe(false);
    expect(() =>
      setImportProgress(database, id, "translating", 40)
    ).not.toThrow();
    expect(() => settleImport(database, id, "ready", null)).not.toThrow();
    expect(findBookRow(database, id)).toBeUndefined();
    expect(database.prepare("SELECT * FROM blocks").all()).toEqual([]);

    // A settled book is past progress writes: a late task tick must not
    // overwrite the shelf's settled state.
    const ready = createImportingBook(database, "Settled", "markdown", null);
    persistBook(database, ready, [{ title: "One", level: null, blocks: [] }]);
    settleImport(database, ready, "ready", null);
    setImportProgress(database, ready, "translating", 40);
    const row = findBookRow(database, ready);
    expect(row?.status).toBe("ready");
    expect(row?.import_stage).toBeNull();
    expect(row?.import_percent).toBeNull();
  });

  it("persistBook's guard is existence-only: content lands under a settled book too", () => {
    // Deliberately pinned, not endorsed: the import task persists between
    // creating and settling a book, so the settled path is unreachable
    // today. If the guard ever tightens to `AND status = 'importing'` (the
    // other import writes' invariant), this is the test that flips — a
    // conscious act, not a drift.
    const id = createImportingBook(database, "A Title", "markdown", null);
    settleImport(database, id, "failed", "boom");
    expect(
      persistBook(database, id, [{ title: "One", level: null, blocks: [] }])
    ).toBe(true);
    expect(loadChapter(database, id, 1)?.title).toBe("One");
  });

  it("settleImport clears the live progress columns and records the failure", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    setImportProgress(database, id, "translating", 40);
    settleImport(database, id, "failed", INTERRUPTED_MESSAGE);
    expect(findBookRow(database, id)).toMatchObject({
      status: "failed",
      import_stage: null,
      import_percent: null,
      import_error: INTERRUPTED_MESSAGE,
    });
    // The guard: a second settle cannot overwrite the first verdict.
    settleImport(database, id, "ready", null);
    expect(findBookRow(database, id)?.status).toBe("failed");
  });

  it("failInterruptedImports sweeps every importing row and leaves settled rows alone", () => {
    const first = createImportingBook(database, "First", "markdown", null);
    const finished = createImportingBook(
      database,
      "Finished",
      "markdown",
      null
    );
    settleImport(database, finished, "ready", null);
    const second = createImportingBook(database, "Second", "epub", null);
    setImportProgress(database, second, "translating", 10);

    expect(failInterruptedImports(database)).toBe(2);
    // A second sweep finds nothing left to settle.
    expect(failInterruptedImports(database)).toBe(0);
    expect(findBookRow(database, first)).toMatchObject({
      status: "failed",
      import_stage: null,
      import_percent: null,
      import_error: INTERRUPTED_MESSAGE,
    });
    expect(findBookRow(database, second)).toMatchObject({
      status: "failed",
      import_stage: null,
      import_percent: null,
      import_error: INTERRUPTED_MESSAGE,
    });
    expect(findBookRow(database, finished)?.status).toBe("ready");
  });

  it("a corrupt ipa_slots row fails loudly at the read", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    persistBook(database, id, [
      { title: "One", level: null, blocks: [sentence("A word.", ["/wɜːd/"])] },
    ]);
    database.prepare("UPDATE blocks SET ipa_slots = 'not json'").run();
    expect(() => loadChapter(database, id, 1)).toThrow();
    expect(() => loadWholeBook(database, id)).toThrow();
    // Valid JSON that is not an array is corrupt too: the codec promises
    // an array of transcriptions, not anything JSON.parse accepts.
    database.prepare("UPDATE blocks SET ipa_slots = '5'").run();
    expect(() => loadWholeBook(database, id)).toThrow();
  });

  it("the progress row round-trips, upserts, and cascades away with the book", () => {
    const id = createImportingBook(database, "A Title", "markdown", null);
    expect(getProgress(database, id)).toBeUndefined();
    saveProgress(database, id, 2, 5);
    expect(getProgress(database, id)).toEqual({ chapter: 2, block: 5 });
    saveProgress(database, id, 3, 1);
    expect(getProgress(database, id)).toEqual({ chapter: 3, block: 1 });
    deleteBook(database, id);
    expect(database.prepare("SELECT * FROM reading_progress").all()).toEqual(
      []
    );
  });

  it("listShelf joins the last reading position, null before the first session", () => {
    const first = createImportingBook(database, "First", "markdown", null);
    const second = createImportingBook(database, "Second", "epub", null);
    saveProgress(database, second, 2, 5);
    expect(listShelf(database)).toEqual([
      expect.objectContaining({
        id: first,
        title: "First",
        progress_chapter: null,
        progress_block: null,
      }),
      expect.objectContaining({
        id: second,
        title: "Second",
        progress_chapter: 2,
        progress_block: 5,
      }),
    ]);
  });
});

// The on-demand translation state machine (on-demand-translation ticket 01,
// ADR-0004): each chapter carries its own translating lifecycle, mirroring
// the books.import_* pattern one level down. The route and task tests pin
// the HTTP shape; these pin what only the store can prove — the atomic
// claim, the guards that keep late task ticks from resurrecting a settled
// or deleted chapter, and the reference-held translation write-back.
describe("chapter translation state machine", () => {
  let database: Database.Database;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  // One book: chapter 1 holds sentences, chapter 2 is heading-only.
  function bookWithChapters(): number {
    const id = createImportingBook(database, "A Title", "markdown", null);
    persistBook(database, id, [
      {
        title: "One",
        level: 1,
        blocks: [sentence("First."), raw("<p>x</p>"), sentence("Second.")],
      },
      { title: "Two", level: null, blocks: [] },
    ]);
    return id;
  }

  it("persistBook derives each chapter's initial status from its blocks", () => {
    const id = bookWithChapters();
    // The derivation mirrors the migration's block-presence rule (spec
    // decision 5): sentence blocks mean the import translation ran.
    expect(loadChapter(database, id, 1)?.translationStatus).toBe("translated");
    expect(loadChapter(database, id, 2)?.translationStatus).toBe(
      "untranslated"
    );
  });

  it("findChapterRow reads the chapter head with its translation state", () => {
    const id = bookWithChapters();
    const row = findChapterRow(database, id, 1);
    expect(row).toEqual({
      id: expect.any(Number),
      position: 1,
      title: "One",
      level: 1,
      translation_status: "translated",
      translation_error: null,
      translation_percent: null,
    });
    expect(findChapterRow(database, id, 3)).toBeUndefined();
  });

  it("beginChapterTranslation claims a chapter atomically and re-arms a failed one", () => {
    const id = bookWithChapters();
    const chapter = findChapterRow(database, id, 2)!;
    expect(beginChapterTranslation(database, chapter.id)).toBe(true);
    expect(findChapterRow(database, id, 2)).toMatchObject({
      translation_status: "translating",
      translation_percent: 0,
      translation_error: null,
    });
    // The claim is the 409's other half: a second trigger cannot begin.
    expect(beginChapterTranslation(database, chapter.id)).toBe(false);
    // A chapter id that is not there cannot begin either.
    expect(beginChapterTranslation(database, chapter.id + 999)).toBe(false);

    // A failed chapter may try again — the claim bars only 'translating'.
    settleChapterTranslation(database, chapter.id, "failed", "boom");
    expect(beginChapterTranslation(database, chapter.id)).toBe(true);
  });

  it("setChapterTranslationProgress writes only while translating", () => {
    const id = bookWithChapters();
    const chapter = findChapterRow(database, id, 2)!;
    beginChapterTranslation(database, chapter.id);
    setChapterTranslationProgress(database, chapter.id, 40);
    expect(findChapterRow(database, id, 2)?.translation_percent).toBe(40);

    // A settled chapter is past progress: a late tick must not put a
    // percent back on it (mirrors the import writes' settled guard).
    settleChapterTranslation(database, chapter.id, "translated", null);
    setChapterTranslationProgress(database, chapter.id, 90);
    expect(findChapterRow(database, id, 2)?.translation_percent).toBeNull();

    // A deleted chapter is never resurrected by a late tick.
    const doomed = findChapterRow(database, id, 1)!;
    beginChapterTranslation(database, doomed.id);
    deleteBook(database, id);
    expect(() =>
      setChapterTranslationProgress(database, doomed.id, 10)
    ).not.toThrow();
    expect(findChapterRow(database, id, 1)).toBeUndefined();
  });

  it("settleChapterTranslation records the verdict once and clears the percent", () => {
    const id = bookWithChapters();
    const chapter = findChapterRow(database, id, 2)!;
    beginChapterTranslation(database, chapter.id);
    setChapterTranslationProgress(database, chapter.id, 40);
    settleChapterTranslation(database, chapter.id, "translated", null);
    expect(findChapterRow(database, id, 2)).toMatchObject({
      translation_status: "translated",
      translation_percent: null,
      translation_error: null,
    });
    // The guard: a second settle cannot overwrite the first verdict (a
    // late failure tick must not mark a finished chapter failed).
    settleChapterTranslation(database, chapter.id, "failed", "late boom");
    expect(findChapterRow(database, id, 2)?.translation_status).toBe(
      "translated"
    );

    // The failure verdict carries its reason.
    const other = findChapterRow(database, id, 1)!;
    beginChapterTranslation(database, other.id);
    settleChapterTranslation(database, other.id, "failed", "翻译出错");
    expect(findChapterRow(database, id, 1)).toMatchObject({
      translation_status: "failed",
      translation_error: "翻译出错",
    });
  });

  it("listSentenceBlocks holds the sentence-block references, and translations write back through them", () => {
    const id = bookWithChapters();
    const refs = listSentenceBlocks(
      database,
      findChapterRow(database, id, 1)!.id
    );
    // Only sentence blocks, in position order, each carrying its row id.
    expect(refs.map((block) => block.text)).toEqual(["First.", "Second."]);
    expect(new Set(refs.map((block) => block.id)).size).toBe(2);

    saveSentenceTranslations(database, [
      { id: refs[0]!.id, translation: "译一" },
      { id: refs[1]!.id, translation: null },
    ]);
    const blocks = loadChapter(database, id, 1)?.blocks.filter(
      (block) => block.kind === "sentence"
    );
    expect(blocks?.map((block) => block.translationText)).toEqual([
      "译一",
      null,
    ]);

    // All-or-nothing: an unsupported bind throws and rolls the whole call
    // back, leaving the earlier update of the same call unapplied.
    expect(() =>
      saveSentenceTranslations(database, [
        { id: refs[0]!.id, translation: "不该落库" },
        { id: refs[1]!.id, translation: { broken: true } as never },
      ])
    ).toThrow();
    expect(blocks?.map((block) => block.translationText)).toEqual([
      "译一",
      null,
    ]);
  });
});
