import { PICKER_LABEL } from "./reader-picker";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import { ReaderPage } from "../src/reader/ReaderPage";
import * as pdf from "../src/reader/pdf";
import { pdfFingerprint } from "../src/store/pdf-fingerprint";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import {
  createMemoryBookmarkStore,
  type BookmarkStore,
} from "../src/store/bookmark-store";
import { createMemoryTranslateSettingsStore } from "../src/store/translate-settings-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
import type { VocabularyStore } from "../src/store/vocabulary-store";

// The PDF face's bookmarks (mobile-app ticket 03): the 书签 panel plants a
// mark at the current page (same-position replant is one mark), lists rows
// as 第 N 页 in page order, jumps back through the footer's own page
// channel, deletes. Rows survive the face being torn down and reopened —
// the panel reads the store at mount and on every open.

const vocab: VocabularyStore = {
  stateKey: (word) => word.toLowerCase(),
  async lookup() {
    return null;
  },
  async statesFor() {
    return new Map();
  },
  async setStatus() {},
  async exportAll() {
    return {};
  },
};
const source = (tail = "A") => `%PDF-1.7 common head and pages ${tail}`;
const id = (tail = "A") =>
  pdfFingerprint(new TextEncoder().encode(source(tail)).buffer);

function session(): pdf.PdfSession {
  return {
    title: "Same title",
    pageCount: 3,
    doc: {
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as pdf.PdfSession["doc"],
  };
}

beforeEach(() => {
  // Only the baked dictionary asset is fetched in this suite; an
  // unmatched request throws naming the URL (CODING_STANDARDS: a stub
  // gap must not read as a domain failure) — readerBookmarks' same shape.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("dictionary.json")) {
        return {
          ok: true,
          json: async () => ({ ipa: {}, entries: {}, inflections: {} }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(pdf, "openPdf").mockImplementation(async () => session());
  vi.spyOn(pdf, "sampleTextLengths").mockResolvedValue([120]);
  vi.spyOn(pdf, "renderPdfPage").mockImplementation(async (_, overlay) => {
    pdf.clearPdfOverlay(overlay);
    // One tappable word per render, hanging on line 0 — the popup pin
    // and the long-press plant need a live anchor with line geometry;
    // the bookmark tests never click it except where stated.
    const word = document.createElement("span");
    word.className = "pdf-word";
    word.dataset.pdfWord = "Woke";
    word.dataset.word = "Woke";
    word.dataset.pdfLineIndex = "0";
    word.setAttribute("role", "button");
    word.tabIndex = 0;
    word.textContent = "Woke";
    const ipa = document.createElement("span");
    ipa.className = "pdf-ipa";
    word.appendChild(ipa);
    overlay.appendChild(word);
    // The note pen's enable is the settle signal (marker effect runs
    // only after the render AND the read land) — the long-press tests
    // gate on it, the same discipline as the notes suite.
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pdfNote = "0";
    button.dataset.lineText = "Woke";
    button.className = "pdf-note-button";
    button.disabled = true;
    button.textContent = "✎";
    overlay.appendChild(button);
    return {
      wordCount: 1,
      ipaCount: 1,
      lines: [{ lineIndex: 0, top: 0, height: 12, right: 100, text: "Woke" }],
    };
  });
});

function mount(bookmarks: BookmarkStore = createMemoryBookmarkStore()) {
  const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
  const tree = () => (
    <ReaderPage
      store={vocab}
      library={createMemoryLibraryStore()}
      notes={createMemoryNotesStore()}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      pdfBytes={bytes}
      translations={createMemoryTranslationStore()}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={bookmarks}
    />
  );
  return { view: render(tree()), tree, bookmarks, bytes };
}

async function pick() {
  fireEvent.change(screen.getByLabelText(PICKER_LABEL), {
    target: { files: [new File([source()], "same.pdf")] },
  });
  await screen.findByRole("heading", { name: "Same title" });
}

async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "书签" }));
  await screen.findByRole("dialog", { name: "书签" });
}

const at = () => document.querySelector(".reader-position")!.textContent;

// jsdom's attribute selectors match values case-insensitively (nwsapi);
// exact-name queries narrow with the selector then compare getAttribute
// (CODING_STANDARDS: exact-name attribute assertions; evidence gap ⑪).
const wordEl = (name: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>("[data-word]")].find(
    (el) => el.getAttribute("data-word") === name
  ) ?? null;

describe("PDF face bookmarks (ticket 03)", () => {
  it("opens empty, plants the current page once, and a replant stays one mark", async () => {
    const ctx = mount();
    await pick();
    await openPanel();
    expect(
      screen.getByText(/还没有书签。点「在当前位置打书签」/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    expect(
      await screen.findByRole("button", { name: /^第 1 页/ })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    const docId = await id();
    await waitFor(() =>
      expect(ctx.bookmarks.list(docId)).resolves.toHaveLength(1)
    );
    // The planted position is this face's fact: page 1, the topmost
    // visible line (the mock's only line), its text as the snippet.
    expect(await ctx.bookmarks.list(docId)).toEqual([
      expect.objectContaining({ page: 1, line: 0, text: "Woke" }),
    ]);
    // The face-level marker shows on the planted line (round 4).
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();
  });

  it("flips pages between plants and lists rows in page order", async () => {
    const ctx = mount();
    await pick();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    await screen.findByRole("button", { name: /^第 1 页/ });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(at()).toBe("2 / 3"));
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    await screen.findByRole("button", { name: /^第 2 页/ });
    const rows = await ctx.bookmarks.list(await id());
    expect(rows.map((row) => ("page" in row ? row.page : null))).toEqual([
      1, 2,
    ]);
    // Exact names — the delete buttons' labels merely contain 第 N 页.
    expect(
      screen.getByRole("button", { name: /^第 1 页/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^第 2 页/ })
    ).toBeInTheDocument();
  });

  it("jumps back to the planted page and closes the panel", async () => {
    const ctx = mount();
    await pick();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    await screen.findByRole("button", { name: /^第 1 页/ });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(at()).toBe("3 / 3"));
    // Page 3 carries no mark — the strip follows the planted page only.
    expect(document.querySelector(".pdf-bookmark-mark")).toBeNull();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^第 1 页/ }));
    await waitFor(() => expect(at()).toBe("1 / 3"));
    expect(screen.queryByRole("dialog", { name: "书签" })).toBeNull();
    // The marker rides the rows: gone on the unplanted page 3, back on 1.
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();
    expect(await ctx.bookmarks.list(await id())).toHaveLength(1);
  });

  it("deletes a mark; the panel falls back to its empty copy", async () => {
    const ctx = mount();
    await pick();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    await screen.findByRole("button", { name: /^第 1 页/ });
    fireEvent.click(screen.getByRole("button", { name: /^删除书签：第 1 页/ }));
    expect(
      await screen.findByText(/还没有书签。点「在当前位置打书签」/)
    ).toBeInTheDocument();
    expect(await ctx.bookmarks.list(await id())).toEqual([]);
    // The marker retires with the row.
    expect(document.querySelector(".pdf-bookmark-mark")).toBeNull();
  });

  it("rows survive the face being torn down and the book reopened", async () => {
    const ctx = mount();
    await pick();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "在当前位置打书签" }));
    await screen.findByRole("button", { name: /^第 1 页/ });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    // Kill the face, mount a fresh tree over the same stores, re-pick —
    // 杀进程重开仍在's jsdom surrogate.
    ctx.view.unmount();
    render(ctx.tree());
    await pick();
    await openPanel();
    expect(
      await screen.findByRole("button", { name: /^第 1 页/ })
    ).toBeInTheDocument();
    expect(await ctx.bookmarks.list(await id())).toHaveLength(1);
  });

  it("long-pressing a word plants the mark on its line, lookup swallowed", async () => {
    const ctx = mount();
    await pick();
    const wordAt = () => wordEl("Woke");
    await waitFor(() => expect(wordAt()).not.toBeNull());
    // The pen going enabled proves lineGeo landed — a press before that
    // races empty geometry and never plants (full-suite load flake).
    await waitFor(() =>
      expect(document.querySelector("[data-pdf-note]")).toBeEnabled()
    );
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(wordAt()!);
      act(() => {
        vi.advanceTimersByTime(520);
      });
      fireEvent.pointerUp(wordAt()!);
    } finally {
      vi.useRealTimers();
    }
    const docId = await id();
    await waitFor(() =>
      expect(ctx.bookmarks.list(docId)).resolves.toHaveLength(1)
    );
    const rows = await ctx.bookmarks.list(docId);
    expect(rows[0]).toMatchObject({ page: 1, line: 0, text: "Woke" });
    // The swallowed click: the release's click is dispatched and must
    // NOT open the popup (deleting the suppression reds here — from a
    // resting state the null check below is vacuous).
    fireEvent.click(wordAt()!);
    expect(screen.queryByRole("dialog", { name: "词详情：Woke" })).toBeNull();
    // The marker hangs on the line.
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();
  });

  it("a page flip or a zoom dismisses the anchored popup (EPUB parity)", async () => {
    mount();
    await pick();
    const wordAt = () => wordEl("Woke");
    await waitFor(() => expect(wordAt()).not.toBeNull());
    fireEvent.click(wordAt()!);
    await screen.findByRole("dialog", { name: "词详情：Woke" });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.queryByRole("dialog", { name: "词详情：Woke" })).toBeNull();
    // The new page's overlay carries a fresh word; a zoom dismisses too.
    await waitFor(() => expect(wordAt()).not.toBeNull());
    fireEvent.click(wordAt()!);
    await screen.findByRole("dialog", { name: "词详情：Woke" });
    fireEvent.click(screen.getByRole("button", { name: "150%" }));
    expect(screen.queryByRole("dialog", { name: "词详情：Woke" })).toBeNull();
  });

  // mobile-bookmark-defects 缺陷 1 (PDF face): the open used to wipe the
  // shared snapshot, so an open (or a close before the open's read landed
  // — teardown invalidates that read's ticket) blanked the page marks for
  // good while the store still held them.
  it("a slow panel read never blanks the page marks, on open or on close", async () => {
    const inner = createMemoryBookmarkStore();
    const docId = await id();
    const planted = await inner.add(docId, { page: 1, line: 0, text: "Woke" });
    let calls = 0;
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const bookmarks: BookmarkStore = {
      list: () => {
        calls += 1;
        // Call 1 is the mount read (lands fresh, drives the marks); call
        // 2 is the OPEN's read — gated until the test releases it, by
        // which time the panel has closed. Its answer carries an extra
        // bogus page-3 row so any adoption would be visible.
        return calls === 2
          ? openGate.then(() => [
              planted,
              {
                id: 999,
                page: 3,
                line: 9,
                text: "stale",
                createdAt: "2026-11-11T00:00:00.000Z",
              },
            ])
          : inner.list(docId);
      },
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
      exportAll: () => inner.exportAll(),
    };
    mount(bookmarks);
    await pick();
    // The mount read landed and the page rendered: the mark shows.
    await waitFor(() =>
      expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull()
    );

    await openPanel();
    // The plant lock is the pending signal (the mounted snapshot's rows
    // stay listed — no spinner swap since the review fixes).
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "在当前位置打书签" })
      ).toBeDisabled()
    );
    // The open's read hangs; the mark must survive the open itself.
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    // The abandoned read cannot blank the face: the store still holds it.
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();

    // The late answer is stale (teardown invalidated its ticket): the
    // reopened panel's own read speaks, and the bogus row is nowhere.
    releaseOpen();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await openPanel();
    expect(
      await screen.findByRole("button", { name: /^第 1 页/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^第 3 页/ })).toBeNull();
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();
  });

  it("a failed panel read keeps the page marks and the rows listed", async () => {
    const inner = createMemoryBookmarkStore();
    const docId = await id();
    await inner.add(docId, { page: 1, line: 0, text: "Woke" });
    let calls = 0;
    const bookmarks: BookmarkStore = {
      list: () => {
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
    mount(bookmarks);
    await pick();
    await waitFor(() =>
      expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull()
    );

    await openPanel();
    const dialog = screen.getByRole("dialog", { name: "书签" });
    // The flag speaks; the wait line retires; the last landed rows stay
    // listed under it — the snapshot is the panel's fallback truth.
    const flag = await within(dialog).findByRole("alert");
    expect(flag.textContent).toContain("书签操作失败");
    expect(within(dialog).queryByText(/读取书签中/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /^第 1 页/ })
    ).toBeInTheDocument();

    // The failed refetch must not have blanked the face on close.
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(document.querySelector(".pdf-bookmark-mark")).not.toBeNull();
  });
});

// Evidence gap ⑨'s shell half: the shell's height pins to the LAYOUT
// viewport's clientHeight (never innerHeight — the ICB sits shorter) and
// re-pins on resize. jsdom reports 0 for both, so the numbers ride a
// mocked getter — the mutant "switch to innerHeight" reads a different
// value, and "drop the resize listener" leaves the stale one.
describe("PDF shell height (evidence gap ⑨)", () => {
  it("pins --shell-h to clientHeight and re-pins on resize", async () => {
    const docEl = document.documentElement;
    const original = Object.getOwnPropertyDescriptor(docEl, "clientHeight");
    Object.defineProperty(docEl, "clientHeight", {
      get: () => 700,
      configurable: true,
    });
    try {
      mount();
      await pick();
      // waitFor: prior tests in this file leave their own --shell-h
      // ("0px", jsdom's real clientHeight) — this mount's apply() must
      // overwrite it; the wait rides the commit window under load.
      await waitFor(
        () => expect(docEl.style.getPropertyValue("--shell-h")).toBe("700px"),
        { timeout: 3000 }
      );

      Object.defineProperty(docEl, "clientHeight", {
        get: () => 800,
        configurable: true,
      });
      window.dispatchEvent(new Event("resize"));
      // Full-suite-load patience (the effect commit can lag seconds
      // under a saturated worker — the 2026-11-13/15 flake window).
      await waitFor(
        () => expect(docEl.style.getPropertyValue("--shell-h")).toBe("800px"),
        { timeout: 3000 }
      );
    } finally {
      if (original) Object.defineProperty(docEl, "clientHeight", original);
      else delete (docEl as { clientHeight?: number }).clientHeight;
      docEl.style.removeProperty("--shell-h");
    }
  });
});

// The A-2 review's findings on the PDF face: the no-snapshot failure
// branch and the retry-race op lock (same shape as the EPUB fixes).
describe("PDF face bookmarks — 评审修笔 (A-2 review)", () => {
  it("a failure with no landed snapshot shows the flag alone — no wait line", async () => {
    const inner = createMemoryBookmarkStore();
    const bookmarks: BookmarkStore = {
      list: () => Promise.reject(new Error("idb down")),
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
      exportAll: () => inner.exportAll(),
    };
    mount(bookmarks);
    await pick();
    await openPanel();
    const flag = await screen.findByRole("alert");
    expect(flag.textContent).toContain("书签操作失败");
    expect(screen.queryByText(/读取书签中/)).toBeNull();
  });

  it("row ops stay locked while a retry's refetch is in flight", async () => {
    const inner = createMemoryBookmarkStore();
    const docId = await id();
    await inner.add(docId, { page: 1, line: 0, text: "Woke" });
    let calls = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const bookmarks: BookmarkStore = {
      list: () => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error("idb read died"));
        if (calls === 3) return retryGate.then(() => inner.list(docId));
        return inner.list(docId);
      },
      add: (docId, target) => inner.add(docId, target),
      remove: (docId, id) => inner.remove(docId, id),
      exportAll: () => inner.exportAll(),
    };
    mount(bookmarks);
    await pick();
    await openPanel();
    // The open's read failed: flag speaks, the mount snapshot's row
    // stays listed.
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: /^第 1 页/ })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试读取书签" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^删除书签：第 1 页/ })
      ).toBeDisabled()
    );
    expect(
      screen.getByRole("button", { name: "在当前位置打书签" })
    ).toBeDisabled();

    releaseRetry();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^删除书签：第 1 页/ })
      ).toBeEnabled()
    );
  });
});
