import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { fetchJson } from "./api";
import { IpaSizeControl, useIpaSize } from "./IpaSizeControl";
import { ReadingView, type Block } from "./ReadingView";

type TableOfContents = {
  id: number;
  title: string;
  chapters: { position: number; title: string; level: number | null }[];
};

type ChapterContent = {
  position: number;
  title: string;
  blocks: Block[];
};

export function ReadingPage() {
  const { id, chapter } = useParams();
  const bookId = Number(id);
  const chapterNumber = Number(chapter);
  const [toc, setToc] = useState<TableOfContents | null>(null);
  const [content, setContent] = useState<ChapterContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ipaSize, setIpaSize] = useIpaSize();

  useEffect(() => {
    if (!Number.isInteger(bookId) || !Number.isInteger(chapterNumber)) {
      setError("阅读地址无效。");
      return;
    }
    let cancelled = false;
    setError(null);
    setToc(null);
    setContent(null);
    Promise.all([
      fetchJson<TableOfContents>(`/api/books/${bookId}`),
      fetchJson<ChapterContent>(
        `/api/books/${bookId}/chapters/${chapterNumber}`
      ),
    ])
      .then(([tocData, chapterData]) => {
        if (cancelled) return;
        setToc(tocData);
        setContent(chapterData);
      })
      .catch(() => {
        if (!cancelled) setError("这一章加载失败，可能不存在。");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterNumber]);

  if (error) {
    return (
      <main className="reading-page">
        <p role="alert" className="error">
          {error}
        </p>
        <Link to="/">← 回书架</Link>
      </main>
    );
  }
  if (!toc || !content) {
    return (
      <main className="reading-page">
        <p>加载中…</p>
      </main>
    );
  }

  const chapterCount = toc.chapters.length;
  return (
    <main className="reading-page">
      <header className="reading-header">
        <Link to="/">← 书架</Link>
        <span className="book-title">{toc.title}</span>
        <IpaSizeControl size={ipaSize} onChange={setIpaSize} />
      </header>
      <ReadingView chapter={content} ipaSize={ipaSize} />
      <nav className="chapter-nav" aria-label="章节导航">
        {chapterNumber > 1 && (
          <Link to={`/book/${bookId}/${chapterNumber - 1}`}>← 上一章</Link>
        )}
        {chapterNumber < chapterCount && (
          <Link to={`/book/${bookId}/${chapterNumber + 1}`}>下一章 →</Link>
        )}
      </nav>
    </main>
  );
}
