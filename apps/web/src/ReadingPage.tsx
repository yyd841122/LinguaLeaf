import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { segmentOriginal } from "@lingualeaf/reading-model";
import { fetchJson } from "./api";
import { useChapterTranslation } from "./chapterTranslation";
import type {
  BookToc,
  BookmarkSummary,
  ChapterPayload,
  WordStatus,
} from "../../server/src/wire";
import { useIpaSize } from "./IpaSizeControl";
import { useBookmarksSession } from "./bookmarksSession";
import {
  ReadingSettings,
  useOriginalSize,
  useShowIpa,
  useShowTranslation,
  useTranslationSize,
} from "./ReadingSettings";
import { useProgressSession } from "./progressSession";
import { captureBookmarkTarget } from "./readingProgress";
import { ReadingView, type WordClick } from "./ReadingView";
import { WordLookupPopup } from "./WordLookupPopup";

// A panel entry's text after the chapter title (reading-bookmarks 03):
// the marked block's own original text, cut at 20 characters with an
// ellipsis — the text itself, never a 「第 M 句」 counter (spec red line;
// sentence/code/raw/image all carry originalText). Derivable only for the
// chapter whose payload is loaded: a foreign chapter's blocks are not on
// the client, and its entries fall back to the bare title rather than
// fabricate text.
function bookmarkEntryPrefix(
  bookmark: BookmarkSummary,
  content: ChapterPayload
): string | null {
  if (bookmark.chapter !== content.position) return null;
  const text = content.blocks.find(
    (block) => block.position === bookmark.block
  )?.originalText;
  if (text === undefined || text.trim().length === 0) return null;
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

export function ReadingPage() {
  const { id, chapter } = useParams();
  const bookId = Number(id);
  const chapterNumber = Number(chapter);
  const [toc, setToc] = useState<BookToc | null>(null);
  const [content, setContent] = useState<ChapterPayload | null>(null);
  // The route the loaded content belongs to. A navigation's first render has
  // the old content under the new chapter number; autosave keys on this
  // identity so that render never writes new-chapter/block-1 over the
  // reader's real position (audit 2026-10-23).
  const [loadedRoute, setLoadedRoute] = useState<{
    bookId: number;
    chapterNumber: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Display preferences are per book (per-book-toggles ticket 01): the
  // route's book id scopes every key, and an invalid id degrades to the
  // defaults inside prefs.ts while the error notice renders.
  const [ipaSize, setIpaSize] = useIpaSize(bookId);
  const [originalSize, setOriginalSize] = useOriginalSize(bookId);
  const [translationSize, setTranslationSize] = useTranslationSize(bookId);
  const [showIpa, setShowIpa] = useShowIpa(bookId);
  const [showTranslation, setShowTranslation] = useShowTranslation(bookId);
  // The word-lookup popup (ticket 06): which word was clicked, and where to
  // anchor it. Clicking another word re-anchors; leaving the chapter closes.
  const [lookup, setLookup] = useState<WordClick | null>(null);

  useEffect(() => {
    setLookup(null);
  }, [bookId, chapterNumber]);

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
      fetchJson<BookToc>(`/api/books/${bookId}`),
      fetchJson<ChapterPayload>(
        `/api/books/${bookId}/chapters/${chapterNumber}`
      ),
    ])
      .then(([tocData, chapterData]) => {
        if (cancelled) return;
        setToc(tocData);
        setContent(chapterData);
        setLoadedRoute({ bookId, chapterNumber });
      })
      .catch(() => {
        if (!cancelled) setError("这一章加载失败，可能不存在。");
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterNumber]);

  const ready =
    content !== null &&
    loadedRoute !== null &&
    loadedRoute.bookId === bookId &&
    loadedRoute.chapterNumber === chapterNumber;
  const { saveFailed } = useProgressSession({ bookId, chapterNumber, ready });
  // The book's manual marks (reading-bookmarks 03): the session fetches
  // once per book arm; create/remove failures speak through the same
  // inline flag as the progress saves.
  const {
    bookmarks,
    failed: bookmarksFailed,
    addBookmark,
    removeBookmark,
  } = useBookmarksSession({ bookId });

  const translating = content?.translationStatus === "translating";
  const {
    start: startTranslation,
    startFailed,
    pollFailed,
  } = useChapterTranslation({
    active: translating,
    bookId,
    chapterNumber,
    onTranslationState: (state) =>
      setContent((current) => (current ? { ...current, ...state } : current)),
    onTick: (chapterData) => setContent(chapterData),
  });

  const handleStatusApplied = (applied: {
    word: string;
    lemma: string | null;
    status: WordStatus;
  }) => {
    setContent((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block) => {
              if (block.kind !== "sentence") return block;
              const words = segmentOriginal(
                block.originalText,
                block.ipaSlots
              ).segments.filter((segment) => segment.kind === "word");
              return {
                ...block,
                // Exact surface and lemma strings only: the client has no
                // lemmatizer (popup-status-backedge spec, decision 2).
                wordStatuses: block.wordStatuses.map((status, index) => {
                  const word = words[index]?.word;
                  return word === applied.word ||
                    (applied.lemma !== null && word === applied.lemma)
                    ? applied.status
                    : status;
                }),
              };
            }),
          }
        : current
    );
  };

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
  // The chapter-level fact the two gates below key on (ticket 03): at
  // least one sentence block carries a non-empty translation. A wholly
  // untranslated chapter has no line to render and no toggle to offer;
  // individual holes — a failed sentence's null among translated
  // siblings — keep both alive with the pinned empty placeholder.
  const chapterHasTranslations = content.blocks.some(
    (block) =>
      block.kind === "sentence" &&
      block.translationText !== null &&
      block.translationText.trim().length > 0
  );
  return (
    <main className="reading-page">
      <div className="reading-top">
        <header className="reading-header">
          <Link to="/">← 书架</Link>
          <span className="book-title">{toc.title}</span>
          <div className="reading-toolbar">
            {/* 打书签 (reading-bookmarks 03, spec T10): the mark plants
                where the reader IS at the click instant — captured inside
                the handler, never after a response or a panel toggle
                rewrote the viewport. An empty chapter has no candidate:
                the button disables and block 1 is never fabricated. */}
            <button
              type="button"
              disabled={content.blocks.length === 0}
              onClick={() => {
                const target = captureBookmarkTarget(chapterNumber);
                if (target !== null) addBookmark(target);
              }}
            >
              打书签
            </button>
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
            {/* The third toolbar button, acting on the current chapter
                (ADR-0004): the shape keys on the payload's
                translationStatus — 翻译 (untranslated, or failed: no
                translation exists yet, the alert above carries the reason
                and re-running is the recovery) / 翻译中 N% (disabled) /
                已翻译 (disabled — a translated chapter is final;
                acceptance feedback 2026-10-26). */}
            <button
              type="button"
              disabled={
                content.translationStatus === "translating" ||
                content.translationStatus === "translated" ||
                !content.translationAvailable
              }
              onClick={startTranslation}
            >
              {content.translationStatus === "translating"
                ? `翻译中 ${content.translationPercent ?? 0}%`
                : content.translationStatus === "translated"
                  ? "已翻译"
                  : "翻译"}
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
            {/* The book's manual marks (reading-bookmarks 03): title plus
                the block's own text prefix; the current chapter's entries
                are buttons (jump stays inside the route), a foreign
                chapter's are links. */}
            <section className="bookmark-area" aria-label="书签">
              {bookmarks.length === 0 ? (
                <p className="bookmark-empty">
                  还没有书签，阅读时点顶栏「打书签」。
                </p>
              ) : (
                <ul className="bookmark-list">
                  {bookmarks.map((bookmark) => {
                    const chapterTitle =
                      toc.chapters.find(
                        (entry) => entry.position === bookmark.chapter
                      )?.title ?? `第 ${bookmark.chapter} 章`;
                    const prefix = bookmarkEntryPrefix(bookmark, content);
                    const entryBody = (
                      <>
                        <span className="bookmark-entry-title">
                          {chapterTitle}
                        </span>
                        {/* The separator rides a parent-level text node:
                            the accessible-name algorithm trims text at
                            element boundaries, so a separator inside the
                            prefix span would glue title and prefix
                            together for assistive tech. */}
                        {prefix !== null ? (
                          <>
                            {" · "}
                            <span className="bookmark-entry-prefix">
                              {prefix}
                            </span>
                          </>
                        ) : null}
                      </>
                    );
                    return (
                      <li key={bookmark.id} className="bookmark-item">
                        {bookmark.chapter === chapterNumber ? (
                          <button type="button" className="bookmark-entry">
                            {entryBody}
                          </button>
                        ) : (
                          <Link
                            className="bookmark-entry"
                            to={`/book/${bookId}/${bookmark.chapter}`}
                          >
                            {entryBody}
                          </Link>
                        )}
                        <button
                          type="button"
                          className="bookmark-delete"
                          aria-label={`删除「${chapterTitle}」的书签`}
                          onClick={() => removeBookmark(bookmark.id)}
                        >
                          删
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </nav>
        )}
        {settingsOpen && (
          <div className="header-panel">
            <ReadingSettings
              showIpa={showIpa}
              onShowIpaChange={setShowIpa}
              showTranslation={showTranslation}
              onShowTranslationChange={setShowTranslation}
              translationLinesAvailable={chapterHasTranslations}
              ipaSize={ipaSize}
              onIpaSizeChange={setIpaSize}
              originalSize={originalSize}
              onOriginalSizeChange={setOriginalSize}
              translationSize={translationSize}
              onTranslationSizeChange={setTranslationSize}
            />
          </div>
        )}
      </div>
      {content.translationAvailable ? null : (
        <p role="status" className="translation-hint">
          未配置翻译服务，暂时无法翻译；配置后此按钮恢复可用。
        </p>
      )}
      {content.translationStatus === "failed" && content.translationError ? (
        <p role="alert" className="error">
          {content.translationError}
        </p>
      ) : null}
      <ReadingView
        chapter={content}
        ipaSize={ipaSize}
        originalSize={originalSize}
        translationSize={translationSize}
        showIpa={showIpa}
        showTranslation={showTranslation && chapterHasTranslations}
        onWordClick={setLookup}
      />
      {lookup ? (
        <WordLookupPopup
          click={lookup}
          onClose={() => setLookup(null)}
          onStatusApplied={handleStatusApplied}
        />
      ) : null}
      {saveFailed ? (
        <p role="status" className="save-warning">
          阅读进度保存失败，位置可能没有同步。
        </p>
      ) : null}
      {bookmarksFailed ? (
        <p role="status" className="save-warning">
          书签操作失败，请重试。
        </p>
      ) : null}
      {startFailed ? (
        <p role="alert" className="error">
          翻译启动失败，请重试。
        </p>
      ) : null}
      {translating && pollFailed ? (
        <p role="alert" className="error">
          无法连接服务端，翻译进度可能已过期——请确认服务端正在运行。
        </p>
      ) : null}
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
