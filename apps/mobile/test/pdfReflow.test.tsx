import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PICKER_LABEL, dismissMenu, summonMenu } from "./reader-picker";
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
import {
  createMemoryUiSettingsStore,
  type UiSettingsStore,
} from "../src/store/ui-settings-store";
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

// The line read's fault injector (retry-wiring test): the face's read
// counts its calls so the test can prove 重试读取 actually re-armed it.
let lineReadCalls = 0;
let failLineRead = false;

function session(): pdf.PdfSession {
  return {
    title: "Same title",
    pageCount: 3,
    doc: {
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => {
          lineReadCalls += 1;
          if (failLineRead) throw new Error("getTextContent died");
          return { items: pageItems() };
        }),
        cleanup: vi.fn(),
      })),
    } as unknown as pdf.PdfSession["doc"],
  };
}

beforeEach(() => {
  lineReadCalls = 0;
  failLineRead = false;
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
  positions: PdfPositionStore = createMemoryPdfPositionStore(),
  uiSettings: UiSettingsStore = createMemoryUiSettingsStore(),
  pdfNotes = createMemoryPdfNotesStore()
) {
  const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
  const tree = () => (
    <ReaderPage
      store={vocab}
      library={createMemoryLibraryStore()}
      notes={createMemoryNotesStore()}
      pdfNotes={pdfNotes}
      pdfPositions={positions}
      pdfBytes={bytes}
      translations={createMemoryTranslationStore()}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={bookmarks}
      uiSettings={uiSettings}
    />
  );
  return {
    view: render(tree()),
    tree,
    bookmarks,
    positions,
    uiSettings,
    pdfNotes,
  };
}

async function pick() {
  fireEvent.change(screen.getByLabelText(PICKER_LABEL), {
    target: { files: [new File([source()], "same.pdf")] },
  });
  await waitFor(() =>
    expect(document.querySelector("main.reader-shell")).not.toBeNull()
  );
}

async function reflow() {
  await summonMenu();
  fireEvent.click(screen.getByRole("button", { name: "重排" }));
  await screen.findByText("Woke");
}

// jsdom's attribute selectors match values case-insensitively (nwsapi);
// exact-name queries narrow with the selector then compare getAttribute
// (CODING_STANDARDS: exact-name attribute assertions; evidence gap ⑪).
const wordEl = (name: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>("[data-word]")].find(
    (el) => el.getAttribute("data-word") === name
  ) ?? null;

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
    // Paragraph-flow shape (round 18): one block per PARAGRAPH, its
    // lines flowing as inline spans — the browser wraps them naturally
    // instead of hard-breaking at the PDF's line ends.
    expect(
      document.querySelectorAll(".pdf-reflow .sentence-block")
    ).toHaveLength(1);
    expect(document.querySelectorAll(".pdf-reflow-line")).toHaveLength(2);
    // The fixture's two lines ride the same body leading — one
    // paragraph, closed by its last line's para-end.
    const block = document.querySelector(".pdf-reflow .sentence-block")!;
    expect(block).toHaveClass("para-end");
    // ⑨d: the flow stays a flow — line carriers are inline SPANs, and
    // the stylesheet never block-ifies them (a display:block on the
    // class would chop the paragraph back into hard lines).
    const carriers = [...document.querySelectorAll(".pdf-reflow-line")];
    expect(carriers.length).toBeGreaterThanOrEqual(2);
    expect(carriers.every((el) => el.tagName === "SPAN")).toBe(true);
    const reflowCss = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../src/reader/reader.css"
      ),
      "utf8"
    );
    expect(reflowCss).not.toMatch(
      /\.pdf-reflow-line[^{]*\{[^}]*display:\s*block/
    );
    // ⑨/A-5 review: the paragraph pen pins to its block's corner; the
    // line pens stay in the TEXT FLOW — the absolute-position override
    // must scope to the block's direct child only (the wide selector
    // would yank every inline pen out of the flow and stack them).
    expect(reflowCss).toMatch(
      /\.pdf-reflow \.sentence-block > \.block-note-button\s*\{[^}]*position:\s*absolute/
    );
    expect(reflowCss).not.toMatch(/\.pdf-reflow \.block-note-button\s*\{/);
    // Tapping a word opens the same lookup popup seam.
    fireEvent.click(screen.getByText("Woke"));
    await screen.findByRole("dialog", { name: "词详情：Woke" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  });

  it("返回 goes back to the shelf (round 12)", async () => {
    mount();
    await pick();
    await reflow();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByLabelText(PICKER_LABEL)).toBeInTheDocument();
  });

  it("long-pressing a word plants the mark on its line, marked block shows", async () => {
    const ctx = mount();
    await pick();
    await reflow();
    const wordAt = () => wordEl("Woke");
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
    // The release's click is swallowed by the long press: dispatching it
    // must NOT open the popup (deleting the suppression reds here).
    fireEvent.click(wordAt()!);
    expect(screen.queryByRole("dialog", { name: "词详情：Woke" })).toBeNull();
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

  // mobile-pdf-reflow-defects 缺陷 1: the pen used to open the paragraph's
  // FIRST line blind — a mid-paragraph note showed 编辑笔记 over a blank
  // editor (the 终审 probe reproduced it on the second line). The landed
  // design: the paragraph pen writes the HEAD line (fresh-write entry),
  // every other NOTED line keeps its own inline pen (the abandoned
  // point-at-first-match shape stole the head's fresh-write entry).
  it("the pen opens the noted line, and mid-paragraph notes stay reachable", async () => {
    const { pdfNotes } = mount();
    const docId = await id();
    // The fixture's paragraph is two lines; the note sits on the SECOND.
    await pdfNotes.save(
      {
        type: "progress",
        docId,
        page: 1,
        lineIndex: 1,
        lineText: "Second line here",
      },
      "第二行存量笔记"
    );
    await pick();
    await reflow();

    const pen = screen.getByRole("button", { name: "编辑笔记" });
    fireEvent.click(pen);
    expect(screen.getByRole("dialog", { name: "行笔记" })).toBeInTheDocument();
    // The editor opened on the NOTED line: the seeded text loads (the
    // mutant opens line 0 and the box comes up empty).
    expect(screen.getByRole("textbox")).toHaveValue("第二行存量笔记");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    // Saving through the pen keeps the mid-line anchor (not the head).
    fireEvent.click(screen.getByRole("button", { name: "编辑笔记" }));
    fireEvent.click(screen.getByRole("tab", { name: "感受" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "段中补记" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    const notes = await pdfNotes.list(docId);
    expect(notes.find((note) => note.text === "段中补记")?.lineIndex).toBe(1);
  });

  // 缺陷 2: a note whose lineText drifted (re-imported PDF, line text
  // changed) used to open by page+lineIndex alone and save back with the
  // CURRENT line text — re-stamping the stale anchor. The canvas face's
  // drift guard: the pen locks, the alert names the preserved rows.
  it("a drifted note is preserved and locked: no pen opens it, an alert says so", async () => {
    const { pdfNotes } = mount();
    const docId = await id();
    await pdfNotes.save(
      {
        type: "progress",
        docId,
        page: 1,
        lineIndex: 0,
        lineText: "漂移前的旧行文本",
      },
      "错锚旧笔记"
    );
    await pick();
    await reflow();

    // The pen names the note (its target line carries one) but the
    // anchor is stale: disabled, and no editor opens.
    const pen = screen.getByRole("button", { name: "编辑笔记" });
    expect(pen).toBeDisabled();
    expect(screen.getByText(/已有笔记与本页行文本不符/)).toBeInTheDocument();
    fireEvent.click(pen);
    expect(screen.queryByRole("dialog", { name: "行笔记" })).toBeNull();
    // The drifted row survives untouched.
    const notes = await pdfNotes.list(docId);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.lineText).toBe("漂移前的旧行文本");
  });

  // 缺陷 3: 重试读取 only bumped `attempt` while the read effect ignored
  // it (stable owner identity) — the probe's call count stayed at 1.
  it("重试读取 re-arms the failed line read", async () => {
    mount();
    await pick();
    failLineRead = true;
    await summonMenu();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "重排" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("页面文本读取失败");
    expect(lineReadCalls).toBe(1);

    failLineRead = false;
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    // The re-read lands: lines render, the alert retires.
    expect(await screen.findByText("Woke")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(lineReadCalls).toBe(2);
  });

  // 缺陷 4: the notes read's `failed` was dropped — every pen disabled
  // forever with no hint. The canvas face's failure channel, mirrored.
  it("a failed notes read surfaces its own alert with a working retry", async () => {
    const inner = createMemoryPdfNotesStore();
    let failList = true;
    const pdfNotes: typeof inner = {
      ...inner,
      list: (docId) =>
        failList
          ? Promise.reject(new Error("pdf notes read died"))
          : inner.list(docId),
    };
    mount(
      createMemoryBookmarkStore(),
      createMemoryPdfPositionStore(),
      createMemoryUiSettingsStore(),
      pdfNotes
    );
    await pick();
    await reflow();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("笔记读取失败");
    // The pens cannot confirm existing notes: disabled while failed.
    expect(
      screen.getAllByRole("button", { name: "写笔记" })[0]!
    ).toBeDisabled();

    failList = false;
    fireEvent.click(screen.getByRole("button", { name: "重试读取笔记" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getAllByRole("button", { name: "写笔记" })[0]!).toBeEnabled();
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
    const wordAt = () => wordEl("Second");
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
    await dismissMenu();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await summonMenu();
    await waitFor(() =>
      expect(document.querySelector(".reader-menu-progress")).toHaveTextContent(
        "2 / 3"
      )
    );
    // ⑨e: observe the jump's scroll — jsdom has no scrollIntoView, so
    // the optional call is pinned through a recording stub.
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
      fireEvent.click(screen.getByRole("button", { name: "书签" }));
      await screen.findByRole("dialog", { name: "书签" });
      fireEvent.click(screen.getByRole("button", { name: /^第 1 页/ }));
      await summonMenu();
      await waitFor(() =>
        expect(
          document.querySelector(".reader-menu-progress")
        ).toHaveTextContent("1 / 3")
      );
      expect(
        document.querySelector(".sentence-block.block-marked")
      ).not.toBeNull();
      await waitFor(() => expect(seen.length).toBeGreaterThan(0), {
        timeout: 3000,
      });
      // The planted line (1) centered — not the page top.
      expect(seen[seen.length - 1]!.dataset.pdfLineIndex).toBe("1");
      expect(calls[calls.length - 1]).toEqual([{ block: "center" }]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  // ⑨e: the zoom ladder belongs to the canvas face — the reflow text
  // has no scale geometry to step (round 11), so the ladder hides there.
  it("the zoom ladder is canvas-only", async () => {
    mount();
    await pick();
    await summonMenu();
    expect(screen.getByRole("button", { name: "适宽" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await reflow();
    expect(screen.queryByRole("button", { name: "适宽" })).toBeNull();
    expect(screen.queryByRole("button", { name: "75%" })).toBeNull();
    expect(screen.queryByRole("button", { name: "150%" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "原版" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "适宽" })).toBeInTheDocument()
    );
  });
});

// The A-5 review's P1: a side line holding BOTH a matching note and a
// drifted one (same lineIndex, stale lineText, another type) used to
// keep its inline pen enabled — opening it and saving on the drifted
// type's tab would upsert by (page, lineIndex, type) and re-stamp the
// old note with the current line's text. Any drift on the line locks
// its pen, exactly like the head's.
it("a side line with mixed matched and drifted notes locks its pen", async () => {
  const { pdfNotes } = mount();
  const docId = await id();
  // Line 1 (the paragraph's second line): a matching progress note …
  await pdfNotes.save(
    {
      type: "progress",
      docId,
      page: 1,
      lineIndex: 1,
      lineText: "Second line here",
    },
    "匹配锚的进度"
  );
  // … and a drifted feeling note under the SAME lineIndex.
  await pdfNotes.save(
    {
      type: "feeling",
      docId,
      page: 1,
      lineIndex: 1,
      lineText: "漂移前的旧行文本",
    },
    "错锚旧感受"
  );
  await pick();
  await reflow();

  // The drift alert fires (a note matches no rendered line text) …
  expect(screen.getByText(/已有笔记与本页行文本不符/)).toBeInTheDocument();
  // … and the side line's pen is LOCKED: no editor can open to save
  // over the drifted entry. The head's pen stays writable (its line
  // carries no mismatched note).
  const pens = screen.getAllByRole("button", { name: "编辑笔记" });
  expect(pens).toHaveLength(1);
  const sidePen = pens[0]!;
  expect(sidePen).toBeDisabled();
  fireEvent.click(sidePen);
  expect(screen.queryByRole("dialog", { name: "行笔记" })).toBeNull();
  // The drifted row survives untouched.
  const notes = await pdfNotes.list(docId);
  expect(notes.find((note) => note.text === "错锚旧感受")?.lineText).toBe(
    "漂移前的旧行文本"
  );
});

describe("PDF 页码面板与边缘边界 (redesign 02, Codex 评审)", () => {
  it("the page panel clamps out-of-range drafts and jumps on 跳转", async () => {
    mount();
    await pick();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "页码" }));
    const input = await screen.findByRole("spinbutton", { name: "页码" });
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "跳转" }));
    await summonMenu();
    expect(document.querySelector(".reader-menu-progress")).toHaveTextContent(
      "3 / 3"
    );
  });

  it("the edge strips disable at the book's ends", async () => {
    mount();
    await pick();
    await dismissMenu();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    await summonMenu();
    expect(document.querySelector(".reader-menu-progress")).toHaveTextContent(
      "3 / 3"
    );
  });
});
