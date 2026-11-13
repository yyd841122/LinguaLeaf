import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ReaderPage } from "../src/reader/ReaderPage";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { createChapterTaskRegistry } from "../src/translate/chapter-tasks";
import { createMemoryTranslateSettingsStore } from "../src/store/translate-settings-store";
import {
  createMemoryBookmarkStore,
  type BookmarkRow,
  type BookmarkStore,
} from "../src/store/bookmark-store";
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

// The bookmark face (mobile-app ticket 10): the 书签 panel plants a mark
// at the position progress would report (the shared topmost-visible-block
// rule), lists rows in reading order, jumps back through the TOC's own
// chapter switch, deletes, and reports seam failures as one readable flag
// a fresh success retires. The planted block also carries a visible
// in-text marker, driven by the doc-wide rows the face reads at mount.
// The settle-channel invariant is pinned too: a closed panel's late list
// cannot outvote the reopened panel's read. Chapter-title queries are
// scoped to the dialog — the title also names the TOC entry, the chapter
// heading outside it, and possibly the marked block's own text.

const FIXTURE_DICT = {
  ipa: { woke: "woʊk", words: "wɜːdz" },
  inflections: {},
  entries: {},
};

const SAMPLE_EPUB = () =>
  buildEpub({
    title: "Skeleton Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>Chapter One</h1><p>Words arrive on the page. A second sentence follows.</p>",
      },
      {
        href: "text/two.xhtml",
        body: "<h2>Chapter Two</h2><p>More words live here.</p>",
      },
    ],
  });

const DOC_ID = "doc:Skeleton Book";

// Only the baked dictionary asset is fetched in this suite (bookmarks
// never leave the seam); an unmatched request throws naming the URL
// (CODING_STANDARDS: a stub gap must not read as a domain failure).
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

async function pickFile(file: File): Promise<void> {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

async function renderReadingFace(
  bookmarks: BookmarkStore = createMemoryBookmarkStore()
): Promise<void> {
  render(
    <ReaderPage
      store={createVocabularyStore(
        new OfflineDictionary(FIXTURE_DICT),
        memoryBackend()
      )}
      library={createMemoryLibraryStore()}
      notes={createMemoryNotesStore()}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      translations={createMemoryTranslationStore()}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={bookmarks}
      registry={createChapterTaskRegistry()}
    />
  );
  await pickFile(
    new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
      type: "application/epub+zip",
    })
  );
  await screen.findByRole("heading", { name: "Skeleton Book" });
}

const openPanel = async () => {
  fireEvent.click(screen.getByRole("button", { name: "书签" }));
  return screen.findByRole("dialog", { name: "书签" });
};

const plantHere = () => {
  // The plant stays locked until the open's list read lands (the
  // pending-snapshot overwrite race) — every planting test waits for the
  // settled fact first: the empty state with no marks.
  const button = screen.getByRole("button", { name: "在当前位置打书签" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
};

const awaitEmptyList = async (dialog: HTMLElement) =>
  expect(await within(dialog).findByText(/还没有书签/)).toBeInTheDocument();

// The row click aims at the row's own prefix: its accessible name leads
// with the title, the delete button's ends with it.
const jumpToRow = (dialog: HTMLElement, title: string) =>
  fireEvent.click(
    within(dialog).getByRole("button", { name: new RegExp(`^${title}`) })
  );

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReaderPage — 书签 (ticket 10)", () => {
  it("plants a bookmark at the current position and lists it in the panel", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();

    // The row lands in the panel: chapter title + planted-at stamp.
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();
    // And in the seam, at the current chapter's block coordinates (jsdom
    // lays every block at top 0, so the planted block is somewhere in the
    // chapter's block range — the topmost rule itself is the progress
    // save's rule, already shipped).
    const rows = await bookmarks.list(DOC_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chapter).toBe(0);
    expect(rows[0]!.block).toBeGreaterThanOrEqual(0);
  });

  it("a replant at the same position stays one row (same-position idempotence)", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();
    plantHere();
    await waitFor(() =>
      expect(within(dialog).getAllByText("Chapter One")).toHaveLength(1)
    );
    expect(await bookmarks.list(DOC_ID)).toHaveLength(1);
  });

  it("a row click jumps back to the planted chapter and closes the panel", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    // Plant on chapter one, walk to chapter two.
    const first = await openPanel();
    await awaitEmptyList(first);
    plantHere();
    expect(await within(first).findByText("Chapter One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByText("More")).toBeInTheDocument();

    // Jump back from the panel: the panel closes, chapter one is current
    // again (its TOC entry carries aria-current).
    const second = await openPanel();
    jumpToRow(second, "Chapter One");
    expect(screen.queryByRole("dialog", { name: "书签" })).toBeNull();
    expect(await screen.findByText("Words")).toBeInTheDocument();
    const current = screen
      .getAllByRole("button", { name: "Chapter One" })
      .find((button) => button.getAttribute("aria-current") === "true");
    expect(current).toBeDefined();

    // A same-chapter jump is the same flow minus the switch: no crash,
    // panel closes (jsdom has no scrollIntoView — the block anchor rides
    // the restore effect's own optional-call technique).
    const third = await openPanel();
    jumpToRow(third, "Chapter One");
    expect(screen.queryByRole("dialog", { name: "书签" })).toBeNull();
    expect(await screen.findByText("Words")).toBeInTheDocument();
  });

  it("删除 removes the row from the panel and the seam", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "删除书签：Chapter One" })
    );
    await waitFor(() =>
      expect(screen.getByText(/还没有书签/)).toBeInTheDocument()
    );
    expect(await bookmarks.list(DOC_ID)).toEqual([]);
  });

  it("marks the planted block in the face, and the marker retires on 删除", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();

    // jsdom lays every block at top 0, so the topmost rule plants the
    // chapter's LAST block: the marker lands on that exact block.
    const planted = document.querySelector(
      "[data-block-index='1']"
    ) as HTMLElement;
    expect(planted.classList.contains("block-marked")).toBe(true);
    // An unmarked sibling carries no marker.
    const first = document.querySelector(
      "[data-block-index='0']"
    ) as HTMLElement;
    expect(first.classList.contains("block-marked")).toBe(false);

    // The marker is a fact of the face, not the panel: close, it stays.
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(planted.classList.contains("block-marked")).toBe(true);

    // 删除 retires it everywhere.
    const again = await openPanel();
    await within(again).findByText("Chapter One");
    fireEvent.click(
      screen.getByRole("button", { name: "删除书签：Chapter One" })
    );
    await waitFor(() =>
      expect(screen.getByText(/还没有书签/)).toBeInTheDocument()
    );
    expect(planted.classList.contains("block-marked")).toBe(false);
  });

  it("a failed op raises one readable flag and the next success retires it", async () => {
    stubDictionaryOnly();
    const inner = createMemoryBookmarkStore();
    let failNextAdd = true;
    const bookmarks: BookmarkStore = {
      list: (docId) => inner.list(docId),
      add: async (docId, target) => {
        if (failNextAdd) {
          failNextAdd = false;
          throw new Error("idb write died");
        }
        return inner.add(docId, target);
      },
      remove: (docId, id) => inner.remove(docId, id),
    };
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();
    const flag = await screen.findByRole("alert");
    expect(flag.textContent).toContain("书签操作失败");

    // The retry plant succeeds: the flag retires, the row lands.
    plantHere();
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await inner.list(DOC_ID)).toHaveLength(1);
  });

  it("a failed list read surfaces with a retry that recovers", async () => {
    stubDictionaryOnly();
    const inner = createMemoryBookmarkStore();
    await inner.add(DOC_ID, { chapter: 0, block: 0 });
    // The seam fails every read until the test flips it — order-independent
    // (the face reads the doc's marks at mount AND on panel open; the flag
    // must come from the open's read, the panel being the flag's surface).
    let failList = true;
    const bookmarks: BookmarkStore = {
      list: (docId) =>
        failList
          ? Promise.reject(new Error("idb read died"))
          : inner.list(docId),
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
    };
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    const flag = await screen.findByRole("alert");
    expect(flag.textContent).toContain("书签操作失败");

    failList = false;
    fireEvent.click(screen.getByRole("button", { name: "重试读取书签" }));
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("a closed panel's late list cannot outvote the reopened panel's read", async () => {
    stubDictionaryOnly();
    const inner = createMemoryBookmarkStore();
    const planted: BookmarkRow = await inner.add(DOC_ID, {
      chapter: 0,
      block: 1,
    });
    // The stale read's answer must be DISTINGUISHABLE from the fresh one,
    // or the test cannot tell a dropped ticket from an applied one (the
    // mutation probe: delete the effect's invalidate and this must go
    // red). The stale snapshot carries an extra row the fresh list lacks.
    const staleRow: BookmarkRow = {
      id: 999,
      chapter: 1,
      block: 0,
      createdAt: "2026-11-11T00:00:00.000Z",
    };
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const bookmarks: BookmarkStore = {
      list: (docId) => {
        calls += 1;
        // Call 1 is the mount read (the face's markers — it lands fresh).
        // Call 2 is the OPEN's read — that one hangs until the test
        // releases it, by which time the panel has closed and reopened,
        // and only the reopened read's answer may speak (teardown
        // invalidated the open's ticket).
        return calls === 2
          ? firstGate.then(() => [planted, staleRow])
          : inner.list(docId);
      },
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
    };
    await renderReadingFace(bookmarks);

    // Open (read #2 gated), close before it lands, reopen (read #3 lands).
    await openPanel();
    // findBy, not getBy: under full-suite load the loading commit and the
    // dialog commit can land a tick apart (2026-11-13 pre-commit flake).
    expect(await screen.findByText(/读取书签中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    const dialog = await openPanel();
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();

    // Now the stale read resolves carrying its extra row: the panel must
    // not adopt it — no second row, no resurrection, no rewind.
    releaseFirst();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(within(dialog).getAllByText("Chapter One")).toHaveLength(1);
    expect(within(dialog).queryByText("Chapter Two")).toBeNull();
    expect(calls).toBe(3);
    expect(await inner.list(DOC_ID)).toEqual([planted]);
  });
});
