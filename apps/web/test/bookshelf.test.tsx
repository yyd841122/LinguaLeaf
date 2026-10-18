import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookshelfPage } from "../src/BookshelfPage";

type ShelfBook = {
  id: number;
  title: string;
  format: string;
  createdAt: string;
  status: string;
  importStage: string | null;
  importPercent: number | null;
  importError: string | null;
  progress: { chapter: number; block: number } | null;
};

const readyBook: ShelfBook = {
  id: 1,
  title: "A Finished Book",
  format: "epub",
  createdAt: "2026-10-18T00:00:00.000Z",
  status: "ready",
  importStage: null,
  importPercent: null,
  importError: null,
  progress: null,
};

const importingBook: ShelfBook = {
  id: 2,
  title: "A Held Book",
  format: "markdown",
  createdAt: "2026-10-18T00:00:00.000Z",
  status: "importing",
  importStage: "translating",
  importPercent: 40,
  importError: null,
  progress: null,
};

const failedBook: ShelfBook = {
  id: 3,
  title: "A Broken Book",
  format: "epub",
  createdAt: "2026-10-18T00:00:00.000Z",
  status: "failed",
  importStage: null,
  importPercent: null,
  importError: "服务重启，导入中断",
  progress: null,
};

// The shelf endpoint is the component's only view of import state; the mock
// serves whatever the test last put into shelfState.
let shelfState: { books: ShelfBook[] };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderShelf() {
  return render(
    <MemoryRouter>
      <BookshelfPage />
    </MemoryRouter>
  );
}

// Flush pending fetches and timers: run whatever is due inside the window
// and drain the promise queue so React state lands.
async function actAdvance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function uploadFile(name: string) {
  const input = screen.getByLabelText(
    "导入 EPUB / Markdown 书籍"
  ) as HTMLInputElement;
  // jsdom has no constructible FileList and its required-file validation
  // blocks button-click submits, so the files array is planted and the
  // submit event dispatched directly.
  Object.defineProperty(input, "files", {
    value: [new File(["content"], name)],
    configurable: true,
  });
  fireEvent.change(input);
  fireEvent.submit(input.closest("form")!);
  await actAdvance(0);
}

describe("BookshelfPage import states (ticket 08)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shelfState = { books: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/books") && method === "POST") {
          // The POST answers 202 with the importing row; the shelf refetch
          // right after is what the page actually renders.
          shelfState.books = [importingBook];
          return jsonResponse(202, importingBook);
        }
        if (url.endsWith("/api/books")) {
          return jsonResponse(200, shelfState);
        }
        throw new Error(`unexpected fetch: ${method} ${url}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a book importing with stage and percent, then readable when ready", async () => {
    renderShelf();
    await uploadFile("held-book.md");

    // The shelf reflects the importing row: progress with stage + percent,
    // title not yet a link, delete stays available.
    expect(screen.getByText(/导入中 · 翻译译文 40%/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "A Held Book" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "删除《A Held Book》" })
    ).toBeTruthy();

    // The import settles: the poll sees a ready book and the title becomes
    // the reading link.
    shelfState.books = [readyBook];
    await actAdvance(2000);
    expect(screen.getByRole("link", { name: "A Finished Book" })).toBeTruthy();
    expect(screen.queryByText(/导入中/)).toBeNull();
  });

  it("stops polling once no book is importing", async () => {
    renderShelf();
    await uploadFile("held-book.md");

    shelfState.books = [readyBook];
    await actAdvance(2000);
    const pollsAfterReady = vi.mocked(fetch).mock.calls.length;

    await actAdvance(5000);
    expect(vi.mocked(fetch).mock.calls.length).toBe(pollsAfterReady);
  });

  it("labels every known stage and falls back for an unknown one", async () => {
    renderShelf();
    await uploadFile("held-book.md");
    expect(screen.getByText(/导入中 · 翻译译文 40%/)).toBeTruthy();

    // annotating carries no percent; an unknown stage (server newer than
    // this page) shows a neutral label, not a raw enum value.
    shelfState.books = [
      { ...importingBook, importStage: "annotating", importPercent: null },
    ];
    await actAdvance(2000);
    expect(screen.getByText(/导入中 · 标注生成中/)).toBeTruthy();

    shelfState.books = [
      { ...importingBook, importStage: "packing", importPercent: null },
    ];
    await actAdvance(2000);
    expect(screen.getByText(/导入中 · 处理中/)).toBeTruthy();
  });

  it("disables the import button while any book is translating", async () => {
    renderShelf();
    expect(screen.getByRole("button", { name: "导入" })).not.toBeDisabled();

    // The POST returns in milliseconds; the button stays disabled for the
    // whole background import, not just the request.
    await uploadFile("held-book.md");
    expect(screen.getByRole("button", { name: "导入中…" })).toBeDisabled();

    shelfState.books = [readyBook];
    await actAdvance(2000);
    expect(screen.getByRole("button", { name: "导入" })).not.toBeDisabled();
  });

  it("shows a failed import with its reason and keeps delete available", async () => {
    renderShelf();
    await uploadFile("held-book.md");

    shelfState.books = [failedBook];
    await actAdvance(2000);

    expect(screen.getByText(/导入失败：服务重启，导入中断/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "A Broken Book" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "删除《A Broken Book》" })
    ).toBeTruthy();
  });
});
