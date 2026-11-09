import { NOTE_TYPES } from "../../server/src/wire";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEpub } from "@lingualeaf/import-core/testing";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import { ReaderPage } from "../src/reader/ReaderPage";
import type { ExtBook } from "../src/reader/import-book";
import { createMemoryLibraryStore } from "../src/store/library-store";
import {
  createMemoryNotesStore,
  type NotesStore,
} from "../src/store/notes-store";
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
const BOOK: ExtBook = {
  title: "Mixed Book",
  chapters: [
    {
      title: "One",
      level: 1,
      blocks: [
        { kind: "code", text: "const value = 1;" },
        { kind: "raw", text: "Heading" },
        { kind: "image", text: "A picture" },
        { kind: "sentence", text: "First sentence.", ipaSlots: ["", ""] },
        { kind: "sentence", text: "Second sentence.", ipaSlots: ["", ""] },
      ],
    },
    {
      title: "Two",
      level: 1,
      blocks: [
        { kind: "sentence", text: "Other chapter.", ipaSlots: ["", ""] },
      ],
    },
  ],
};
const ANCHOR = {
  type: "progress" as const,
  docId: "doc:Mixed Book",
  chapterIndex: 0,
  blockIndex: 3,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ipa: {}, entries: {}, inflections: {} }),
    }))
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openReader(notes: NotesStore = createMemoryNotesStore()) {
  const library = createMemoryLibraryStore();
  await library.saveDocument({
    id: ANCHOR.docId,
    title: BOOK.title,
    book: BOOK,
  });
  const tree = () => (
    <ReaderPage
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      store={vocab}
      notes={notes}
      library={library}
    />
  );
  const view = render(tree());
  fireEvent.click(await screen.findByRole("button", { name: BOOK.title }));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "写笔记" })[0]).toBeEnabled()
  );
  return { notes, library, tree, view };
}
function openFirstNote() {
  fireEvent.click(
    screen.getAllByRole("button", { name: /写笔记|编辑笔记/ })[0]!
  );
  return screen.getByRole("textbox", { name: "笔记正文" });
}
function changeText(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), {
    target: { value: text },
  });
}

describe("EPUB sentence-block notes", () => {
  it("keeps four types at the same sentence block and preserves siblings before and after reload", async () => {
    const ctx = await openReader();
    openFirstNote();
    for (const label of ["进度", "感受", "思路", "疑问"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      changeText(`${label}正文`);
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(await screen.findByRole("status")).toHaveTextContent("已存");
    }
    expect(await ctx.notes.list(ANCHOR.docId)).toHaveLength(4);
    fireEvent.click(screen.getByRole("tab", { name: "思路" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已删除");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    const assertSiblings = () => {
      expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
        "has-note"
      );
      openFirstNote();
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
    ctx.view.unmount();
    render(ctx.tree());
    fireEvent.click(await screen.findByRole("button", { name: BOOK.title }));
    await screen.findByRole("button", { name: "编辑笔记" });
    assertSiblings();
    expect(
      (await ctx.notes.list(ANCHOR.docId)).map((note) => note.type)
    ).toEqual(["progress", "feeling", "question"]);
  });

  it("saves at the full block index, reopens persisted notes, explicitly deletes and keeps other blocks button-free", async () => {
    const { notes, view, tree } = await openReader();
    expect(screen.getAllByRole("button", { name: "写笔记" })).toHaveLength(2);
    for (const node of document.querySelectorAll(
      ".code-block, .raw-block, .image-block"
    )) {
      expect(node.querySelector("button")).toBeNull();
    }
    const input = openFirstNote();
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    changeText("  \n");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    changeText("My note");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    expect(await notes.list(ANCHOR.docId)).toEqual([
      { ...ANCHOR, text: "My note" },
    ]);
    expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
      "has-note"
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.confirm).not.toHaveBeenCalled();
    view.unmount();
    render(tree());
    fireEvent.click(await screen.findByRole("button", { name: BOOK.title }));
    await screen.findByRole("button", { name: "编辑笔记" });
    expect(openFirstNote()).toHaveValue("My note");
    changeText("");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已删除");
    expect(await notes.list(ANCHOR.docId)).toEqual([]);
    expect(screen.queryByRole("button", { name: "编辑笔记" })).toBeNull();
  });

  it.each([
    "关闭",
    "Escape",
    "下一章",
    "打开其他文件",
    "另一句子块",
    "同一句子块",
    "浮层外",
  ])(
    "guards dirty drafts through %s with the same confirmation",
    async (action) => {
      await openReader();
      const first = screen.getAllByRole("button", { name: "写笔记" })[0]!;
      openFirstNote();
      fireEvent.click(screen.getByRole("tab", { name: "疑问" }));
      changeText("Unsaved draft");
      fireEvent.click(screen.getByRole("tab", { name: "进度" }));
      const perform = () => {
        if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
        else if (action === "同一句子块") fireEvent.click(first);
        else if (action === "另一句子块")
          fireEvent.click(
            screen.getAllByRole("button", { name: "写笔记" })[1]!
          );
        else
          fireEvent.click(
            screen.getByRole("button", {
              name: action === "浮层外" ? "音标" : action,
            })
          );
      };
      perform();
      expect(window.confirm).toHaveBeenCalledExactlyOnceWith("放弃修改？");
      expect(screen.getByRole("textbox")).toHaveValue("");
      fireEvent.click(screen.getByRole("tab", { name: "疑问" }));
      expect(screen.getByRole("textbox")).toHaveValue("Unsaved draft");
      fireEvent.click(screen.getByRole("tab", { name: "进度" }));
      expect(
        screen.getByRole("heading", { name: BOOK.title })
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "One" })).toHaveAttribute(
        "aria-current",
        "true"
      );
      vi.mocked(window.confirm).mockReturnValue(true);
      perform();
      expect(window.confirm).toHaveBeenCalledTimes(2);
      if (action === "另一句子块" || action === "同一句子块")
        expect(screen.getByRole("textbox")).toHaveValue("");
      else
        expect(screen.queryByRole("dialog", { name: "句子块笔记" })).toBeNull();
      if (action === "下一章")
        expect(screen.getByRole("button", { name: "Two" })).toHaveAttribute(
          "aria-current",
          "true"
        );
      if (action === "打开其他文件")
        expect(
          screen.getByLabelText("选择 EPUB 或 PDF 文件")
        ).toBeInTheDocument();
    }
  );

  it("discards unsaved drafts on page unmount without a close-page prompt", async () => {
    const { view, tree, notes } = await openReader();
    openFirstNote();
    changeText("Abandoned");
    view.unmount();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await notes.list(ANCHOR.docId)).toEqual([]);
    render(tree());
    fireEvent.click(await screen.findByRole("button", { name: BOOK.title }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "写笔记" })[0]).toBeEnabled()
    );
    expect(openFirstNote()).toHaveValue("");
  });

  it.each([false, true])(
    "drops a late write's editor feedback after changing chapter (reject=%s)",
    async (reject) => {
      const notes = createMemoryNotesStore();
      const save = notes.save.bind(notes);
      let finish!: () => void;
      const gate = new Promise<void>((resolve, fail) => {
        finish = reject ? () => fail(new Error("quota")) : resolve;
      });
      notes.save = (anchor, text) => gate.then(() => save(anchor, text));
      await openReader(notes);
      openFirstNote();
      changeText("Old chapter write");
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      vi.mocked(window.confirm).mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "下一章" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "写笔记" })).toBeEnabled()
      );
      openFirstNote();
      changeText("Current chapter draft");
      await act(async () => {
        finish();
        await gate.catch(() => undefined);
      });
      expect(screen.getByRole("textbox")).toHaveValue("Current chapter draft");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "上一章" }));
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: /写笔记|编辑笔记/ })[0]
        ).toBeEnabled()
      );
      expect(openFirstNote()).toHaveValue(reject ? "" : "Old chapter write");
    }
  );

  it("shows a failed read, disables editing, and retries without disguising failure as an empty book", async () => {
    const notes = createMemoryNotesStore();
    await notes.save(ANCHOR, "Existing");
    const list = notes.list.bind(notes);
    notes.list = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockImplementation(list);
    await openReaderWithoutWaiting(notes);
    expect(await screen.findByRole("alert")).toHaveTextContent("笔记读取失败");
    expect(screen.getAllByRole("button", { name: "写笔记" })[0]).toBeDisabled();
    expect(notes.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重试读取笔记" }));
    expect(
      await screen.findByRole("button", { name: "编辑笔记" })
    ).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(openFirstNote()).toHaveValue("Existing");
  });

  it("retains a draft after quota rejection and reports saved only after a successful retry", async () => {
    const notes = createMemoryNotesStore();
    const save = notes.save.bind(notes);
    notes.save = vi
      .fn()
      .mockRejectedValueOnce(new Error("QUOTA_BYTES quota exceeded"))
      .mockImplementation(save);
    await openReader(notes);
    openFirstNote();
    changeText("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已保留");
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑笔记" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
      "has-note"
    );
  });

  it("keeps an overlong draft after failure and succeeds after it is shortened to the exact limit", async () => {
    const { notes } = await openReader();
    openFirstNote();
    changeText("x".repeat(10_001));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    );
    expect(screen.getByRole("textbox")).toHaveValue("x".repeat(10_001));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("最多 10,000 字符");
    expect(await notes.list(ANCHOR.docId)).toEqual([]);
    changeText("y".repeat(10_000));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows editing at 100 notes, rejects a new note visibly and preserves the new draft", async () => {
    const notes = createMemoryNotesStore();
    await notes.save(ANCHOR, "Existing");
    for (let index = 0; index < 99; index++)
      await notes.save(
        {
          ...ANCHOR,
          blockIndex: index + 100,
          type: NOTE_TYPES[index % 4]!,
        },
        "Other saved note"
      );
    await openReader(notes);
    openFirstNote();
    changeText("Edited at capacity");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "写笔记" }));
    changeText("A new note at capacity");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("100 条");
    expect(screen.getByRole("textbox")).toHaveValue("A new note at capacity");
    expect(screen.queryByRole("status")).toBeNull();
    expect(await notes.list(ANCHOR.docId)).toHaveLength(100);
  });

  it("preserves an edited draft and marker when deletion fails, and permits retry", async () => {
    const notes = createMemoryNotesStore();
    await notes.save(ANCHOR, "Saved note");
    const remove = notes.delete.bind(notes);
    notes.delete = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage failed"))
      .mockImplementation(remove);
    await openReader(notes);
    openFirstNote();
    changeText("Unsaved edits");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已保留");
    expect(screen.getByRole("textbox")).toHaveValue("Unsaved edits");
    expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
      "has-note"
    );
    expect((await notes.list(ANCHOR.docId))[0]?.text).toBe("Saved note");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已删除");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await notes.list(ANCHOR.docId)).toEqual([]);
  });

  it.each([false, true])(
    "does not let an earlier editor's response touch a new editor at the same anchor (reject=%s)",
    async (reject) => {
      const notes = createMemoryNotesStore();
      const save = notes.save.bind(notes);
      let finish!: () => void;
      const gate = new Promise<void>((resolve, fail) => {
        finish = reject ? () => fail(new Error("quota")) : resolve;
      });
      notes.save = (anchor, text) => gate.then(() => save(anchor, text));
      await openReader(notes);
      openFirstNote();
      changeText("First operation");
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      vi.mocked(window.confirm).mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      openFirstNote();
      changeText("New operation draft");
      await act(async () => {
        finish();
        await gate.catch(() => undefined);
      });
      expect(screen.getByRole("textbox")).toHaveValue("New operation draft");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    }
  );

  it.each([false, true])(
    "permanently drops an old chapter read on A→B→A (reject=%s)",
    async (reject) => {
      const notes = createMemoryNotesStore();
      const list = notes.list.bind(notes);
      let finish!: () => void;
      const gate = new Promise<void>((resolve, fail) => {
        finish = reject ? () => fail(new Error("read failed")) : resolve;
      });
      notes.list = vi
        .fn()
        .mockImplementationOnce(() =>
          gate.then(() => [{ ...ANCHOR, text: "Stale" }])
        )
        .mockImplementation(list);
      await openReaderWithoutWaiting(notes);
      await screen.findByRole("heading", { name: "One" });
      fireEvent.click(screen.getByRole("button", { name: "下一章" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "写笔记" })).toBeEnabled()
      );
      fireEvent.click(screen.getByRole("button", { name: "上一章" }));
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: "写笔记" })[0]
        ).toBeEnabled()
      );
      await act(async () => {
        finish();
        await gate.catch(() => undefined);
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "编辑笔记" })).toBeNull();
      expect(openFirstNote()).toHaveValue("");
    }
  );

  it("anchors to the note button, clamps to the viewport, and restores keyboard focus on Escape", async () => {
    await openReader();
    const button = screen.getAllByRole("button", { name: "写笔记" })[0]!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 120, 20, 20)
    );
    button.focus();
    // A native button supplies Enter/Space activation in browsers; jsdom
    // needs the click explicitly. Focus and Escape cross the real DOM seam.
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "句子块笔记" });
    expect(dialog.style.left).toBe("80px");
    expect(dialog.style.top).toBe("154px");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      new DOMRect(9999, 9999, 20, 20)
    );
    fireEvent(window, new Event("resize"));
    expect(parseFloat(dialog.style.left)).toBeLessThan(window.innerWidth);
    expect(parseFloat(dialog.style.top)).toBeLessThan(window.innerHeight);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

async function openReaderWithoutWaiting(notes: NotesStore) {
  const library = createMemoryLibraryStore();
  await library.saveDocument({
    id: ANCHOR.docId,
    title: BOOK.title,
    book: BOOK,
  });
  render(
    <ReaderPage
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      store={vocab}
      notes={notes}
      library={library}
    />
  );
  fireEvent.click(await screen.findByRole("button", { name: BOOK.title }));
}

describe("same-title import protection in the reader", () => {
  async function pick(body: string) {
    const bytes = await buildEpub({
      title: BOOK.title,
      docs: [{ href: "one.xhtml", body }],
    });
    const input = screen.getByLabelText("选择 EPUB 或 PDF 文件");
    fireEvent.change(input, {
      target: { files: [new File([bytes as BlobPart], "book.epub")] },
    });
  }

  it("silently reimports equal source content, blocks changed content, and cancellation preserves notes and book", async () => {
    const library = createMemoryLibraryStore();
    const notes = createMemoryNotesStore();
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        store={vocab}
        notes={notes}
        library={library}
      />
    );
    await pick("<p>Original words.</p>");
    await screen.findByRole("heading", { name: BOOK.title });
    const original = await library.openDocument(ANCHOR.docId);
    await notes.save({ ...ANCHOR, blockIndex: 0 }, "Existing note");
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
    await pick("<p>Original words.</p>");
    await screen.findByRole("heading", { name: BOOK.title });
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
    await pick("<p>Different content.</p>");
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    expect(vi.mocked(window.confirm).mock.calls[0]?.[0]).toContain(
      "1 条已有笔记"
    );
    expect(await library.openDocument(ANCHOR.docId)).toEqual(original);
    expect(await notes.list(ANCHOR.docId)).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: BOOK.title })).toBeNull();
    vi.mocked(window.confirm).mockReturnValue(true);
    await pick("<p>Different content.</p>");
    await screen.findByRole("heading", { name: BOOK.title });
    expect(await library.openDocument(ANCHOR.docId)).not.toEqual(original);
  });

  it("refuses replacement if existing notes cannot be counted", async () => {
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: ANCHOR.docId,
      title: BOOK.title,
      book: BOOK,
    });
    const notes = createMemoryNotesStore();
    notes.list = vi.fn().mockRejectedValue(new Error("read failed"));
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        store={vocab}
        notes={notes}
        library={library}
      />
    );
    await pick("<p>Different content.</p>");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "笔记读取失败，未替换原书"
    );
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await library.openDocument(ANCHOR.docId)).toEqual(BOOK);
  });
});
