import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReaderPage } from "../src/reader/ReaderPage";
import { createChapterTaskRegistry } from "../src/translate/chapter-tasks";
import { createMemoryTranslateSettingsStore } from "../src/store/translate-settings-store";
import { createMemoryBookmarkStore } from "../src/store/bookmark-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import {
  createVocabularyStore,
  memoryBackend,
} from "../src/store/vocabulary-store";
import { OfflineDictionary } from "../src/dict/offline-dictionary";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  type BackupPayload,
} from "../src/backup/backup-format";
import { createBackupManager } from "../src/backup/backup-manager";
import { createMemoryBackupFileAdapter } from "../src/backup/backup-file";

// The landing's 备份与恢复 block (mobile-app ticket 05): the export action
// hands a built payload to the injected adapter; the import action reads a
// picked file through the real manager, so a corrupt file lands as one
// readable alert with the stores untouched, and a good one lands as a
// per-asset summary line.

const FIXTURE_DICT = { ipa: {}, inflections: {}, entries: {} };

const makeLandingStores = () => ({
  store: createVocabularyStore(
    new OfflineDictionary(FIXTURE_DICT),
    memoryBackend()
  ),
  notes: createMemoryNotesStore(),
  library: createMemoryLibraryStore(),
  bookmarks: createMemoryBookmarkStore(),
  translations: createMemoryTranslationStore(),
});

const renderLanding = (
  adapter = createMemoryBackupFileAdapter(),
  stores = makeLandingStores()
) => {
  const manager = createBackupManager(stores, adapter);
  render(
    <ReaderPage
      store={stores.store}
      library={stores.library}
      notes={stores.notes}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      translations={stores.translations}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={stores.bookmarks}
      registry={createChapterTaskRegistry()}
      backup={manager}
    />
  );
  return { stores, adapter };
};

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReaderPage — 备份与恢复 (ticket 05)", () => {
  it("shows the 备份与恢复 section once the vocabulary seam resolves", async () => {
    stubDictionaryOnly();
    renderLanding();
    // The dictionary read is async; the section follows it (the recents
    // read's own posture — present when ready, absent before).
    expect(
      await screen.findByRole("region", { name: "备份与恢复" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存到本机" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "分享备份" })).toBeEnabled();
  });

  it("分享备份 hands the payload to the adapter and stays quiet on success", async () => {
    stubDictionaryOnly();
    const { adapter, stores } = renderLanding();
    await stores.bookmarks.add("doc:Title A", { chapter: 0, block: 2 });

    fireEvent.click(await screen.findByRole("button", { name: "分享备份" }));
    await waitFor(() => expect(adapter.saved).toHaveLength(1));
    const payload: BackupPayload = adapter.saved[0]!.payload;
    expect(payload.app).toBe(BACKUP_APP);
    expect(payload.version).toBe(BACKUP_VERSION);
    expect(payload.assets.bookmarks).toEqual([
      {
        bookTitle: "Title A",
        chapter: 0,
        block: 2,
        createdAt: expect.any(String),
      },
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("import lands a good file and reports the per-asset summary", async () => {
    stubDictionaryOnly();
    const { stores } = renderLanding();
    await stores.store.setStatus("hello", "learning");

    const payload: BackupPayload = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: "2026-11-13T10:00:00.000Z",
      books: [{ title: "Title A" }],
      assets: {
        vocabulary: { hello: "known", world: "ignored" },
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
    };
    await pickBackupFile(payload);

    expect(
      await screen.findByText(
        /导入完成：生词本 2 条、笔记 1 条、进度 1 本、书签 1 条、译文 1 行。/
      )
    ).toBeInTheDocument();
    expect(await stores.store.exportAll()).toEqual({
      hello: "known",
      world: "ignored",
    });
    expect(await stores.bookmarks.list("doc:Title A")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("保存到本机 lands the payload in the local save and names the file", async () => {
    stubDictionaryOnly();
    const { adapter, stores } = renderLanding();
    await stores.bookmarks.add("doc:Title A", { chapter: 0, block: 2 });

    fireEvent.click(await screen.findByRole("button", { name: "保存到本机" }));
    expect(
      await screen.findByText(/已保存到手机的「下载」目录：/, undefined, {
        timeout: 3000,
      })
    ).toBeInTheDocument();
    expect(adapter.savedLocal).toHaveLength(1);
    expect(adapter.savedLocal[0]!.payload.assets.bookmarks).toEqual([
      {
        bookTitle: "Title A",
        chapter: 0,
        block: 2,
        createdAt: expect.any(String),
      },
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a corrupt file reads as one alert and writes nothing", async () => {
    stubDictionaryOnly();
    const { stores } = renderLanding();
    await stores.store.setStatus("hello", "known");

    await pickBackupFile({ app: BACKUP_APP, version: 99 });
    expect(await screen.findByRole("alert")).toHaveTextContent(/版本不受支持/);
    // Zero landings: the rejected import left the phone's own data alone.
    expect(await stores.store.exportAll()).toEqual({ hello: "known" });
    expect(await stores.notes.exportAll()).toEqual([]);
    expect(screen.queryByText(/导入完成/)).toBeNull();
  });

  // mobile-progress-stale-reopen 缺陷 1: the import landed progress on the
  // shelf's rows but the recents read never re-ran, so the 续读 click
  // reopened the OLD chapter (恢复到第 3 章 → 打开仍在第 1 章).
  it("a successful import refreshes the recents rows to the restored positions", async () => {
    stubDictionaryOnly();
    // Seeded BEFORE render: the mount read lists the row at its old spot
    // (the shelf shows 第 1 章 — the default position).
    const stores = makeLandingStores();
    await stores.library.saveDocument({
      id: "doc:Title A",
      title: "Title A",
      book: { title: "Title A", chapters: [] },
    });
    renderLanding(undefined, stores);
    expect(await screen.findByText("第 1 章")).toBeInTheDocument();

    await pickBackupFile({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: "2026-11-13T10:00:00.000Z",
      books: [{ title: "Title A" }],
      assets: {
        vocabulary: {},
        notes: [],
        progress: { "Title A": { chapterIndex: 2, blockIndex: 5 } },
        bookmarks: [],
        translations: {},
      },
    });
    expect(
      await screen.findByText(
        /导入完成：生词本 0 条、笔记 0 条、进度 1 本、书签 0 条、译文 0 行。/
      )
    ).toBeInTheDocument();
    // The row re-read: the restored position is what the 续读 click now
    // carries (the hint renders chapterIndex + 1).
    expect(await screen.findByText("第 3 章")).toBeInTheDocument();
    expect(screen.queryByText("第 1 章")).toBeNull();
    expect((await stores.library.listDocuments())[0]?.progress).toEqual({
      chapterIndex: 2,
      blockIndex: 5,
    });
  });
});

// Only the baked dictionary asset is fetched (the backup rides the file
// input); an unmatched request throws naming the URL (CODING_STANDARDS:
// a stub gap must not read as a domain failure).
function stubDictionaryOnly(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("dictionary.json")) {
        return {
          ok: true,
          json: async () => FIXTURE_DICT,
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

async function pickBackupFile(payload: unknown): Promise<void> {
  const input = document.querySelector(
    'input[aria-label="选择备份文件"]'
  ) as HTMLInputElement;
  const file = new File([JSON.stringify(payload)], "backup.json", {
    type: "application/json",
  });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

// The A-3 review's P2 (2026-11-16): the error page offers the backup
// import too, but the recents effect's empty-only guard skipped the
// re-read — a restore landed on the ERROR page left the stale chapter
// row clickable there.
describe("ReaderPage — 备份恢复在错误页也刷新书架 (A-3 review)", () => {
  it("a restore landed while the error page is up refreshes the recents rows", async () => {
    stubDictionaryOnly();
    const stores = makeLandingStores();
    await stores.library.saveDocument({
      id: "doc:Title A",
      title: "Title A",
      book: { title: "Title A", chapters: [] },
    });
    renderLanding(undefined, stores);
    expect(await screen.findByText("第 1 章")).toBeInTheDocument();

    // A garbage book file lands on the error page (its card is a fact;
    // the copy itself is not pinned — it is rewordable prose).
    const bookInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(bookInput, "files", {
      value: [new File(["garbage bytes"], "broken.epub")],
      configurable: true,
    });
    fireEvent.change(bookInput);
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // The restore lands while the error page is up: the row the error
    // page renders must carry the restored position.
    await pickBackupFile({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: "2026-11-13T10:00:00.000Z",
      books: [{ title: "Title A" }],
      assets: {
        vocabulary: {},
        notes: [],
        progress: { "Title A": { chapterIndex: 2, blockIndex: 5 } },
        bookmarks: [],
        translations: {},
      },
    });
    expect(await screen.findByText(/导入完成/)).toBeInTheDocument();
    expect(await screen.findByText("第 3 章")).toBeInTheDocument();
    expect(screen.queryByText("第 1 章")).toBeNull();
  });
});
