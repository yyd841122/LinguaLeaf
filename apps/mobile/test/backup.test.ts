import { describe, expect, it } from "vitest";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  validateBackupPayload,
  type BackupPayload,
} from "../src/backup/backup-format";
import { applyBackup, buildBackup } from "../src/backup/backup";
import { createBackupManager } from "../src/backup/backup-manager";
import { createMemoryBackupFileAdapter } from "../src/backup/backup-file";
import { createMemoryBookmarkStore } from "../src/store/bookmark-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import {
  createVocabularyStore,
  memoryBackend,
} from "../src/store/vocabulary-store";
import { OfflineDictionary } from "../src/dict/offline-dictionary";

// The backup format and orchestrator (mobile-app ticket 05): the payload
// keys every per-book asset on the book TITLE — the one join key both
// hosts derive (the phone's doc:<title>, the PC's integer ids stay out) —
// and apply merges per asset through the stores' own upsert writes, never
// wiping. The per-book note cap is honored BEFORE writing, so a big PC
// library cannot die halfway through the notes batch.

const FIXTURE_DICT = { ipa: {}, inflections: {}, entries: {} };

const makeStores = () => ({
  store: createVocabularyStore(
    new OfflineDictionary(FIXTURE_DICT),
    memoryBackend()
  ),
  notes: createMemoryNotesStore(),
  library: createMemoryLibraryStore(),
  bookmarks: createMemoryBookmarkStore(),
  translations: createMemoryTranslationStore(),
});

const validPayload = (): BackupPayload => ({
  app: BACKUP_APP,
  version: BACKUP_VERSION,
  exportedAt: "2026-11-13T10:00:00.000Z",
  books: [{ title: "Title A" }],
  assets: {
    vocabulary: { hello: "known" },
    notes: [
      {
        bookTitle: "Title A",
        chapterIndex: 0,
        blockIndex: 1,
        type: "feeling",
        text: "好句",
      },
    ],
    progress: { "Title A": { chapterIndex: 2, blockIndex: 5 } },
    bookmarks: [
      {
        bookTitle: "Title A",
        chapter: 1,
        block: 0,
        createdAt: "2026-11-10T08:00:00.000Z",
      },
    ],
    translations: { "Title A": { "0": { "1": "译文一行" } } },
  },
});

describe("backup format validation", () => {
  it("accepts a well-formed v1 payload", () => {
    expect(validateBackupPayload(validPayload())).toEqual(validPayload());
  });

  it.each([
    [{ app: "other" }, /不是 LinguaLeaf 备份文件/],
    [{ app: BACKUP_APP, version: 99 }, /版本不受支持/],
  ])("rejects a foreign/mis-versioned file readably: %j", (value, match) => {
    expect(() => validateBackupPayload(value)).toThrow(match);
  });

  it("rejects corrupt per-asset shapes with the asset named", () => {
    const badVocab = validPayload();
    (badVocab.assets.vocabulary as Record<string, string>).hello = "maybe";
    expect(() => validateBackupPayload(badVocab)).toThrow(/生词本段/);

    const badNote = validPayload();
    badNote.assets.notes[0]!.text = "   ";
    expect(() => validateBackupPayload(badNote)).toThrow(/笔记段/);

    const badBookmark = validPayload();
    badBookmark.assets.bookmarks[0]!.chapter = -1;
    expect(() => validateBackupPayload(badBookmark)).toThrow(/书签段/);

    const badTranslations = validPayload();
    badTranslations.assets.translations["Title A"] = {
      "0": { "1": 3 },
    } as never;
    expect(() => validateBackupPayload(badTranslations)).toThrow(/译文段/);
  });
});

describe("buildBackup", () => {
  it("keys per-book assets on titles and lists the books sorted", async () => {
    const stores = makeStores();
    await stores.store.setStatus("hello", "known");
    await stores.notes.save(
      { docId: "doc:Title A", chapterIndex: 0, blockIndex: 1, type: "feeling" },
      "好句"
    );
    await stores.library.setProgress("doc:Title A", {
      chapterIndex: 2,
      blockIndex: 5,
    });
    await stores.bookmarks.add("doc:Title B", { chapter: 0, block: 3 });
    await stores.translations.saveTranslations("doc:Title A", 0, [
      { blockIndex: 1, translation: "译文一行" },
    ]);

    const payload = await buildBackup(stores, () =>
      Date.parse("2026-11-13T10:00:00.000Z")
    );
    expect(payload.app).toBe(BACKUP_APP);
    expect(payload.version).toBe(BACKUP_VERSION);
    expect(payload.exportedAt).toBe("2026-11-13T10:00:00.000Z");
    expect(payload.books).toEqual([{ title: "Title A" }, { title: "Title B" }]);
    expect(payload.assets.vocabulary).toEqual({ hello: "known" });
    expect(payload.assets.notes).toEqual([
      {
        bookTitle: "Title A",
        chapterIndex: 0,
        blockIndex: 1,
        type: "feeling",
        text: "好句",
      },
    ]);
    expect(payload.assets.progress).toEqual({
      "Title A": { chapterIndex: 2, blockIndex: 5 },
    });
    expect(payload.assets.bookmarks).toEqual([
      {
        bookTitle: "Title B",
        chapter: 0,
        block: 3,
        createdAt: expect.any(String),
      },
    ]);
    expect(payload.assets.translations).toEqual({
      "Title A": { "0": { "1": "译文一行" } },
    });
  });

  it("keeps PDF page rows device-local: they never enter the payload (ticket 03)", async () => {
    const stores = makeStores();
    // A PDF doc with only page marks has no other asset — it must not
    // surface in `books` either, or the payload would list a book the
    // assets cannot describe.
    await stores.bookmarks.add("fp:Pdf Book", { page: 4 });
    await stores.bookmarks.add("doc:Title A", { chapter: 0, block: 1 });
    const payload = await buildBackup(stores);
    expect(payload.assets.bookmarks).toEqual([
      {
        bookTitle: "Title A",
        chapter: 0,
        block: 1,
        createdAt: expect.any(String),
      },
    ]);
    expect(payload.books).toEqual([{ title: "Title A" }]);
  });
});

describe("applyBackup", () => {
  it("lands every asset on a fresh device, in the store's own shapes", async () => {
    const stores = makeStores();
    const summary = await applyBackup(validPayload(), stores);
    expect(summary).toEqual({
      vocabulary: 1,
      notes: 1,
      notesSkippedOverCap: 0,
      progress: 1,
      bookmarks: 1,
      translations: 1,
    });
    const rows = await stores.bookmarks.list("doc:Title A");
    expect(rows).toHaveLength(1);
    // The id is MINTED locally, not imported.
    expect(rows[0]!.id).toBe(1);
    expect(await stores.notes.list("doc:Title A")).toHaveLength(1);
    expect(await stores.library.exportProgress()).toEqual({
      "doc:Title A": { chapterIndex: 2, blockIndex: 5 },
    });
    expect(await stores.translations.getChapter("doc:Title A", 0)).toEqual({
      "1": "译文一行",
    });
  });

  it("merges per asset with the PC side winning each conflict", async () => {
    const stores = makeStores();
    await stores.store.setStatus("hello", "learning");
    await stores.library.setProgress("doc:Title A", {
      chapterIndex: 0,
      blockIndex: 0,
    });
    await stores.bookmarks.add("doc:Title A", { chapter: 1, block: 0 });
    await stores.translations.saveTranslations("doc:Title A", 0, [
      { blockIndex: 9, translation: "本地行" },
    ]);

    const summary = await applyBackup(validPayload(), stores);
    expect(await stores.store.exportAll()).toEqual({ hello: "known" });
    expect(await stores.library.exportProgress()).toEqual({
      "doc:Title A": { chapterIndex: 2, blockIndex: 5 },
    });
    // Same position stays one row (re-mint, then idempotence); the local
    // translation line survives (merge, not wipe).
    expect(await stores.bookmarks.list("doc:Title A")).toHaveLength(1);
    expect(await stores.translations.getChapter("doc:Title A", 0)).toEqual({
      "1": "译文一行",
      "9": "本地行",
    });
    expect(summary.bookmarks).toBe(1);
  });

  it("pre-counts notes past a book's cap instead of dying mid-batch", async () => {
    const stores = makeStores();
    // 99 existing notes: headroom 1. Incoming: 1 replacement + 2 fresh →
    // one fresh applies, the other is reported, not crashed.
    for (let block = 0; block < 99; block += 1) {
      await stores.notes.save(
        {
          docId: "doc:Title A",
          chapterIndex: 0,
          blockIndex: block,
          type: "progress",
        },
        `已有 ${block}`
      );
    }
    const payload = validPayload();
    payload.assets.notes = [
      // replacement of block 0's progress note
      {
        bookTitle: "Title A",
        chapterIndex: 0,
        blockIndex: 0,
        type: "progress",
        text: "替换后的正文",
      },
      {
        bookTitle: "Title A",
        chapterIndex: 1,
        blockIndex: 0,
        type: "feeling",
        text: "新笔记一",
      },
      {
        bookTitle: "Title A",
        chapterIndex: 2,
        blockIndex: 0,
        type: "idea",
        text: "新笔记二",
      },
    ];
    const summary = await applyBackup(payload, stores);
    expect(summary.notes).toBe(2);
    expect(summary.notesSkippedOverCap).toBe(1);
    expect(await stores.notes.list("doc:Title A")).toHaveLength(100);
    const notes = await stores.notes.list("doc:Title A");
    expect(notes.find((note) => note.chapterIndex === 0)?.text).toBe(
      "替换后的正文"
    );
    expect(notes.find((note) => note.chapterIndex === 1)?.text).toBe(
      "新笔记一"
    );
    expect(notes.find((note) => note.chapterIndex === 2)).toBeUndefined();
  });
});

describe("backup manager + file adapter", () => {
  it("export hands the built payload to the adapter", async () => {
    const stores = makeStores();
    const adapter = createMemoryBackupFileAdapter();
    const manager = createBackupManager(stores, adapter);
    await manager.exportBackup();
    expect(adapter.saved).toHaveLength(1);
    expect(adapter.saved[0]!.payload.app).toBe(BACKUP_APP);
    expect(adapter.saved[0]!.path).toMatch(
      /lingualeaf-backup-v1-\d{8}-\d{4}\.json/
    );
  });

  it("import validates everything before any write: corrupt file, zero landings", async () => {
    const stores = makeStores();
    await stores.store.setStatus("hello", "known");
    const adapter = createMemoryBackupFileAdapter();
    const manager = createBackupManager(stores, adapter);
    const corrupt = new File(
      [JSON.stringify({ app: BACKUP_APP, version: 99 })],
      "backup.json",
      { type: "application/json" }
    );
    await expect(manager.importBackup(corrupt)).rejects.toThrow(/版本不受支持/);
    // The phone's own data is untouched by the rejected import.
    expect(await stores.store.exportAll()).toEqual({ hello: "known" });
    expect(await stores.notes.exportAll()).toEqual([]);
  });

  it("import of a non-JSON file reads as a named condition", async () => {
    const manager = createBackupManager(
      makeStores(),
      createMemoryBackupFileAdapter()
    );
    const notJson = new File(["<html>404</html>"], "backup.json", {
      type: "application/json",
    });
    await expect(manager.importBackup(notJson)).rejects.toThrow(
      /不是 LinguaLeaf 备份文件/
    );
  });
});
