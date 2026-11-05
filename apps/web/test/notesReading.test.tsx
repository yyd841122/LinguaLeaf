import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadingPage } from "../src/ReadingPage";
import type { NoteSummary } from "../../server/src/wire";

const note = (
  id: number,
  chapter: number | null,
  block: number | null,
  text: string
): NoteSummary => ({
  id,
  chapter,
  block,
  type: "idea",
  text,
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
});
let rows: NoteSummary[];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let landed: string | null;
let failChapter: number | null;
const flush = () => act(async () => {});
const selectText = (type = "思路") => {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${type}`) }));
  return screen.getByRole("textbox", { name: `${type}笔记内容` });
};
const selectPanel = (type = "思路") =>
  within(selectText(type).closest("form")!);
async function clickNoteAction(type: string, name: string) {
  const button = selectPanel(type).getByRole("button", { name });
  await act(async () => fireEvent.click(button));
}
async function frame() {
  await act(async () => {
    const batch = [...frames.values()];
    frames.clear();
    batch.forEach((callback) => callback(0));
  });
}
beforeEach(() => {
  rows = [];
  frames = new Map();
  nextFrame = 0;
  landed = null;
  failChapter = null;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(function (this: Element) {
      landed = `${document.querySelector("#chapter-title")?.textContent}:${this.getAttribute("data-position")}`;
    }),
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      // A different post-scroll button coordinate catches measuring before the
      // progress coordinator lands (the old coordinate would yield left=0).
      const left = landed ? 120 : 0;
      return {
        left,
        right: left + 20,
        top: 80,
        bottom: 100,
        width: 20,
        height: 20,
        x: left,
        y: 80,
        toJSON() {},
      };
    }
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      if (/\/chapters\/\d+$/.test(url) && method === "GET") {
        const position = Number(url.split("/").pop());
        if (position === failChapter) return json({ error: "missing" }, 404);
        return json({
          position,
          title: `Chapter ${position}`,
          level: null,
          translationStatus: "untranslated",
          translationPercent: null,
          translationError: null,
          translationAvailable: true,
          blocks: [1, 2].map((block) => ({
            position: block,
            kind: block === 1 ? "sentence" : "raw",
            originalText: `Chapter ${position} block ${block}`,
            ipaSlots: null,
            ipaText: null,
            translationText: null,
            wordStatuses: [null, null],
          })),
        });
      }
      if (url.endsWith("/notes") && method === "GET")
        return json({ notes: [...rows] });
      if (url.endsWith("/notes") && method === "POST") {
        const value = JSON.parse(String(init?.body));
        const created = {
          ...note(10, value.chapter, value.block, value.text),
          type: value.type,
        };
        rows = [...rows, created];
        return json({ note: created }, 201);
      }
      if (/\/notes\/\d+$/.test(url) && method === "PUT") {
        const id = Number(url.split("/").pop());
        const value = JSON.parse(String(init?.body));
        rows = rows.map((row) =>
          row.id === id
            ? { ...row, ...value, updatedAt: "2026-11-04T00:00:01.000Z" }
            : row
        );
        return json({ note: rows.find((row) => row.id === id) });
      }
      if (/\/notes\/\d+$/.test(url) && method === "DELETE") {
        rows = rows.filter((row) => row.id !== Number(url.split("/").pop()));
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/bookmarks") && method === "GET")
        return json({ bookmarks: [] });
      if (url.startsWith("/api/lookup/") && method === "GET")
        return json({ error: "missing" }, 404);
      if (url.endsWith("/progress") && method === "GET")
        return json({ chapter: 1, block: 1 });
      if (url.endsWith("/progress") && method === "PUT")
        return new Response(null, { status: 204 });
      if (url.endsWith("/api/books/7") && method === "GET")
        return json({
          id: 7,
          title: "Notes book",
          chapters: [1, 2].map((position) => ({
            position,
            title: `Chapter ${position}`,
            level: 1,
          })),
        });
      throw new Error(`unexpected fetch: ${method} ${url}`);
    })
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <MemoryRouter initialEntries={["/book/7/1"]}>
      <Routes>
        <Route path="/book/:id/:chapter" element={<ReadingPage />} />
      </Routes>
    </MemoryRouter>
  );
}

it("writes from a block, shows the persistent marker, edits, deletes, and leaves bookmarks independent", async () => {
  mount();
  await flush();
  fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[0]!);
  fireEvent.change(selectText("疑问"), {
    target: { value: "A thought" },
  });
  await clickNoteAction("疑问", "保存");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  const marker = screen.getByRole("button", { name: "编辑笔记" });
  expect(marker).toHaveClass("has-note");
  // The button trails the last text line inside the content element, so
  // the note classes ride the block container two levels up.
  expect(marker.closest(".sentence-block")).toHaveClass("has-note");
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  const notes = screen.getByRole("region", { name: "笔记" });
  expect(within(notes).getByRole("button")).toHaveTextContent(
    "疑问 Chapter 1 · A thought"
  );
  expect(screen.getByRole("button", { name: "打书签" })).toBeEnabled();
  fireEvent.click(marker);
  expect(selectText("疑问")).toHaveValue("A thought");
  await clickNoteAction("疑问", "删除");
  expect(
    screen.queryByRole("button", { name: "编辑笔记" })
  ).not.toBeInTheDocument();
  expect(within(notes).queryByText("A thought")).not.toBeInTheDocument();
});

it("opens same- and cross-chapter notes only after landing; rapid intents keep the last click", async () => {
  rows = [
    note(1, 1, 2, "Same chapter"),
    note(2, 2, 1, "Cross chapter"),
    note(3, 2, 2, "Last click"),
  ];
  mount();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "笔记" })).getByRole("button", {
      name: /Same chapter/,
    })
  );
  expect(landed).toBe("Chapter 1:2");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await frame();
  expect(selectText()).toHaveValue("Same chapter");
  expect(screen.getByRole("dialog").style.left).toBe("100px");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "笔记" })).getByRole("button", {
      name: /Cross chapter/,
    })
  );
  await flush();
  expect(
    screen.getByRole("heading", { name: "Chapter 2" })
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // Replace the still-unconsumed cross-chapter intent before its frame.
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "笔记" })).getByRole("button", {
      name: /Last click/,
    })
  );
  await frame();
  expect(landed).toBe("Chapter 2:2");
  expect(selectText()).toHaveValue("Last click");
});

it("discards a failed navigation's intent", async () => {
  rows = [note(2, 2, 1, "Unavailable chapter")];
  failChapter = 2;
  mount();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "笔记" })).getByRole("button", {
      name: /Unavailable/,
    })
  );
  await flush();
  await frame();
  expect(screen.getByRole("alert")).toHaveTextContent("加载失败");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the book banner in every chapter and expands it from the notes list", async () => {
  rows = [note(1, null, null, "Overall thoughts")];
  mount();
  await flush();
  const banner = screen.getByRole("region", { name: "文章笔记" });
  expect(within(banner).getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "笔记" })).getByRole("button", {
      name: /文章笔记/,
    })
  );
  await frame();
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
  expect(within(banner).getAllByRole("textbox")).toHaveLength(1);
  expect(selectText()).toHaveValue("Overall thoughts");
  fireEvent.change(selectText(), {
    target: { value: "Updated book note" },
  });
  await clickNoteAction("思路", "保存");
  fireEvent.click(screen.getByRole("link", { name: "下一章 →" }));
  await flush();
  expect(
    screen.getByRole("heading", { name: "Chapter 2" })
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "文章笔记" })).getByRole(
      "button",
      { name: /Updated book note/ }
    )
  ).toBeInTheDocument();
});

it("keeps one popup and honors dirty-close cancellation when switching to word details", async () => {
  mount();
  await flush();
  fireEvent.click(screen.getAllByRole("button", { name: "Chapter" })[0]!);
  await flush();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[0]!);
  expect(
    screen.queryByRole("dialog", { name: /词详情/ })
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.change(selectText(), {
    target: { value: "Keep my draft" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getAllByRole("button", { name: "Chapter" })[0]!);
  expect(selectText()).toHaveValue("Keep my draft");
  expect(
    screen.queryByRole("dialog", { name: /词详情/ })
  ).not.toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Chapter" })[0]!);
  await flush();
  expect(
    screen.queryByRole("dialog", { name: "笔记" })
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("shows every type in fixed order in the list, keeps one marker, and opens sibling types through tabs", async () => {
  rows = (["question", "idea", "feeling", "progress"] as const).map(
    (type, i) => ({
      ...note(i + 1, 1, 1, `${type} content`),
      type,
    })
  );
  mount();
  await flush();
  expect(screen.getAllByRole("button", { name: "编辑笔记" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  const list = screen.getByRole("region", { name: "笔记" });
  const entries = within(list).getAllByRole("button");
  expect(
    entries.map((entry) =>
      entry.querySelector(".note-badge")?.getAttribute("data-note-type")
    )
  ).toEqual(["progress", "feeling", "idea", "question"]);
  fireEvent.click(entries[2]!);
  await frame();
  expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
    "data-note-type",
    "progress"
  );
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  for (const [label, type] of [
    ["进度", "progress"],
    ["感受", "feeling"],
    ["思路", "idea"],
    ["疑问", "question"],
  ])
    expect(selectText(label)).toHaveValue(`${type} content`);
  await clickNoteAction("思路", "删除");
  expect(screen.getByRole("button", { name: "编辑笔记" })).toHaveClass(
    "has-note"
  );
  expect(selectText("疑问")).toHaveValue("question content");
});

it("creates, edits and deletes book types independently in the shared tabbed banner", async () => {
  rows = [
    { ...note(1, null, null, "Stopped here"), type: "progress" },
    note(2, null, null, "Existing idea"),
  ];
  mount();
  await flush();
  const banner = screen.getByRole("region", { name: "文章笔记" });
  fireEvent.click(within(banner).getByRole("button"));
  expect(within(banner).getAllByRole("textbox")).toHaveLength(1);
  expect(within(banner).getAllByRole("tab")).toHaveLength(4);
  expect(selectText("进度")).toHaveValue("Stopped here");
  fireEvent.change(selectText("感受"), { target: { value: "A feeling" } });
  fireEvent.change(selectText("疑问"), {
    target: { value: "Unsaved question" },
  });
  await clickNoteAction("感受", "保存");
  expect(rows.find((row) => row.type === "feeling")).toMatchObject({
    chapter: null,
    block: null,
    text: "A feeling",
  });
  await clickNoteAction("思路", "删除");
  expect(rows.some((row) => row.type === "idea")).toBe(false);
  expect(selectText("进度")).toHaveValue("Stopped here");
  expect(selectText("疑问")).toHaveValue("Unsaved question");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(within(banner).getByRole("button", { expanded: true }));
  expect(confirm).toHaveBeenCalledWith("放弃修改？");
  expect(selectText("疑问")).toHaveValue("Unsaved question");
  confirm.mockReturnValue(true);
  fireEvent.click(within(banner).getByRole("button", { expanded: true }));
  expect(within(banner).queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(within(banner).getByRole("button", { expanded: false }));
  expect(within(banner).getByRole("tab", { selected: true })).toHaveAttribute(
    "data-note-type",
    "progress"
  );
  expect(selectText("疑问")).toHaveValue("");
  expect(selectText("感受")).toHaveValue("A feeling");
});

it("protects every book draft on Esc and outside clicks before switching to a block popup", async () => {
  mount();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "写文章笔记" }));
  fireEvent.change(selectText("疑问"), { target: { value: "Book draft" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  selectPanel("进度");
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[0]!);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(selectText("疑问")).toHaveValue("Book draft");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[0]!);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "文章笔记" })).queryByRole(
      "textbox"
    )
  ).not.toBeInTheDocument();
  expect(selectText("疑问")).toHaveValue("");
});
