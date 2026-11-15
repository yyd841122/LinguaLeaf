import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import { ReaderPage } from "../src/reader/ReaderPage";
import * as pdf from "../src/reader/pdf";
import { pdfFingerprint } from "../src/store/pdf-fingerprint";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import {
  createMemoryPdfPositionStore,
  type PdfPositionStore,
} from "../src/store/pdf-position-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import {
  createMemoryBookmarkStore,
  type BookmarkStore,
} from "../src/store/bookmark-store";
import { createMemoryTranslateSettingsStore } from "../src/store/translate-settings-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
import type { VocabularyStore } from "../src/store/vocabulary-store";

// The reflow reading face (mobile-app ticket 03, 人验 round 7): the
// page's visual lines rendered as the kernel's EPUB-shaped blocks —
// ipa-word bands, per-line notes and line-level bookmarks sharing the
// same anchors as the canvas face, the chosen face persisted with the
// position. The canvas face stays one 原版 toggle away.

const vocab: VocabularyStore = {
  stateKey: (word) => word.toLowerCase(),
  async lookup(word) {
    return word === "Woke"
      ? {
          word,
          lemma: "wake",
          ipa: "woʊk",
          pos: null,
          translation: null,
          status: "learning",
        }
      : null;
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

const item = (str: string, x: number, y: number, width: number): TextItem => ({
  str,
  dir: "ltr",
  transform: [12, 0, 0, 12, x, y],
  width,
  height: 12,
  fontName: "font",
  hasEOL: true,
});

// Line 0's second item rides the 0.18-fontPx gap — the dropped-space
// recovery from round 2 reassembles "Woke on the page".
const pageItems = (): TextItem[] => [
  item("Woke on the", 40, 300, 160),
  item("page", 202.16, 300, 30),
  item("Second line here", 40, 260, 200),
];

function session(): pdf.PdfSession {
  return {
    title: "Same title",
    pageCount: 3,
    doc: {
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => ({ items: pageItems() })),
        cleanup: vi.fn(),
      })),
    } as unknown as pdf.PdfSession["doc"],
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("dictionary.json")) {
        return {
          ok: true,
          json: async () => ({
            ipa: { woke: "woʊk" },
            entries: {},
            inflections: {},
          }),
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
    return { wordCount: 0, ipaCount: 0, lines: [] };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(
  bookmarks: BookmarkStore = createMemoryBookmarkStore(),
  positions: PdfPositionStore = createMemoryPdfPositionStore()
) {
  const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
  const tree = () => (
    <ReaderPage
      store={vocab}
      library={createMemoryLibraryStore()}
      notes={createMemoryNotesStore()}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={positions}
      pdfBytes={bytes}
      translations={createMemoryTranslationStore()}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={bookmarks}
    />
  );
  return { view: render(tree()), tree, bookmarks, positions };
}

async function pick() {
  fireEvent.change(screen.getByLabelText("选择 EPUB 或 PDF 文件"), {
    target: { files: [new File([source()], "same.pdf")] },
  });
  await screen.findByRole("heading", { name: "Same title" });
}

async function reflow() {
  fireEvent.click(screen.getByRole("button", { name: "重排" }));
  await screen.findByText("Woke");
}

describe("PDF reflow face (round 7)", () => {
  it("renders the page's lines as EPUB-shaped text with IPA bands", async () => {
    mount();
    await pick();
    await reflow();
    // Woke carries an IPA band; the un-dict'd words stay lookup targets.
    expect(document.querySelectorAll(".ipa-word")).toHaveLength(1);
    expect(document.querySelectorAll(".lookup-word")).toHaveLength(6);
    expect(document.querySelector(".ipa-word-ipa")).toHaveAttribute(
      "data-ipa",
      "woʊk"
    );
    // The kernel line/block shape, one block per visual line.
    expect(
      document.querySelectorAll(".pdf-reflow .sentence-block")
    ).toHaveLength(2);
    // Tapping a word opens the same lookup popup seam.
    fireEvent.click(screen.getByText("Woke"));
    await screen.findByRole("dialog", { name: "词详情：Woke" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("long-pressing a word plants the mark on its line, marked block shows", async () => {
    const ctx = mount();
    await pick();
    await reflow();
    const wordAt = () =>
      document.querySelector<HTMLElement>("[data-word='Woke']");
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
    expect(await ctx.bookmarks.list(docId)).toEqual([
      expect.objectContaining({ page: 1, line: 0, text: "Woke on the page" }),
    ]);
    expect(
      document.querySelector(".sentence-block.block-marked")
    ).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "词详情：Woke" })).toBeNull();
  });

  it("writes a per-line note through the same anchors as the canvas face", async () => {
    const ctx = mount();
    await pick();
    await reflow();
    fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[0]!);
    expect(screen.getByRole("dialog", { name: "行笔记" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "进度" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "进度正文" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getAllByRole("button", { name: "编辑笔记" })).toHaveLength(1);
    const docId = await id();
    expect(await ctx.bookmarks.list(docId)).toHaveLength(0);
  });

  it("persists the chosen face with the position and flips back to canvas", async () => {
    const ctx = mount();
    await pick();
    await reflow();
    await waitFor(() =>
      expect(ctx.positions.getRecent()).resolves.toMatchObject({
        view: "reflow",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "原版" }));
    await waitFor(() =>
      expect(document.querySelector(".pdf-stage")).not.toBeNull()
    );
    expect(document.querySelector(".pdf-reflow")).toBeNull();
    await waitFor(() =>
      expect(ctx.positions.getRecent()).resolves.toMatchObject({
        view: "canvas",
      })
    );
  });

  it("jumps back to the planted line from the panel", async () => {
    mount();
    await pick();
    await reflow();
    const wordAt = () =>
      document.querySelector<HTMLElement>("[data-word='Second']");
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
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(document.querySelector(".reader-position")).toHaveTextContent(
        "2 / 3"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "书签" }));
    await screen.findByRole("dialog", { name: "书签" });
    fireEvent.click(screen.getByRole("button", { name: /^第 1 页/ }));
    await waitFor(() =>
      expect(document.querySelector(".reader-position")).toHaveTextContent(
        "1 / 3"
      )
    );
    expect(
      document.querySelector(".sentence-block.block-marked")
    ).not.toBeNull();
  });
});
