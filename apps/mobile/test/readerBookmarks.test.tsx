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
  isEpubRow,
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

// The 落位契约 fixture: sentence/code/sentence/image interleaved — the
// plant must land on the topmost visible SENTENCE block, never a plain
// one (mobile-bookmark-defects 缺陷 2; the h1 yields no block, so the
// chapter's blocks index 0..3 exactly as spelled here).
const MIXED_EPUB = () =>
  buildEpub({
    title: "Mixed Book",
    docs: [
      {
        href: "text/mixed.xhtml",
        body: `<h1>Mixed Chapter</h1>
<p>First sentence lands here.</p>
<pre><code>const x = 1;</code></pre>
<p>Second sentence follows the code.</p>
<p><img src="../images/dot.png" alt="A red dot"/></p>`,
      },
    ],
    images: [{ href: "images/dot.png" }],
  });

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
  bookmarks: BookmarkStore = createMemoryBookmarkStore(),
  book: { build: () => Promise<Uint8Array>; title: string } = {
    build: SAMPLE_EPUB,
    title: "Skeleton Book",
  }
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
    new File([(await book.build()) as BlobPart], "book.epub", {
      type: "application/epub+zip",
    })
  );
  await screen.findByRole("heading", { name: book.title });
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
    const rows = (await bookmarks.list(DOC_ID)).filter(isEpubRow);
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
    // The list lives behind 目录 (真机 md round 3): open the overlay first.
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByText("More")).toBeInTheDocument();

    // Jump back from the panel: the panel closes, chapter one is current
    // again (the pager's position is the current-chapter readout — the
    // chapter list itself lives behind 目录, 真机 md round 3).
    const second = await openPanel();
    jumpToRow(second, "Chapter One");
    expect(screen.queryByRole("dialog", { name: "书签" })).toBeNull();
    expect(await screen.findByText("Words")).toBeInTheDocument();
    expect(document.querySelector(".reader-position")?.textContent).toBe(
      "1 / 2"
    );

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
      exportAll: () => inner.exportAll(),
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
      exportAll: () => inner.exportAll(),
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
      exportAll: () => inner.exportAll(),
    };
    await renderReadingFace(bookmarks);

    // Open (read #2 gated), close before it lands, reopen (read #3 lands).
    await openPanel();
    // The pending signal is the plant lock (rows from the mount read
    // stay listed during the refetch — no spinner swap since the A-2
    // review fixes); findBy patience for the full-suite load window
    // (2026-11-13/15 flakes needed seconds under a saturated worker).
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "在当前位置打书签" })
        ).toBeDisabled(),
      { timeout: 3000 }
    );
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

  // mobile-bookmark-defects 缺陷 1 (EPUB face): the open used to wipe the
  // shared snapshot, so an open (or a close before the open's read landed
  // — teardown invalidates that read's ticket) blanked the in-text markers
  // for good while the store still held the marks.
  it("a slow panel read never blanks the in-text markers, on open or on close", async () => {
    stubDictionaryOnly();
    const inner = createMemoryBookmarkStore();
    const planted: BookmarkRow = await inner.add(DOC_ID, {
      chapter: 0,
      block: 1,
    });
    let calls = 0;
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const bookmarks: BookmarkStore = {
      list: (docId) => {
        calls += 1;
        // Call 1 is the mount read (lands fresh, drives the markers).
        // Call 2 is the OPEN's read — gated until the test releases it,
        // by which time the panel has closed. Its answer carries an
        // extra bogus row so any adoption would be visible.
        return calls === 2
          ? openGate.then(() => [
              planted,
              {
                id: 999,
                chapter: 1,
                block: 0,
                createdAt: "2026-11-11T00:00:00.000Z",
              } as BookmarkRow,
            ])
          : inner.list(docId);
      },
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
      exportAll: () => inner.exportAll(),
    };
    await renderReadingFace(bookmarks);

    // The mount read landed: the mark shows (the read is async — wait).
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-block-index='1']")
          ?.classList.contains("block-marked")
      ).toBe(true)
    );

    await openPanel();
    // The open's read hangs; the marker must survive the open itself.
    // (The plant lock is the pending signal — the mounted snapshot's
    // rows stay listed, no spinner swap.)
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "在当前位置打书签" })
        ).toBeDisabled(),
      { timeout: 3000 }
    );
    expect(
      document
        .querySelector("[data-block-index='1']")
        ?.classList.contains("block-marked")
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    // The abandoned read cannot blank the face: the store still holds it.
    expect(
      document
        .querySelector("[data-block-index='1']")
        ?.classList.contains("block-marked")
    ).toBe(true);

    // The late answer is stale (teardown invalidated its ticket): the
    // reopened panel's own read speaks, and the bogus row is nowhere.
    releaseOpen();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const again = await openPanel();
    expect(await within(again).findByText("Chapter One")).toBeInTheDocument();
    expect(within(again).queryByText("Chapter Two")).toBeNull();
    expect(
      document
        .querySelector("[data-block-index='1']")
        ?.classList.contains("block-marked")
    ).toBe(true);
  });

  it("a failed panel read keeps the marks in text and the rows listed", async () => {
    stubDictionaryOnly();
    const inner = createMemoryBookmarkStore();
    await inner.add(DOC_ID, { chapter: 0, block: 1 });
    let calls = 0;
    const bookmarks: BookmarkStore = {
      list: (docId) => {
        calls += 1;
        // Only the OPEN's read (call 2) fails; the mount read lands.
        return calls === 2
          ? Promise.reject(new Error("idb read died"))
          : inner.list(docId);
      },
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
      exportAll: () => inner.exportAll(),
    };
    await renderReadingFace(bookmarks);
    const marked = document.querySelector("[data-block-index='1']");
    await waitFor(() =>
      expect(marked?.classList.contains("block-marked")).toBe(true)
    );

    const dialog = await openPanel();
    // The flag speaks; the wait line retires; the last landed rows stay
    // listed under it — the snapshot is the panel's fallback truth.
    const flag = await within(dialog).findByRole("alert");
    expect(flag.textContent).toContain("书签操作失败");
    expect(within(dialog).queryByText(/读取书签中/)).toBeNull();
    expect(within(dialog).getByText("Chapter One")).toBeInTheDocument();

    // The failed refetch must not have blanked the face on close.
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(marked?.classList.contains("block-marked")).toBe(true);
  });

  it("plants on the topmost visible sentence block, never a plain block (落位契约)", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks, {
      build: MIXED_EPUB,
      title: "Mixed Book",
    });

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();

    // jsdom lays every block at top 0, so "topmost visible" resolves to
    // the LAST eligible block in DOM order. The chapter is sentence(0),
    // code(1), sentence(2), image(3): the old all-block walk planted the
    // image (3); the contract says the last SENTENCE (2).
    const rows = (await bookmarks.list("doc:Mixed Book")).filter(isEpubRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chapter).toBe(0);
    expect(rows[0]!.block).toBe(2);
    // The marker rides the planted sentence; the plain blocks stay clean.
    // (The merge commit lags the seam write — wait for it to land.)
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-block-index='2']")
          ?.classList.contains("block-marked")
      ).toBe(true)
    );
    expect(
      document
        .querySelector("[data-block-index='3']")
        ?.classList.contains("block-marked")
    ).toBe(false);
  });
});

// The landing-position and scroll evidence (mobile-test-evidence-gaps
// ②④⑤⑥): jsdom zeroes every rect, so the old assertions could only say
// block >= 0 — a plant pinned to block 0 and a deleted scrollIntoView
// both stayed green. These give the blocks distinguishable geometry and
// observe the actual scroll call.
describe("ReaderPage — 书签落点与滚动 (evidence gaps ②④⑤⑥)", () => {
  const rectAt = (top: number): DOMRect =>
    ({
      top,
      bottom: top + 20,
      left: 0,
      right: 300,
      width: 300,
      height: 20,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  // Chapter one renders two sentence blocks. Under this layout block 0
  // sits below any plausible sticky-head anchor (never crossed) and
  // block 1 has scrolled under it: the walk must land on block 1 — a
  // constant-0 plant (or a head-blind walk) reds the exact assertion.
  const layOutChapterOne = () => {
    const blocks = [
      ...document.querySelectorAll<HTMLElement>("[data-block-index]"),
    ];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    blocks[0]!.getBoundingClientRect = () => rectAt(500);
    blocks[1]!.getBoundingClientRect = () => rectAt(-300);
  };

  it("plants on the exact topmost visible block under real-ish geometry (②)", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);
    layOutChapterOne();

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();

    const rows = (await bookmarks.list(DOC_ID)).filter(isEpubRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chapter).toBe(0);
    expect(rows[0]!.block).toBe(1);
  });

  it("lists rows across chapters in reading order (⑤)", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    // Plant on chapter one, walk to chapter two, plant again.
    const first = await openPanel();
    await awaitEmptyList(first);
    plantHere();
    expect(await within(first).findByText("Chapter One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByText("More")).toBeInTheDocument();
    const second = await openPanel();
    plantHere();
    expect(await within(second).findByText("Chapter Two")).toBeInTheDocument();

    // Reading order: chapter one's row first, chapter two's second.
    const titles = within(second)
      .getAllByRole("button", { name: /^Chapter/ })
      .map((button) => button.querySelector(".bookmark-title")?.textContent);
    expect(titles).toEqual(["Chapter One", "Chapter Two"]);
  });

  it("a cross-chapter jump scrolls the planted block into view (④)", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);
    layOutChapterOne();

    // Plant on chapter one's visible block (1) under the laid-out geometry.
    const first = await openPanel();
    await awaitEmptyList(first);
    plantHere();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect((await bookmarks.list(DOC_ID)).filter(isEpubRow)[0]!.block).toBe(1);

    // Observe the scroll: jsdom has no scrollIntoView, so the optional
    // call is pinned through a recording stub on the prototype.
    const seen: HTMLElement[] = [];
    const calls: unknown[][] = [];
    const spy = vi.fn(function (this: HTMLElement, ...args: unknown[]) {
      seen.push(this);
      calls.push(args);
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: spy,
      configurable: true,
      writable: true,
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "目录" }));
      fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
      expect(await screen.findByText("More")).toBeInTheDocument();

      const panel = await openPanel();
      jumpToRow(panel, "Chapter One");
      expect(screen.queryByRole("dialog", { name: "书签" })).toBeNull();
      expect(await screen.findByText("Words")).toBeInTheDocument();
      await waitFor(() => expect(seen.length).toBeGreaterThan(0), {
        timeout: 3000,
      });
      // The jump centered the PLANTED block (1), not the chapter top.
      expect(seen[seen.length - 1]!.dataset.blockIndex).toBe("1");
      expect(calls[calls.length - 1]).toEqual([{ block: "center" }]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("the marker is chapter-scoped: switching chapters shows no stale band (⑥)", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    await renderReadingFace(bookmarks);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();
    expect(await within(dialog).findByText("Chapter One")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector(".block-marked")).not.toBeNull()
    );

    // Chapter two carries its own blocks only: the chapter-one band must
    // not bleed into it (the stale-mark regression this pins).
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByText("More")).toBeInTheDocument();
    expect(document.querySelectorAll(".block-marked")).toHaveLength(0);

    // Back on chapter one the band returns — the mark survived, not leaked.
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter One" }));
    await waitFor(() =>
      expect(document.querySelector(".block-marked")).not.toBeNull()
    );
  });
});

// ⑥'s static half: the marker's visuals live in ::before (the 3px page
// margin strip) and ::after (the ribbon) — jsdom applies no cascade, so
// the declarations are reconciled against the stylesheet text (the
// smoke rule's static-check form; deleting either pseudo's style reds).
// node:fs直读, css?raw 被 vitest 桩成空串(dictionaryAsset 同款纪律)。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const readerCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/reader/reader.css"),
  "utf8"
);

describe("block-marked visual declarations (evidence gap ⑥, static)", () => {
  const ruleBody = (selector: string): string => {
    const at = readerCss.indexOf(selector);
    expect(at, `${selector} missing from reader.css`).toBeGreaterThanOrEqual(0);
    const open = readerCss.indexOf("{", at);
    const close = readerCss.indexOf("}", open);
    return readerCss.slice(open + 1, close);
  };

  it("the mark anchors its own coordinate system", () => {
    expect(ruleBody(".block-marked")).toContain("position: relative");
  });

  it("the page-margin strip rides the marked block's left edge", () => {
    const strip = ruleBody(".block-marked::before");
    expect(strip).toContain("width: 3px");
    expect(strip).toContain("#6a4fa3");
    expect(strip).toContain("left: -0.55rem");
  });

  it("the ribbon hangs below the block's right edge", () => {
    const ribbon = ruleBody(".block-marked::after");
    expect(ribbon).toContain("clip-path");
    expect(ribbon).toContain("#6a4fa3");
    expect(ribbon).toContain("bottom: -1.1rem");
  });
});

// The A-2 review's three findings (2026-11-16): the retry race, the
// no-snapshot failure branch, and the plain-block-leader plant.
describe("ReaderPage — 书签面板评审修笔 (A-2 review)", () => {
  const rectAt = (top: number): DOMRect =>
    ({
      top,
      bottom: top + 20,
      left: 0,
      right: 300,
      width: 300,
      height: 20,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  const wrapInner = (
    inner: ReturnType<typeof createMemoryBookmarkStore>,
    list: (docId: string) => Promise<BookmarkRow[]>
  ): BookmarkStore => ({
    list,
    add: (docId, target) => inner.add(docId, target),
    remove: (docId, id) => inner.remove(docId, id),
    exportAll: () => inner.exportAll(),
  });

  it("a failure with no landed snapshot shows the flag alone — no wait line", async () => {
    stubDictionaryOnly();
    const bookmarks = wrapInner(createMemoryBookmarkStore(), () =>
      Promise.reject(new Error("idb down"))
    );
    await renderReadingFace(bookmarks);
    const dialog = await openPanel();
    const flag = await within(dialog).findByRole("alert");
    expect(flag.textContent).toContain("书签操作失败");
    // The old shape kept the wait line beside the error (the null
    // branch ignored the failure); the flag's retry is the way forward.
    expect(within(dialog).queryByText(/读取书签中/)).toBeNull();
  });

  it("row ops stay locked while a retry's refetch is in flight", async () => {
    stubDictionaryOnly();
    const inner = createMemoryBookmarkStore();
    await inner.add(DOC_ID, { chapter: 0, block: 1 });
    let calls = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const bookmarks = wrapInner(inner, (docId) => {
      calls += 1;
      // 1: mount read lands (the markers). 2: the open's read fails
      // (rows keep their snapshot, the flag speaks). 3: the retry's
      // read — gated so the test can read the locked state mid-flight.
      if (calls === 2) return Promise.reject(new Error("idb read died"));
      if (calls === 3) return retryGate.then(() => inner.list(docId));
      return inner.list(docId);
    });
    await renderReadingFace(bookmarks);
    const dialog = await openPanel();
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByText("Chapter One")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试读取书签" }));
    // Mid-refetch: the row stays listed (last truth) but its delete —
    // and the plant — lock until the read lands, so no op can race the
    // list read and resurrect a deleted row with its stale snapshot.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "删除书签：Chapter One" })
      ).toBeDisabled()
    );
    expect(
      screen.getByRole("button", { name: "在当前位置打书签" })
    ).toBeDisabled();

    releaseRetry();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "删除书签：Chapter One" })
      ).toBeEnabled()
    );
    expect(within(dialog).getAllByText("Chapter One")).toHaveLength(1);
  });

  it("a chapter led by a plain block plants the FIRST sentence, not the leader", async () => {
    stubDictionaryOnly();
    const bookmarks = createMemoryBookmarkStore();
    const imageFirst = () =>
      buildEpub({
        title: "Image First",
        docs: [
          {
            href: "text/i.xhtml",
            body: `<h1>Img Chapter</h1><p><img src="../images/dot.png" alt="A red dot"/></p><p>The first sentence arrives.</p>`,
          },
        ],
        images: [{ href: "images/dot.png" }],
      });
    await renderReadingFace(bookmarks, {
      build: imageFirst,
      title: "Image First",
    });
    // Geometry: the leading IMAGE has crossed the anchor; the chapter's
    // first sentence still sits below it — no sentence is "visible" yet.
    const blocks = [
      ...document.querySelectorAll<HTMLElement>("[data-block-index]"),
    ];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    blocks[0]!.getBoundingClientRect = () => rectAt(-300);
    blocks[1]!.getBoundingClientRect = () => rectAt(500);

    const dialog = await openPanel();
    await awaitEmptyList(dialog);
    plantHere();
    // The plant targets the first SENTENCE (index 1), never the leading
    // image's coordinate (0) — the 落位契约 holds at the chapter top.
    const rows = (await bookmarks.list("doc:Image First")).filter(isEpubRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.block).toBe(1);
  });
});
