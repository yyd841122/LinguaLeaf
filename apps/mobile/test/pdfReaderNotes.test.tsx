import { NOTE_TYPES, type NoteType } from "../../server/src/wire";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import { ReaderPage } from "../src/reader/ReaderPage";
import * as pdf from "../src/reader/pdf";
import { pdfFingerprint } from "../src/store/pdf-fingerprint";
import {
  createMemoryPdfNotesStore,
  createPdfNotesStore,
  type PdfNote,
} from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
import type { VocabularyStore } from "../src/store/vocabulary-store";

const vocab: VocabularyStore = {
  stateKey: (word) => word.toLowerCase(),
  async lookup() {
    return null;
  },
  async statesFor() {
    return new Map();
  },
  async setStatus() {},
};
const source = (tail = "A") => `%PDF-1.7 common head and pages ${tail}`;
const id = (tail = "A") =>
  pdfFingerprint(new TextEncoder().encode(source(tail)).buffer);
const lineText = (page = 1) => `Page ${page} first line.`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ipa: {}, entries: {}, inflections: {} }),
    }))
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(pdf, "openPdf").mockImplementation(async () => session());
  vi.spyOn(pdf, "sampleTextLengths").mockResolvedValue([120]);
  vi.spyOn(pdf, "renderPdfPage").mockImplementation(
    async (_, overlay, _doc, page, _scale, _lookup, showIpa) => {
      pdf.clearPdfOverlay(overlay);
      for (let index = 0; index < 2; index++) {
        const word = document.createElement("span");
        word.dataset.pdfWord = "Words";
        word.dataset.word = "Words";
        word.setAttribute("role", "button");
        word.tabIndex = 0;
        word.textContent = "Words";
        if (showIpa) {
          const ipa = document.createElement("span");
          ipa.className = "pdf-ipa";
          word.appendChild(ipa);
        }
        overlay.appendChild(word);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.pdfNote = String(index);
        button.dataset.lineText = index === 0 ? lineText(page) : "Second line.";
        button.className = "pdf-note-button";
        button.disabled = true;
        button.setAttribute("aria-label", "写笔记");
        overlay.appendChild(button);
      }
      return { wordCount: 2, ipaCount: showIpa ? 2 : 0 };
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as { storage?: unknown }).storage;
});
function mount(
  notes = createMemoryPdfNotesStore(),
  positions = createMemoryPdfPositionStore(),
  library = createMemoryLibraryStore(),
  bytes = createPdfBytesStore(createMemoryPdfBytesBackend())
) {
  const tree = () => (
    <ReaderPage
      store={vocab}
      library={library}
      notes={createMemoryNotesStore()}
      pdfNotes={notes}
      pdfPositions={positions}
      pdfBytes={bytes}
    />
  );
  return { view: render(tree()), tree, notes, positions, library, bytes };
}
async function pick(tail = "A") {
  fireEvent.change(screen.getByLabelText("选择 EPUB 或 PDF 文件"), {
    target: { files: [new File([source(tail)], "same.pdf")] },
  });
  await screen.findByRole("heading", { name: "Same title" });
}
async function enabled() {
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: /写笔记|编辑笔记/ })[0]
    ).toBeEnabled()
  );
}
function openNote() {
  fireEvent.click(
    screen.getAllByRole("button", { name: /写笔记|编辑笔记/ })[0]!
  );
  expect(screen.getByRole("dialog", { name: "行笔记" })).toBeInTheDocument();
  return screen.getByRole("textbox", { name: "笔记正文" });
}
function text(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}
async function save(value: string) {
  openNote();
  text(value);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("status")).toHaveTextContent("已存");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
}
function reopen() {
  fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
}

describe("PDF line notes, reattachment and position", () => {
  it("keeps same-line sibling types through deletion, reopen, overlay rebuild and reload", async () => {
    const ctx = mount();
    await pick();
    await enabled();
    openNote();
    for (const label of ["进度", "感受", "思路", "疑问"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      text(`${label}正文`);
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByRole("status")).toHaveTextContent("已存");
    }
    expect(await ctx.notes.list(await id())).toHaveLength(4);
    fireEvent.click(screen.getByRole("tab", { name: "思路" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已删除");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    const assertSiblings = () => {
      expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
        "has-note"
      );
      openNote();
      for (const label of ["进度", "感受", "疑问"]) {
        fireEvent.click(screen.getByRole("tab", { name: label }));
        expect(screen.getByRole("textbox")).toHaveValue(`${label}正文`);
      }
      fireEvent.click(screen.getByRole("tab", { name: "思路" }));
      expect(screen.getByRole("textbox")).toHaveValue("");
      expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    };
    assertSiblings();
    fireEvent.click(screen.getByRole("button", { name: "150%" }));
    await enabled();
    assertSiblings();
    ctx.view.unmount();
    render(ctx.tree());
    await pick();
    await enabled();
    assertSiblings();
    expect((await ctx.notes.list(await id())).map((note) => note.type)).toEqual(
      ["progress", "feeling", "question"]
    );
  });

  it.each([
    { lines: [], lit: false, disabled: false, drift: false },
    { lines: ["match"], lit: true, disabled: false, drift: false },
    { lines: ["drift"], lit: false, disabled: true, drift: true },
    { lines: ["match", "drift"], lit: true, disabled: true, drift: true },
    { lines: ["drift", "match"], lit: true, disabled: true, drift: true },
  ])(
    "computes PDF highlight, disabled and drift independently: $lines",
    async ({ lines, lit, disabled, drift }) => {
      const notes = createMemoryPdfNotesStore();
      for (const [index, value] of lines.entries()) {
        const type: NoteType = index === 0 ? "progress" : "question";
        await notes.save(
          {
            docId: await id(),
            page: 1,
            lineIndex: 0,
            lineText: value === "match" ? lineText() : "Old text",
            type,
          },
          value
        );
      }
      const before = await notes.list(await id());
      mount(notes);
      await pick();
      // The untouched second line becomes enabled only after render AND read settle.
      await waitFor(() =>
        expect(document.querySelectorAll("[data-pdf-note]")[1]).toBeEnabled()
      );
      const first = document.querySelectorAll("[data-pdf-note]")[0]!;
      expect(first.classList.contains("has-note")).toBe(lit);
      expect(first.hasAttribute("disabled")).toBe(disabled);
      if (drift)
        expect(screen.getByRole("alert")).toHaveTextContent(
          "已保留原笔记，未回挂不符条目"
        );
      else expect(screen.queryByRole("alert")).toBeNull();
      expect(await notes.list(await id())).toEqual(before);
    }
  );

  it("hashes before pdf.js can detach the bytes, and leaves an unannotated file without a notes record", async () => {
    const bag: Record<string, unknown> = {};
    const notes = createPdfNotesStore({
      async get() {
        return structuredClone(bag);
      },
      async set(next) {
        Object.assign(bag, structuredClone(next));
      },
    });
    vi.mocked(pdf.openPdf).mockImplementation(async (bytes) => {
      structuredClone(bytes, { transfer: [bytes] });
      return session();
    });
    mount(notes);
    await pick();
    await enabled();
    expect(bag).toEqual({});
    await save("Identity survives transfer");
    expect(await notes.list(await id())).toMatchObject([
      { text: "Identity survives transfer" },
    ]);
  });

  it("silently reattaches the same bytes and keeps same-title A→B→A notes and positions independent", async () => {
    const { notes, positions } = mount();
    await pick();
    await enabled();
    await save("A first page");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await enabled();
    fireEvent.click(screen.getByRole("button", { name: "150%" }));
    await enabled();
    await save("A second page");
    reopen();
    await pick("B");
    await enabled();
    expect(document.querySelector(".reader-position")).toHaveTextContent(
      "1 / 3"
    );
    expect(screen.getByRole("button", { name: "100%" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("button", { name: "编辑笔记" })).toBeNull();
    await save("B first page");
    fireEvent.click(screen.getByRole("button", { name: "75%" }));
    await enabled();
    reopen();
    await pick();
    await enabled();
    expect(document.querySelector(".reader-position")).toHaveTextContent(
      "2 / 3"
    );
    expect(screen.getByRole("button", { name: "150%" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(openNote()).toHaveValue("A second page");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(await notes.list(await id())).toHaveLength(2);
    expect(await notes.list(await id("B"))).toHaveLength(1);
    expect(await positions.getPosition(await id("B"))).toMatchObject({
      page: 1,
      scale: 0.75,
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("restores markers after zoom/IPA rebuild and preserves explicit deletion and empty-text rules", async () => {
    const { notes } = mount();
    await pick();
    await enabled();
    await save("Keep marker");
    for (const action of ["150%", "音标", "音标", "75%"]) {
      const old = document.querySelector("[data-pdf-note]")!;
      fireEvent.click(screen.getByRole("button", { name: action }));
      await enabled();
      expect(old.isConnected).toBe(false);
      expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
        "has-note"
      );
      expect(document.querySelectorAll("[data-pdf-note]")).toHaveLength(2);
    }
    const input = openNote();
    expect(input).toHaveFocus();
    text("   ");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已删除");
    expect(await notes.list(await id())).toEqual([]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("button", { name: "写笔记" })[0]).toHaveFocus();
  });

  it("fails visibly, disables editing and retries notes reads without automatic retry", async () => {
    const notes = createMemoryPdfNotesStore();
    await notes.save(
      {
        type: "progress",
        docId: await id(),
        page: 1,
        lineIndex: 0,
        lineText: lineText(),
      },
      "Existing"
    );
    const list = notes.list.bind(notes);
    notes.list = vi
      .fn()
      .mockRejectedValueOnce(new Error("read"))
      .mockImplementation(list);
    mount(notes);
    await pick();
    expect(await screen.findByRole("alert")).toHaveTextContent("笔记读取失败");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "写笔记" })).toHaveLength(2)
    );
    expect(
      screen
        .getAllByRole("button", { name: "写笔记" })
        .every((b) => b.hasAttribute("disabled"))
    ).toBe(true);
    expect(notes.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重试读取笔记" }));
    await enabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(openNote()).toHaveValue("Existing");
  });

  it("preserves mismatched or missing anchors and reports extraction drift", async () => {
    const notes = createMemoryPdfNotesStore();
    await notes.save(
      {
        type: "progress",
        docId: await id(),
        page: 1,
        lineIndex: 0,
        lineText: "Old extraction",
      },
      "Do not delete"
    );
    await notes.save(
      {
        type: "progress",
        docId: await id(),
        page: 1,
        lineIndex: 8,
        lineText: "Missing line",
      },
      "Also keep"
    );
    mount(notes);
    await pick();
    expect(await screen.findByRole("alert")).toHaveTextContent("已保留原笔记");
    expect(screen.getByRole("button", { name: "编辑笔记" })).toBeDisabled();
    expect(await notes.list(await id())).toHaveLength(2);
  });

  it.each([
    "下一页",
    "150%",
    "音标",
    "打开其他文件",
    "关闭",
    "Escape",
    "另一行",
    "浮层外",
  ])("uses the same dirty confirmation for %s", async (action) => {
    mount();
    await pick();
    await enabled();
    openNote();
    fireEvent.click(screen.getByRole("tab", { name: "疑问" }));
    text("Draft");
    fireEvent.click(screen.getByRole("tab", { name: "进度" }));
    const perform = () => {
      if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else if (action === "另一行")
        fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[1]!);
      else if (action === "浮层外")
        fireEvent.click(document.querySelector("canvas")!);
      else fireEvent.click(screen.getByRole("button", { name: action }));
    };
    perform();
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith("放弃修改？");
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.click(screen.getByRole("tab", { name: "疑问" }));
    expect(screen.getByRole("textbox")).toHaveValue("Draft");
    fireEvent.click(screen.getByRole("tab", { name: "进度" }));
    expect(document.querySelector(".reader-position")).toHaveTextContent(
      "1 / 3"
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    perform();
    expect(window.confirm).toHaveBeenCalledTimes(2);
    if (action === "另一行")
      expect(screen.getByRole("textbox")).toHaveValue("");
    else expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps quota/overlength/100-note drafts for retry, including failed deletes", async () => {
    const notes = createMemoryPdfNotesStore();
    const write = notes.save.bind(notes);
    notes.save = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(write);
    mount(notes);
    await pick();
    await enabled();
    openNote();
    text("Retry me");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已保留");
    expect(screen.getByRole("textbox")).toHaveValue("Retry me");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    text("x".repeat(10001));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    );
    expect(screen.getByRole("textbox")).toHaveValue("x".repeat(10001));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const remove = notes.delete.bind(notes);
    notes.delete = vi
      .fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(remove);
    text("Delete draft");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已保留");
    expect(screen.getByRole("textbox")).toHaveValue("Delete draft");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已删除");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    for (let index = 0; index < 100; index++)
      await write(
        {
          type: NOTE_TYPES[index % 4]!,
          docId: await id(),
          page: 2,
          lineIndex: index,
          lineText: "Other page",
        },
        "Existing"
      );
    openNote();
    text("At capacity");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("100 条");
    expect(screen.getByRole("textbox")).toHaveValue("At capacity");
    await notes.delete({
      type: "question",
      docId: await id(),
      page: 2,
      lineIndex: 99,
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
  });

  it("preserves the legacy no-bytes hint beside EPUB recents across remount, and drops drafts", async () => {
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "doc:EPUB",
      title: "EPUB",
      book: { title: "EPUB", chapters: [] },
    });
    const ctx = mount(undefined, undefined, library);
    await pick();
    await enabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await enabled();
    openNote();
    text("Unsaved");
    ctx.view.unmount();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await ctx.notes.list(await id())).toEqual([]);
    // Simulate a legacy session whose bytes were never cached.
    await ctx.bytes.delete(await id());
    render(ctx.tree());
    expect(await screen.findByLabelText("最近 PDF 会话")).toHaveTextContent(
      "《Same title》第 2 页——选同一个文件继续"
    );
    expect(screen.getByRole("button", { name: "EPUB" })).toBeInTheDocument();
    expect(
      screen.getByLabelText("最近 PDF 会话").querySelector("button, a")
    ).toBeNull();
    await pick();
    await enabled();
    expect(openNote()).toHaveValue("");
  });
});

describe("PDF ownership", () => {
  it.each([false, true])(
    "keeps a fresh saved marker after a previous open's late read (reject=%s)",
    async (reject) => {
      const notes = createMemoryPdfNotesStore();
      await notes.save(
        {
          type: "progress",
          docId: await id(),
          page: 1,
          lineIndex: 0,
          lineText: lineText(),
        },
        "Current saved note"
      );
      const list = notes.list.bind(notes);
      const old = deferred<PdfNote[]>();
      notes.list = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockImplementation(list);
      mount(notes);
      await pick();
      // Return to the same identity in a fresh session before the first read answers.
      reopen();
      await pick();
      await enabled();
      expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
        "has-note"
      );
      await act(async () => {
        if (reject) old.reject(new Error("old failure"));
        else old.resolve([]);
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
        "has-note"
      );
      expect(openNote()).toHaveValue("Current saved note");
    }
  );

  it.each([false, true])(
    "drops an old page's late read across A→B→A without clearing a fresh failure (reject=%s)",
    async (reject) => {
      const notes = createMemoryPdfNotesStore();
      const old = deferred<PdfNote[]>();
      const current = deferred<PdfNote[]>();
      notes.list = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce([])
        .mockReturnValueOnce(current.promise)
        .mockResolvedValue([]);
      mount(notes);
      await pick();
      fireEvent.click(screen.getByRole("button", { name: "下一页" }));
      await enabled();
      fireEvent.click(screen.getByRole("button", { name: "上一页" }));
      await act(async () => current.reject(new Error("fresh read failure")));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "笔记读取失败"
      );
      await act(async () => {
        if (reject) old.reject(new Error("old read"));
        else old.resolve([]);
      });
      expect(screen.getByRole("alert")).toHaveTextContent("笔记读取失败");
      expect(
        screen.getAllByRole("button", { name: "写笔记" })[0]
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "重试读取笔记" }));
      await enabled();
      expect(screen.queryByRole("alert")).toBeNull();
    }
  );

  it.each([false, true])(
    "drops an old editor's feedback after navigation while its write remains attached to the original identity (reject=%s)",
    async (reject) => {
      const notes = createMemoryPdfNotesStore();
      const write = notes.save.bind(notes);
      const gate = deferred<void>();
      notes.save = (anchor, text) =>
        gate.promise.then(() => write(anchor, text));
      mount(notes);
      await pick();
      await enabled();
      openNote();
      text("A pending");
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      vi.mocked(window.confirm).mockReturnValue(true);
      reopen();
      await pick("B");
      await enabled();
      openNote();
      text("B current");
      const bInput = screen.getByRole("textbox");
      await act(async () => {
        if (reject) gate.reject(new Error("quota"));
        else gate.resolve();
      });
      expect(bInput).toHaveValue("B current");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(await notes.list(await id("B"))).toEqual([]);
      expect(await notes.list(await id())).toHaveLength(reject ? 0 : 1);
    }
  );

  it.each(["open", "sample", "position"])(
    "destroys a candidate when unmounted during %s",
    async (stage) => {
      const candidate = session();
      const opening = deferred<pdf.PdfSession>();
      const sample = deferred<number[]>();
      const position = deferred<null>();
      vi.mocked(pdf.openPdf).mockReturnValue(
        stage === "open" ? opening.promise : Promise.resolve(candidate)
      );
      vi.mocked(pdf.sampleTextLengths).mockReturnValue(
        stage === "sample" ? sample.promise : Promise.resolve([120])
      );
      const positions = createMemoryPdfPositionStore();
      positions.getPosition = vi
        .fn()
        .mockReturnValue(
          stage === "position" ? position.promise : Promise.resolve(null)
        );
      const { view } = mount(undefined, positions);
      fireEvent.change(screen.getByLabelText("选择 EPUB 或 PDF 文件"), {
        target: { files: [new File([source()], "book.pdf")] },
      });
      await waitFor(() =>
        expect(
          stage === "position"
            ? positions.getPosition
            : stage === "sample"
              ? pdf.sampleTextLengths
              : pdf.openPdf
        ).toHaveBeenCalled()
      );
      view.unmount();
      await act(async () => {
        opening.resolve(candidate);
        sample.resolve([120]);
        position.resolve(null);
      });
      await waitFor(() =>
        expect(candidate.doc.destroy).toHaveBeenCalledTimes(1)
      );
    }
  );

  it("destroys candidates on scanned rejection and extraction failure, and accepted sessions on leaving", async () => {
    const candidates = [session(), session(), session()];
    vi.mocked(pdf.openPdf)
      .mockResolvedValueOnce(candidates[0]!)
      .mockResolvedValueOnce(candidates[1]!)
      .mockResolvedValueOnce(candidates[2]!);
    vi.mocked(pdf.sampleTextLengths)
      .mockResolvedValueOnce([0])
      .mockRejectedValueOnce(new Error("extraction failed"))
      .mockResolvedValue([120]);
    mount();
    const choose = () =>
      fireEvent.change(screen.getByLabelText("选择 EPUB 或 PDF 文件"), {
        target: { files: [new File([source()], "book.pdf")] },
      });
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("扫描版");
    expect(candidates[0]!.doc.destroy).toHaveBeenCalledTimes(1);
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("出了点意外");
    expect(candidates[1]!.doc.destroy).toHaveBeenCalledTimes(1);
    await pick();
    await enabled();
    expect(candidates[2]!.doc.destroy).not.toHaveBeenCalled();
    reopen();
    expect(candidates[2]!.doc.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("PDF shelf admission and byte ownership", () => {
  it("retains the picker Blob when PDF.js transfers its buffer", async () => {
    const ctx = mount();
    vi.mocked(pdf.openPdf).mockImplementation(async (buffer) => {
      structuredClone(buffer, { transfer: [buffer] });
      expect(buffer.byteLength).toBe(0);
      return session();
    });
    await pick();
    await waitFor(async () => expect(await ctx.bytes.list()).toHaveLength(1));
    expect((await ctx.bytes.get(await id())).blob.size).toBe(
      new Blob([source()]).size
    );
  });

  it("never shelves scanned or superseded candidates", async () => {
    const ctx = mount();
    vi.mocked(pdf.sampleTextLengths).mockResolvedValueOnce([0]);
    fireEvent.change(screen.getByLabelText("选择 EPUB 或 PDF 文件"), {
      target: { files: [new File([source()], "same.pdf")] },
    });
    await screen.findByText(/扫描版 PDF 不支持/);
    expect(await ctx.bytes.list()).toEqual([]);
    const sample = deferred<number[]>();
    vi.mocked(pdf.sampleTextLengths).mockReturnValueOnce(sample.promise);
    fireEvent.change(screen.getByLabelText("选择 EPUB 或 PDF 文件"), {
      target: { files: [new File([source()], "same.pdf")] },
    });
    await waitFor(() => expect(pdf.sampleTextLengths).toHaveBeenCalledTimes(2));
    ctx.view.unmount();
    await act(async () => sample.resolve([120]));
    expect(await ctx.bytes.list()).toEqual([]);
  });

  it("shows quota failure without blocking accepted reading", async () => {
    const backend = createMemoryPdfBytesBackend();
    vi.spyOn(backend, "put").mockRejectedValue(new Error("QuotaExceededError"));
    const ctx = mount(
      undefined,
      undefined,
      undefined,
      createPdfBytesStore(backend)
    );
    await pick();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PDF 未能存入书架"
    );
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
    expect(await ctx.bytes.list()).toEqual([]);
  });

  it("requests persistence once per mount across file opens and rerenders", async () => {
    const persist = vi.fn().mockResolvedValue(false);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persist },
    });
    const ctx = mount();
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
    ctx.view.rerender(ctx.tree());
    expect(persist).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("浏览器未授予持久存储，书架由浏览器管理空间。")
    ).toBeInTheDocument();
    delete (navigator as { storage?: unknown }).storage;
  });
});

function shelfRow(docId: string) {
  return [
    ...document.querySelectorAll<HTMLElement>("li[data-pdf-doc-id]"),
  ].find((node) => node.getAttribute("data-pdf-doc-id") === docId);
}
async function land() {
  fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
  await screen.findByLabelText("PDF 书架");
}

describe("PDF shelf entries, failure tiers and mutation ordering", () => {
  it("joins one position snapshot, coexists with EPUB and no-bytes hints, and reopens notes/page/scale without rewriting bytes", async () => {
    const positions = createMemoryPdfPositionStore();
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "doc:EPUB",
      title: "EPUB",
      book: { title: "EPUB", chapters: [] },
    });
    await positions.setPosition({
      docId: await id("B"),
      title: "Cached",
      page: 3,
      scale: 1.5,
    });
    await positions.setPosition({
      docId: await id(),
      title: "Legacy",
      page: 2,
      scale: 1,
    });
    const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
    await bytes.save({
      docId: await id("B"),
      title: "Cached",
      blob: new Blob([source("B")]),
    });
    const snapshot = vi.spyOn(positions, "getSnapshot");
    const getPosition = vi.spyOn(positions, "getPosition");
    const get = vi.spyOn(bytes, "get");
    const saveBytes = vi.spyOn(bytes, "save");
    const notes = createMemoryPdfNotesStore();
    for (const type of NOTE_TYPES)
      await notes.save(
        {
          docId: await id("B"),
          page: 3,
          lineIndex: 0,
          lineText: lineText(3),
          type,
        },
        type
      );
    mount(notes, positions, library, bytes);
    await screen.findByRole("button", { name: "Cached" });
    expect(shelfRow(await id("B"))).toHaveTextContent("第 3 页");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(getPosition).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("最近 PDF 会话")).toHaveTextContent(
      "Legacy"
    );
    expect(screen.getByRole("button", { name: "EPUB" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cached" }));
    await enabled();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "150%" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(openNote()).toHaveValue("progress");
    for (const [index, label] of ["进度", "感受", "思路", "疑问"].entries()) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      expect(screen.getByRole("textbox")).toHaveValue(NOTE_TYPES[index]);
    }
    expect(saveBytes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await land();
    expect(screen.queryByLabelText("最近 PDF 会话")).toBeNull();
  });

  it("shows list/open failures as retryable failures and keeps the picker available", async () => {
    const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
    await bytes.save({
      docId: await id(),
      title: "Cached",
      blob: new Blob([source()]),
    });
    vi.spyOn(bytes, "list").mockRejectedValueOnce(new Error("database open"));
    mount(undefined, undefined, undefined, bytes);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PDF 书架读取失败"
    );
    expect(screen.queryByText("书架暂无 PDF。")).toBeNull();
    expect(screen.getByLabelText("选择 EPUB 或 PDF 文件")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重试读取 PDF 书架" }));
    await screen.findByRole("button", { name: "Cached" });
    vi.spyOn(bytes, "get").mockRejectedValueOnce(new Error("missing bytes"));
    fireEvent.click(screen.getByRole("button", { name: "Cached" }));
    expect(
      await screen.findByText("PDF 书架读取失败，请重试打开或选择同一个文件。")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择 EPUB 或 PDF 文件")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cached" }));
    await screen.findByRole("heading", { name: "Same title" });
  });

  it("rejects cached bytes under the wrong docId and retries after a Blob read failure", async () => {
    const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
    await bytes.save({
      docId: await id(),
      title: "Cached",
      blob: new Blob([source()]),
    });
    const get = vi.spyOn(bytes, "get");
    get.mockResolvedValueOnce({
      docId: await id(),
      title: "Cached",
      size: new Blob([source("B")]).size,
      storedAt: 1,
      blob: new Blob([source("B")]),
    });
    mount(undefined, undefined, undefined, bytes);
    fireEvent.click(await screen.findByRole("button", { name: "Cached" }));
    await screen.findByText("PDF 书架读取失败，请重试打开或选择同一个文件。");
    expect(pdf.openPdf).not.toHaveBeenCalled();
    const blob = new Blob([source()]);
    Object.defineProperty(blob, "arrayBuffer", {
      value: () => Promise.reject(new Error("Blob read")),
    });
    get.mockResolvedValueOnce({
      docId: await id(),
      title: "Cached",
      size: blob.size,
      storedAt: 1,
      blob,
    });
    fireEvent.click(screen.getByRole("button", { name: "Cached" }));
    await screen.findByText("PDF 书架读取失败，请重试打开或选择同一个文件。");
    expect(pdf.openPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cached" }));
    await screen.findByRole("heading", { name: "Same title" });
  });

  it("refreshes the current picker when a save finishes after leaving reading", async () => {
    const backend = createMemoryPdfBytesBackend();
    const gate = deferred<void>();
    const put = backend.put.bind(backend);
    vi.spyOn(backend, "put").mockImplementation((record) =>
      gate.promise.then(() => put(record))
    );
    const bytes = createPdfBytesStore(backend);
    mount(undefined, undefined, undefined, bytes);
    await pick();
    await land();
    expect(screen.queryByRole("button", { name: "Same title" })).toBeNull();
    await act(async () => gate.resolve());
    expect(
      await screen.findByRole("button", { name: "Same title" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("最近 PDF 会话")).toBeNull();
  });

  it("queues deletion behind a delayed replacement and removes the row only after commit", async () => {
    const backend = createMemoryPdfBytesBackend();
    const bytes = createPdfBytesStore(backend);
    await bytes.save({
      docId: await id(),
      title: "Old",
      blob: new Blob([source()]),
    });
    const gate = deferred<void>();
    const put = backend.put.bind(backend);
    vi.spyOn(backend, "put").mockImplementation((record) =>
      gate.promise.then(() => put(record))
    );
    const ctx = mount(undefined, undefined, undefined, bytes);
    await pick();
    await land();
    const remove = await screen.findByRole("button", {
      name: "从书架删除《Old》",
    });
    fireEvent.click(remove);
    expect(remove).toBeDisabled();
    expect(shelfRow(await id())).toBeInTheDocument();
    await act(async () => gate.resolve());
    await waitFor(async () => expect(shelfRow(await id())).toBeUndefined());
    expect(await bytes.list()).toEqual([]);
    expect(await ctx.positions.getRecent()).toBeNull();
    expect(await ctx.positions.getPosition(await id())).not.toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("keeps the row on failed deletion, then deletes bytes while retaining notes and positions for reselect", async () => {
    const ctx = mount();
    await pick();
    await enabled();
    await save("Keep my note");
    await land();
    vi.spyOn(ctx.bytes, "delete").mockRejectedValueOnce(
      new Error("delete failed")
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "从书架删除《Same title》" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF 删除失败");
    expect(shelfRow(await id())).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "从书架删除《Same title》" })
    );
    await waitFor(async () => expect(shelfRow(await id())).toBeUndefined());
    expect(await ctx.notes.list(await id())).toHaveLength(1);
    expect(await ctx.positions.getPosition(await id())).not.toBeNull();
    await pick();
    await enabled();
    expect(openNote()).toHaveValue("Keep my note");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await land();
    expect(
      await screen.findByRole("button", { name: "Same title" })
    ).toBeInTheDocument();
  });

  it("retries recent cleanup independently after bytes deletion commits", async () => {
    const ctx = mount();
    await pick();
    await land();
    vi.spyOn(ctx.positions, "clearRecentIf").mockRejectedValueOnce(
      new Error("storage")
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "从书架删除《Same title》" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "最近会话清理失败"
    );
    expect(await ctx.bytes.list()).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "重试清理最近 PDF 会话" })
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await ctx.positions.getRecent()).toBeNull();
    expect(await ctx.positions.getPosition(await id())).not.toBeNull();
  });

  it("keeps each concurrent deletion disabled until its own commit", async () => {
    const bytes = createPdfBytesStore(createMemoryPdfBytesBackend());
    await bytes.save({
      docId: await id(),
      title: "A",
      blob: new Blob([source()]),
    });
    await bytes.save({
      docId: await id("B"),
      title: "B",
      blob: new Blob([source("B")]),
    });
    const remove = bytes.delete.bind(bytes);
    const a = deferred<void>();
    const b = deferred<void>();
    const aId = await id();
    vi.spyOn(bytes, "delete").mockImplementation((docId) =>
      (docId === aId ? a.promise : b.promise).then(() => remove(docId))
    );
    mount(undefined, undefined, undefined, bytes);
    const buttonA = await screen.findByRole("button", {
      name: "从书架删除《A》",
    });
    const buttonB = screen.getByRole("button", { name: "从书架删除《B》" });
    fireEvent.click(buttonA);
    fireEvent.click(buttonB);
    expect(buttonA).toBeDisabled();
    expect(buttonB).toBeDisabled();
    await act(async () => a.resolve());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "从书架删除《A》" })
      ).toBeNull()
    );
    expect(buttonB).toBeDisabled();
    await act(async () => b.resolve());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "从书架删除《B》" })
      ).toBeNull()
    );
  });

  it("drops an earlier document's late save failure after opening another PDF", async () => {
    const backend = createMemoryPdfBytesBackend();
    const gate = deferred<void>();
    vi.spyOn(backend, "put").mockImplementationOnce(() => gate.promise);
    mount(undefined, undefined, undefined, createPdfBytesStore(backend));
    await pick();
    await land();
    await pick("B");
    await act(async () => gate.reject(new Error("late quota")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Same title" })
    ).toBeInTheDocument();
  });
});
