import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewPage } from "../src/ReviewPage";
import type { NoteType, ReviewNoteEntry } from "../../server/src/wire";
import { readFileSync } from "node:fs";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/style.css"),
  "utf8"
);

function entry(
  bookId: number,
  chapter: number | null,
  type: NoteType,
  id: number,
  text = `${type} full text\nSecond line`
): ReviewNoteEntry {
  return {
    bookId,
    bookTitle: "Same book title",
    chapterPosition: chapter ?? 0,
    chapterTitle: chapter === null ? "文章笔记" : "Same chapter title",
    note: {
      id,
      chapter,
      block: chapter === null ? null : 2,
      type,
      text,
      createdAt: "2026-11-05T00:00:00Z",
      updatedAt: "2026-11-05T00:00:00Z",
    },
  };
}
function mount(entries: ReviewNoteEntry[], status = 200) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (String(input) === "/api/review/notes" && method === "GET")
        return new Response(
          JSON.stringify(status === 200 ? { entries } : { error: "failed" }),
          { status }
        );
      throw new Error(`unexpected fetch: ${method} ${input}`);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <MemoryRouter>
      <ReviewPage />
    </MemoryRouter>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("groups by book ids then chapter positions, displays full text and builds only URL targets", async () => {
  const entries = [
    entry(1, null, "progress", 1),
    entry(1, 1, "feeling", 2),
    entry(1, 1, "idea", 3),
    entry(1, 2, "question", 4),
    entry(2, 1, "idea", 5),
  ];
  const view = mount(entries);
  await act(async () => {});
  const books = screen.getAllByRole("region", { name: "Same book title" });
  expect(books).toHaveLength(2);
  expect(
    within(books[0]!)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent)
  ).toEqual(["文章笔记", "Same chapter title", "Same chapter title"]);
  expect(within(books[1]!).getAllByRole("heading", { level: 3 })).toHaveLength(
    1
  );
  const links = view.container.querySelectorAll(".review-note-link");
  expect([...links].map((link) => link.getAttribute("href"))).toEqual([
    "/book/1/1",
    "/book/1/1?block=2&note=2",
    "/book/1/1?block=2&note=3",
    "/book/1/2?block=2&note=4",
    "/book/2/1?block=2&note=5",
  ]);
  expect(
    [...view.container.querySelectorAll(".review-note-text")].map(
      (text) => text.textContent
    )
  ).toEqual(entries.map((entry) => entry.note.text));
  const style = document.createElement("style");
  style.textContent = css.replace(/^@import .*;$/gm, "");
  document.head.append(style);
  try {
    const badges = [...view.container.querySelectorAll(".note-badge")];
    expect(badges.map((badge) => badge.getAttribute("data-note-type"))).toEqual(
      ["progress", "feeling", "idea", "question", "idea"]
    );
    expect(
      badges.map((badge) =>
        getComputedStyle(badge).getPropertyValue("--note-type-color")
      )
    ).toEqual(["#245f98", "#993e61", "#4f6c29", "#7951a0", "#4f6c29"]);
    for (const badge of badges)
      expect(getComputedStyle(badge).color).toBe("var(--note-type-color)");
  } finally {
    style.remove();
  }
  expect(
    screen.queryByRole("button", { name: /保存|删除/ })
  ).not.toBeInTheDocument();
});

it("clamps overflowing notes and expands/collapses without navigating, keeping the complete text", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("review-note-text") ? 500 : 0;
    }
  );
  const text = "A long thought.\n".repeat(50);
  const view = mount([entry(1, 1, "idea", 1, text)]);
  await act(async () => {});
  const paragraph = view.container.querySelector(".review-note-text")!;
  const style = document.createElement("style");
  style.textContent = css.replace(/^@import .*;$/gm, "");
  document.head.append(style);
  try {
    expect(paragraph.textContent).toBe(text);
    expect(
      getComputedStyle(paragraph).getPropertyValue("-webkit-line-clamp")
    ).toBe("6");
    expect(getComputedStyle(paragraph).overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(paragraph).not.toHaveClass("is-collapsed");
    expect(
      getComputedStyle(paragraph).getPropertyValue("-webkit-line-clamp")
    ).not.toBe("6");
    expect(paragraph.textContent).toBe(text);
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(paragraph).toHaveClass("is-collapsed");
  } finally {
    style.remove();
  }
});

it("offers the empty-state guidance and a shelf link", async () => {
  mount([]);
  await act(async () => {});
  expect(
    screen.getByText("还没有笔记；阅读时点句尾的 ✎ 落一条。")
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "← 回书架" })).toHaveAttribute(
    "href",
    "/"
  );
});

it("shows a failed request as an error rather than the empty state", async () => {
  mount([], 500);
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent("笔记加载失败");
  expect(screen.queryByText(/还没有笔记/)).not.toBeInTheDocument();
  expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
});
