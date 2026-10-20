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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    shelfState = { books: [] };
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    });
    vi.stubGlobal("fetch", fetchMock);
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

  it("warns when the server is unreachable while a book is importing", async () => {
    renderShelf();
    await uploadFile("held-book.md");
    expect(screen.queryByText(/无法连接服务端/)).toBeNull();

    // The dev server died: every poll fails silently into a warning, so
    // the stale 「导入中」 row is not the only thing on screen.
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await actAdvance(2000);
    expect(screen.getByText(/无法连接服务端/)).toBeTruthy();

    // The server returns: the next poll clears the warning and lands the
    // settled state.
    shelfState.books = [readyBook];
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/books")) {
          return jsonResponse(200, shelfState);
        }
        throw new Error(`unexpected fetch: ${String(init?.method)} ${url}`);
      }
    );
    await actAdvance(2000);
    expect(screen.queryByText(/无法连接服务端/)).toBeNull();
    expect(screen.getByRole("link", { name: "A Finished Book" })).toBeTruthy();
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

describe("BookshelfPage export (ticket 03)", () => {
  // jsdom has no object URL store and anchor clicks would try to navigate;
  // the stubs record what the download helper handed the browser.
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let downloaded: { download: string; href: string }[];
  let fetchMock: ReturnType<typeof vi.fn>;

  // Mirrors the two-form header Express emits: the ASCII fallback quoted,
  // the real title riding RFC 5987 filename* (server test/export.test.ts
  // pins the same shape).
  function dispositionFor(filename: string): string {
    return `attachment; filename="ascii-fallback.html"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }

  function htmlResponse(
    status: number,
    body: string,
    disposition?: string
  ): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(
        disposition ? { "content-disposition": disposition } : {}
      ),
      blob: async () => new Blob([body], { type: "text/html" }),
    } as Response;
  }

  // The named injectable mock (CODING_STANDARDS.md, component-test
  // boundaries): the shelf list always answers, an export URL delegates to
  // the test's responder, anything else fails loudly.
  function serveShelf(
    exportResponder: (url: string) => Response | Promise<Response>
  ): void {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/books\/\d+\/export$/.test(url)) {
        return exportResponder(url);
      }
      if (url.endsWith("/api/books")) {
        return jsonResponse(200, shelfState);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    shelfState = { books: [readyBook, importingBook, failedBook] };
    createObjectURL = vi.fn(() => "blob:annotated-book");
    revokeObjectURL = vi.fn();
    URL.createObjectURL =
      createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL =
      revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    downloaded = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloaded.push({ download: this.download, href: this.href });
    });
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/books")) {
        return jsonResponse(200, shelfState);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders the export action only for ready books", async () => {
    renderShelf();
    await actAdvance(0);

    expect(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "导出《A Held Book》" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "导出《A Broken Book》" })
    ).toBeNull();
  });

  it("downloads the export named by Content-Disposition", async () => {
    serveShelf(() =>
      htmlResponse(
        200,
        "<html>annotated</html>",
        dispositionFor("三体_ 黑暗森林.html")
      )
    );

    renderShelf();
    await actAdvance(0);
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);

    expect(fetchMock).toHaveBeenCalledWith("/api/books/1/export");
    // The RFC 5987 form carries the real title; the ASCII fallback loses it.
    expect(downloaded).toEqual([
      { download: "三体_ 黑暗森林.html", href: "blob:annotated-book" },
    ]);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:annotated-book");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("survives header oddities: malformed extended form, missing header", async () => {
    renderShelf();
    await actAdvance(0);

    // A proxy could truncate the percent-encoding; the quoted plain form
    // still names the file.
    serveShelf(() =>
      htmlResponse(
        200,
        "<html>annotated</html>",
        "attachment; filename=\"Dark Forest.html\"; filename*=UTF-8''%E4%B9"
      )
    );
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);
    expect(downloaded.map((entry) => entry.download)).toEqual([
      "Dark Forest.html",
    ]);

    // No usable header at all: a neutral, legal name instead of a broken one.
    serveShelf(() => htmlResponse(200, "<html>annotated</html>"));
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);
    expect(downloaded.map((entry) => entry.download)).toEqual([
      "Dark Forest.html",
      "book.html",
    ]);
  });

  it("reports a not-ready book on 409 and saves no file", async () => {
    serveShelf(() => htmlResponse(409, '{"error":"book not ready"}'));

    renderShelf();
    await actAdvance(0);
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "导出失败：这本书还没完成导入。"
    );
    // Nothing was handed to the browser: no blob URL, no download click.
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloaded).toEqual([]);
  });

  it("reports a stale shelf on 404 and retries otherwise", async () => {
    renderShelf();
    await actAdvance(0);

    // 404: the row survived on screen but the book is gone.
    serveShelf(() => htmlResponse(404, '{"error":"book not found"}'));
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "导出失败：这本书不存在或已被删除。"
    );

    // 500 and network failures share the retryable copy.
    serveShelf(() => htmlResponse(500, "server exploded"));
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);
    expect(screen.getByRole("alert")).toHaveTextContent("导出失败，请重试。");

    serveShelf(() => {
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "导出《A Finished Book》" })
    );
    await actAdvance(0);
    expect(screen.getByRole("alert")).toHaveTextContent("导出失败，请重试。");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloaded).toEqual([]);
  });

  it("marks each clicked button in-flight; one settling leaves the other", async () => {
    shelfState.books = [
      readyBook,
      { ...readyBook, id: 4, title: "Second Ready" },
    ];
    const resolvers = new Map<number, (value: Response) => void>();
    serveShelf((url) => {
      const match = /\/api\/books\/(\d+)\/export$/.exec(url);
      const id = match?.[1] ? Number(match[1]) : 0;
      return new Promise<Response>((resolve) => {
        resolvers.set(id, resolve);
      });
    });

    renderShelf();
    await actAdvance(0);
    const first = screen.getByRole("button", {
      name: "导出《A Finished Book》",
    }) as HTMLButtonElement;
    const second = screen.getByRole("button", {
      name: "导出《Second Ready》",
    }) as HTMLButtonElement;
    fireEvent.click(first);
    fireEvent.click(second);
    await actAdvance(0);

    // Two flights, two markers: each button reads 导出中… and is disabled.
    expect(first.textContent).toBe("导出中…");
    expect(second.textContent).toBe("导出中…");
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    // Unrelated actions stay live during exports.
    expect(
      screen.getByRole("button", { name: "删除《A Finished Book》" })
    ).not.toBeDisabled();

    // The first settling recovers its own button only — a shared in-flight
    // marker would re-enable the second mid-download.
    resolvers.get(1)?.(htmlResponse(200, "<html>a</html>"));
    await actAdvance(0);
    expect(first).not.toBeDisabled();
    expect(first.textContent).toBe("导出");
    expect(second).toBeDisabled();

    resolvers.get(4)?.(htmlResponse(200, "<html>b</html>"));
    await actAdvance(0);
    expect(second).not.toBeDisabled();
    expect(second.textContent).toBe("导出");
  });
});
