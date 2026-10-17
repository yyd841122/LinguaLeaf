import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, fetchJson } from "./api";
import type { ReadingProgress } from "./readingProgress";

type BookSummary = {
  id: number;
  title: string;
  format: string;
  createdAt: string;
  progress: ReadingProgress | null;
};

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
      setError(
        error instanceof ApiError && error.status === 415
          ? "导入失败：只接受 .md 或 .markdown 文件（≤20MB）。"
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
          导入 Markdown 书籍
          <input type="file" name="file" accept=".md,.markdown" required />
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
                {/* Reopen where the reader left off (ticket 05): the link
                    lands on the saved chapter; the reading page restores the
                    saved block. */}
                <Link to={`/book/${book.id}/${book.progress?.chapter ?? 1}`}>
                  {book.title}
                </Link>
                <span className="meta">
                  {book.format} · 导入于 {formatImportedAt(book.createdAt)}
                  {book.progress ? ` · 读到第 ${book.progress.chapter} 章` : ""}
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
