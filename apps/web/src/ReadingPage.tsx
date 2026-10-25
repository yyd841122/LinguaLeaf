import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { fetchJson } from "./api";
import { translateChapter } from "./chapterTranslation";
import type { BookToc, ChapterPayload } from "../../server/src/wire";
import { useTaskFollower } from "./taskFollower";
import { useIpaSize } from "./IpaSizeControl";
import {
  ReadingSettings,
  useOriginalSize,
  useShowIpa,
  useShowTranslation,
  useTranslationSize,
} from "./ReadingSettings";
import { useProgressSession } from "./progressSession";
import { ReadingView, type WordClick } from "./ReadingView";
import { WordLookupPopup } from "./WordLookupPopup";

// How often the chapter re-asks for its payload while a translation runs;
// mirrors the shelf's import poll (the task updates the percent per batch,
// so this needs to feel live, not be instant).
const TRANSLATION_POLL_MS = 1500;

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
  // The on-demand translation flow (ADR-0004): `startFailed` says the
  // trigger POST did not land; it clears on its own recovery (a retry or
  // a landing response) — a loop's last state must not outlive its
  // credibility (CODING_STANDARDS). The running poll's outage flag lives
  // in the task-follower below.
  const [startFailed, setStartFailed] = useState(false);
  // The route as of the latest render: a trigger's 202 that resolves after
  // a navigation is stale and must not patch the new chapter's state.
  const currentRouteRef = useRef({ bookId, chapterNumber });
  currentRouteRef.current = { bookId, chapterNumber };

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
    setStartFailed(false);
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

  // The translate trigger: the POST's 202 body is the chapter in its
  // brand-new translating state, patched in immediately (the shelf's
  // "202 body joins first" precedent — a failed refresh cannot masquerade
  // as a failed trigger). From there the poll below follows the lifecycle;
  // the button's disabled state keys on the server's status, never on the
  // POST having returned.
  const startTranslation = () => {
    setStartFailed(false);
    const route = { bookId, chapterNumber };
    // A navigation since the click makes the response stale: the page is
    // another chapter's now, and its own state must not be patched.
    const stale = () =>
      currentRouteRef.current.bookId !== route.bookId ||
      currentRouteRef.current.chapterNumber !== route.chapterNumber;
    translateChapter(bookId, chapterNumber)
      .then((state) => {
        if (stale()) return;
        // A landed trigger is the start-failure's recovery: in the
        // double-click race the losing 409's notice must not outlive the
        // translating state this response patches in.
        setStartFailed(false);
        setContent((current) => (current ? { ...current, ...state } : current));
      })
      .catch(() => {
        // The endpoint's 409s (already translating / no service) and every
        // other failure land here: a catchable notice, not a white screen.
        if (stale()) return;
        setStartFailed(true);
      });
  };

  // While this chapter translates, follow the task on the shared
  // task-follower (it owns the interval, the staleness discard, and the
  // outage rules): the percent moves the disabled button's label, and the
  // response that leaves 'translating' carries the fresh lines with it.
  // The active fact rides the payload, so route changes and settle both
  // tear the follow down; a landed tick is also the trigger-failure
  // notice's recovery.
  const translating = content?.translationStatus === "translating";
  const { outage: pollFailed } = useTaskFollower({
    active: translating,
    fetchTick: () =>
      fetchJson<ChapterPayload>(
        `/api/books/${bookId}/chapters/${chapterNumber}`
      ),
    onTick: (chapterData) => {
      setContent(chapterData);
      setStartFailed(false);
    },
    intervalMs: TRANSLATION_POLL_MS,
  });

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
                translationStatus — 翻译本章 / 翻译中 N% (disabled) /
                重新翻译. A failed chapter keeps 重新翻译: re-running is
                the recovery. */}
            <button
              type="button"
              disabled={
                content.translationStatus === "translating" ||
                !content.translationAvailable
              }
              onClick={startTranslation}
            >
              {content.translationStatus === "translating"
                ? `翻译中 ${content.translationPercent ?? 0}%`
                : content.translationStatus === "untranslated"
                  ? "翻译本章"
                  : "重新翻译"}
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
        <WordLookupPopup click={lookup} onClose={() => setLookup(null)} />
      ) : null}
      {saveFailed ? (
        <p role="status" className="save-warning">
          阅读进度保存失败，位置可能没有同步。
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
