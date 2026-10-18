import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, fetchJson } from "./api";
import type { ReadingProgress } from "./readingProgress";

type BookStatus = "importing" | "ready" | "failed";

type BookSummary = {
  id: number;
  title: string;
  format: string;
  createdAt: string;
  // The async import lifecycle (ticket 08): 'importing' books show live
  // progress on the shelf, 'failed' books show the reason, 'ready' books
  // are the readable links.
  status: BookStatus;
  importStage: string | null;
  importPercent: number | null;
  importError: string | null;
  progress: ReadingProgress | null;
};

// How often the shelf re-asks for the book list while an import is in
// flight; the import task updates progress per translation batch, so this
// only needs to feel live, not be instant.
const IMPORT_POLL_MS = 1500;

// Server-side import stages (import-task.ts) as shelf copy; only
// 'translating' lasts long enough to carry a percent. An unknown stage
// (server newer than this page) falls back to a neutral label rather than
// a raw enum value.
const IMPORT_STAGE_LABELS: Record<string, string> = {
  annotating: "标注生成中",
  translating: "翻译译文",
  saving: "保存书籍",
};

function importStageLabel(book: BookSummary): string {
  const label = book.importStage
    ? (IMPORT_STAGE_LABELS[book.importStage] ?? "处理中")
    : "";
  return book.importPercent !== null
    ? `${label} ${book.importPercent}%`
    : label;
}

function formatImportedAt(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function BookshelfPage() {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ books: BookSummary[] }>("/api/books")
      .then((data) => {
        if (!cancelled) setBooks(data.books);
      })
      .catch(() => {
        if (!cancelled) setError("书架加载失败，请确认服务端正在运行。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // While any book is importing, the shelf re-asks the list on an interval
  // so statuses and progress move without user action; the moment none is,
  // the interval goes away.
  const hasImporting =
    books?.some((book) => book.status === "importing") ?? false;
  useEffect(() => {
    if (!hasImporting) return;
    const interval = setInterval(() => {
      fetchJson<{ books: BookSummary[] }>("/api/books")
        .then((data) => setBooks(data.books))
        .catch(() => {
          // Transient: keep the shelf as-is; the next tick retries.
        });
    }, IMPORT_POLL_MS);
    return () => clearInterval(interval);
  }, [hasImporting]);

  const uploadBook = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      await fetchJson("/api/books", { method: "POST", body });
      const { books: refreshed } = await fetchJson<{ books: BookSummary[] }>(
        "/api/books"
      );
      setBooks(refreshed);
    } catch (error) {
      // The server's status families: 415 unknown extension (pick another
      // file), 400 unparseable EPUB (retrying cannot fix the file), others
      // genuinely worth a retry.
      setError(
        error instanceof ApiError && error.status === 415
          ? "导入失败：只接受 .epub、.md 或 .markdown 文件（≤20MB）。"
          : error instanceof ApiError && error.status === 400
            ? "导入失败：文件无法解析，可能已损坏。"
            : "导入失败，请重试。"
      );
    } finally {
      setImporting(false);
    }
  };

  const removeBook = async (book: BookSummary) => {
    if (!window.confirm(`删除《${book.title}》？书和它的标注会一并移除。`)) {
      return;
    }
    setError(null);
    try {
      await fetchJson(`/api/books/${book.id}`, { method: "DELETE" });
      // Update the list in place — no refetch flash.
      setBooks((current) =>
        current ? current.filter((candidate) => candidate.id !== book.id) : null
      );
    } catch {
      setError("删除失败，请重试。");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement && input.files?.[0];
    if (file) void uploadBook(file);
  };

  return (
    <main className="bookshelf">
      <h1>LinguaLeaf</h1>
      <p className="subtitle">英文电子书标注阅读器</p>

      <form onSubmit={handleSubmit}>
        <label>
          导入 EPUB / Markdown 书籍
          <input
            type="file"
            name="file"
            accept=".epub,.md,.markdown"
            required
          />
        </label>
        <button type="submit" disabled={importing}>
          {importing ? "导入中…" : "导入"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <h2>书架</h2>
      {books === null ? (
        <p>加载中…</p>
      ) : books.length === 0 ? (
        <p>还没有书，先导入一本吧。</p>
      ) : (
        <ul className="book-list">
          {books.map((book) => (
            <li key={book.id}>
              <div className="book-info">
                {/* Only settled books open: an importing book has no
                    chapters yet and a failed one never will (ticket 08).
                    Reopen where the reader left off (ticket 05): the link
                    lands on the saved chapter; the reading page restores
                    the saved block. */}
                {book.status === "ready" ? (
                  <Link to={`/book/${book.id}/${book.progress?.chapter ?? 1}`}>
                    {book.title}
                  </Link>
                ) : (
                  <span>{book.title}</span>
                )}
                <span className="meta">
                  {book.status === "importing"
                    ? `导入中 · ${importStageLabel(book)}`
                    : book.status === "failed"
                      ? `导入失败：${book.importError ?? "未知错误"}`
                      : `${book.format} · 导入于 ${formatImportedAt(book.createdAt)}${
                          book.progress
                            ? ` · 读到第 ${book.progress.chapter} 章`
                            : ""
                        }`}
                </span>
              </div>
              <button
                type="button"
                className="delete-book"
                aria-label={`删除《${book.title}》`}
                onClick={() => void removeBook(book)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
