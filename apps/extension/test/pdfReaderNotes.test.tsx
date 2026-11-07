import { NOTE_TYPES, type NoteType } from "../../server/src/wire";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
function mount(
  notes = createMemoryPdfNotesStore(),
  positions = createMemoryPdfPositionStore(),
  library = createMemoryLibraryStore()
) {
  const tree = () => (
    <ReaderPage
      store={vocab}
      library={library}
      notes={createMemoryNotesStore()}
      pdfNotes={notes}
      pdfPositions={positions}
    />
  );
  return { view: render(tree()), tree, notes, positions, library };
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

  it("persists only a nonclickable latest-session hint beside EPUB recents across remount, and drops drafts", async () => {
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
