import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { fetchJson } from "./api";
import { useIpaSize } from "./IpaSizeControl";
import {
  ReadingSettings,
  useOriginalSize,
  useShowIpa,
  useShowTranslation,
} from "./ReadingSettings";
import {
  fetchReadingProgress,
  saveReadingProgress,
  topmostVisibleBlock,
  type ReadingProgress,
} from "./readingProgress";
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

const SAVE_DEBOUNCE_MS = 500;
// How long after the restore jump scroll events stay ignored: they are the
// jump's own events, not the reader moving on. A reader physically
// scrolling within this window of a chapter render is not a thing.
const RESTORE_SCROLL_GUARD_MS = 250;

export function ReadingPage() {
  const { id, chapter } = useParams();
  const bookId = Number(id);
  const chapterNumber = Number(chapter);
  const [toc, setToc] = useState<TableOfContents | null>(null);
  const [content, setContent] = useState<ChapterContent | null>(null);
  // "unavailable" = the progress could not be asked for (server hiccup):
  // nothing to restore, and the autosave must not write either, or it would
  // overwrite the reader's real position with top-of-chapter.
  const [progress, setProgress] = useState<
    ReadingProgress | null | "unavailable"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ipaSize, setIpaSize] = useIpaSize();
  const [originalSize, setOriginalSize] = useOriginalSize();
  const [showIpa, setShowIpa] = useShowIpa();
  const [showTranslation, setShowTranslation] = useShowTranslation();

  useEffect(() => {
    if (!Number.isInteger(bookId) || !Number.isInteger(chapterNumber)) {
      setError("阅读地址无效。");
      return;
    }
    let cancelled = false;
    setError(null);
    setToc(null);
    setContent(null);
    setProgress(null);
    // Progress rides along with the page fetch: a book never read has none
    // (null); a failed lookup parks the state as "unavailable" without
    // blocking the chapter from opening.
    Promise.all([
      fetchJson<TableOfContents>(`/api/books/${bookId}`),
      fetchJson<ChapterContent>(
        `/api/books/${bookId}/chapters/${chapterNumber}`
      ),
      fetchReadingProgress(bookId).catch(() => "unavailable" as const),
    ])
      .then(([tocData, chapterData, progressData]) => {
        if (cancelled) return;
        setToc(tocData);
        setContent(chapterData);
        setProgress(progressData);
      })
      .catch(() => {
        if (!cancelled) setError("这一章加载失败，可能不存在。");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterNumber]);

  // Reading progress (ticket 05): restore on open, autosave while reading.
  const skipSavesRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<ReadingProgress | null>(null);

  const flushSave = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) {
      void saveReadingProgress(bookId, pending).catch(() => {
        // A failed save must never disturb reading; the next scroll retries.
      });
    }
  };

  const scheduleSave = (next: ReadingProgress) => {
    pendingSaveRef.current = next;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  // Restore the saved position once the chapter renders: jump to the saved
  // block when this is the chapter the progress points at, otherwise start
  // at the top (React Router keeps scroll position across navigations).
  // Declared before the autosave effect so skipSavesRef is set before the
  // autosave effect decides whether to announce the chapter start.
  useEffect(() => {
    if (!content) return;
    const saved =
      progress !== null && progress !== "unavailable" ? progress : null;
    const restoreBlock =
      saved && saved.chapter === chapterNumber && saved.block > 1
        ? saved.block
        : null;
    const target =
      restoreBlock === null
        ? null
        : document.querySelector(`.blocks [data-position="${restoreBlock}"]`);
    if (target) {
      skipSavesRef.current = true;
      target.scrollIntoView();
      const guard = window.setTimeout(() => {
        skipSavesRef.current = false;
      }, RESTORE_SCROLL_GUARD_MS);
      return () => window.clearTimeout(guard);
    }
    skipSavesRef.current = false;
    window.scrollTo(0, 0);
  }, [content, chapterNumber, progress]);

  // Autosave: announce the chapter start, then follow scrolling. When the
  // saved position could not be asked for, write nothing until a real
  // scroll produces an observed position. The last pending position is
  // flushed on chapter switch / unmount / pagehide.
  useEffect(() => {
    if (!content) return;
    if (!skipSavesRef.current && progress !== "unavailable") {
      scheduleSave({ chapter: chapterNumber, block: 1 });
    }
    const onScroll = () => {
      if (skipSavesRef.current) return;
      const block = topmostVisibleBlock();
      if (block !== null) {
        scheduleSave({ chapter: chapterNumber, block });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flushSave);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flushSave);
      flushSave();
    };
  }, [content, chapterNumber]);

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
      <div className="reading-top">
        <header className="reading-header">
          <Link to="/">← 书架</Link>
          <span className="book-title">{toc.title}</span>
          <div className="reading-toolbar">
            <button
              type="button"
              aria-expanded={tocOpen}
              onClick={() => {
                setTocOpen((open) => !open);
                setSettingsOpen(false);
              }}
            >
              目录
            </button>
            <button
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => {
                setSettingsOpen((open) => !open);
                setTocOpen(false);
              }}
            >
              显示设置
            </button>
          </div>
        </header>
        {tocOpen && (
          <nav className="header-panel toc-panel" aria-label="目录">
            <ul>
              {toc.chapters.map((chapter) => (
                <li key={chapter.position}>
                  <Link
                    to={`/book/${bookId}/${chapter.position}`}
                    aria-current={
                      chapter.position === chapterNumber ? "page" : undefined
                    }
                    style={{
                      paddingLeft: `${((chapter.level ?? 1) - 1) * 0.9}rem`,
                    }}
                    onClick={() => setTocOpen(false)}
                  >
                    {chapter.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {settingsOpen && (
          <div className="header-panel">
            <ReadingSettings
              showIpa={showIpa}
              onShowIpaChange={setShowIpa}
              showTranslation={showTranslation}
              onShowTranslationChange={setShowTranslation}
              ipaSize={ipaSize}
              onIpaSizeChange={setIpaSize}
              originalSize={originalSize}
              onOriginalSizeChange={setOriginalSize}
            />
          </div>
        )}
      </div>
      <ReadingView
        chapter={content}
        ipaSize={ipaSize}
        originalSize={originalSize}
        showIpa={showIpa}
        showTranslation={showTranslation}
      />
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
