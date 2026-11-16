import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  useOwner,
  useSettle,
  type WordClick,
} from "@lingualeaf/reading-model/react";
import { segmentOriginal, type StatusApplied } from "@lingualeaf/reading-model";
import type { ExtBlock, ExtBook } from "./import-book";
import type { VocabularyStore, VocabState } from "../store/vocabulary-store";
import type { ChapterProgress, LibraryStore } from "../store/library-store";
import type { NotesStore } from "../store/notes-store";
import type { TranslationStore } from "../store/translation-store";
import {
  byReadingOrder,
  isEpubRow,
  type BookmarkRow,
  type BookmarkStore,
  type EpubBookmarkRow,
  type EpubBookmarkTarget,
} from "../store/bookmark-store";
import type { TranslateSettingsStore } from "../store/translate-settings-store";
import {
  chapterTasks as defaultRegistry,
  type ChapterTaskRegistry,
} from "../translate/chapter-tasks";
import {
  createDeepSeekTranslator,
  DEFAULT_TRANSLATION_STYLE_PROMPT,
} from "../translate/deepseek";
import {
  isConfigured,
  type TranslateSettings,
} from "../store/translate-settings-store";
import { TranslateFailureFlag } from "../translate/TranslateFailureFlag";
import { EpubChapter } from "./EpubChapter";
import type { NoteEditorHandle } from "./NoteEditor";
import { WordLookupPopup } from "./WordLookupPopup";
import { formatPlantedAt } from "./bookmark-view";
import type {
  PdfToolbarPosition,
  UiSettingsStore,
} from "../store/ui-settings-store";

// The settled-failure copy (ticket 04): a chapter whose every sentence
// came back null. The Translator contract reports wrong key and network
// down the same way (all null), so the copy names both and points at the
// settings page.
const TRANSLATION_FAILURE_COPY =
  "翻译失败：无法连接翻译服务，或密钥无效。请检查网络与设置页中的配置，然后重试。";

// The reading-walk anchor the progress save and the bookmark plant share:
// the last block whose top has crossed under the sticky head's bottom —
// measured live, not a constant: the head is tall in portrait (the title
// wraps) and short in landscape, and the fixed landscape-height guess
// named blocks still hidden behind the portrait head (人验 round 4). One
// rule for both callers — a planted mark lands exactly where progress
// would say the reader is, never a second opinion (ticket 10).
const readingAnchorTop = (): number =>
  document.querySelector<HTMLElement>(".reader-head")?.getBoundingClientRect()
    .bottom ?? 96;
const topmostVisibleBlockIndex = (): number => {
  const anchorTop = readingAnchorTop();
  let current = 0;
  for (const block of document.querySelectorAll<HTMLElement>(
    "[data-block-index]"
  )) {
    if (block.getBoundingClientRect().top <= anchorTop) {
      current = Number(block.dataset.blockIndex ?? 0);
    }
  }
  return current;
};

// The bookmark plant's target: the topmost visible SENTENCE block — the
// 落位契约 (ticket 10: 打书签坐标 = 最顶可见 sentence 块). The geometry
// walk is the progress save's rule narrowed by the chapter data: the DOM
// anchors carry every block kind (EpubChapter mounts [data-block-index]
// on raw/code/image too, for the jump technique), so the kind filter
// rides the blocks, not the DOM. No sentence block crossed yet falls
// back to the chapter top (block 0), the walk's own initial value.
const topmostVisibleSentenceIndex = (
  blocks: ExtBlock[] | undefined
): number => {
  if (!blocks) return 0;
  const anchorTop = readingAnchorTop();
  // Base = the chapter's FIRST sentence: when no sentence has crossed
  // the anchor yet (a plain block leads the chapter and the first
  // sentence still sits below the head), the plant still lands on a
  // SENTENCE — the 落位契约. A constant-0 base planted the leading
  // image's own coordinate (the review's probe); no sentence at all
  // falls back to 0, the progress walk's chapter-top answer.
  let current = Math.max(
    0,
    blocks.findIndex((b) => b.kind === "sentence")
  );
  for (const block of document.querySelectorAll<HTMLElement>(
    "[data-block-index]"
  )) {
    if (block.getBoundingClientRect().top > anchorTop) continue;
    const index = Number(block.dataset.blockIndex ?? 0);
    if (blocks[index]?.kind === "sentence") current = index;
  }
  return current;
};

// The bookmark row's planted-at stamp lives in ./bookmark-view — one
// definition for both faces.

// EPUB owns its tint walk, popup and progress; the host owns book/chapter
// selection and the injected seams. Remounting for each open clears tints,
// while chapter switches preserve local patches over in-flight bulk reads.
export function EpubReader({
  docId,
  book,
  chapterIndex,
  showIpa,
  resolvedStore,
  notes,
  library,
  translations,
  settings,
  bookmarks,
  registry = defaultRegistry,
  settingsRevision = 0,
  editorRef,
  restoreRef,
  scrollSaveAt,
  uiSettings,
  onChapter,
  onToggleIpa,
  onOpenSettings,
  onReopen,
}: {
  docId: string;
  book: ExtBook;
  chapterIndex: number;
  showIpa: boolean;
  resolvedStore: VocabularyStore | null;
  notes: NotesStore;
  library: LibraryStore;
  translations: TranslationStore;
  settings: TranslateSettingsStore;
  // The bookmark seam (ticket 10): planted marks for this document.
  bookmarks: BookmarkStore;
  // The chapter task registry (module-level by default; injected for
  // tests): the task outlives chapter switches and this face's remounts.
  registry?: ChapterTaskRegistry;
  // Bumped by the host whenever the settings overlay closes — the trigger
  // re-reads its configured fact without remounting this face.
  settingsRevision?: number;
  editorRef: RefObject<NoteEditorHandle | null>;
  restoreRef: RefObject<ChapterProgress | null>;
  scrollSaveAt: RefObject<number>;
  // The reader's global face preferences (toolbar position, round 14) —
  // the EPUB face shares the PDF face's choice.
  uiSettings?: UiSettingsStore | undefined;
  onChapter: (index: number) => void;
  onToggleIpa: () => void;
  onOpenSettings: () => void;
  onReopen: () => void;
}) {
  const closeNote = () => editorRef.current?.requestClose() !== false;
  // The reading walk's tint source: state key → 生词本 state, loaded per
  // chapter and patched by the popup's applyStatus.
  const [wordStates, setWordStates] = useState<Map<string, VocabState>>(
    new Map()
  );
  const [lookup, setLookup] = useState<WordClick | null>(null);
  // The translation face (ticket 04): settled 译文行 per block index for
  // the current chapter (null until the read lands), the running task's
  // percent (null when none), the display 开关, and the failure flag.
  const [showTranslation, setShowTranslation] = useState(true);
  const [chapterTranslations, setChapterTranslations] = useState<Record<
    number,
    string
  > | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [taskPercent, setTaskPercent] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The runtime settings, held so the trigger starts the task
  // synchronously at the click (the envelope's sync-start precedent) —
  // re-read on mount and whenever the settings overlay closes
  // (settingsRevision). Null until the read lands: the trigger stays
  // locked, and a failed read reads as unconfigured.
  const [settingsValue, setSettingsValue] = useState<TranslateSettings | null>(
    null
  );
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  // The bookmark face (ticket 10): the panel's rows (null until the open's
  // read lands), the read's retry counter, and the pending jump a row
  // click arms.
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [bookmarkRows, setBookmarkRows] = useState<BookmarkRow[] | null>(null);
  // The panel's own loading surface, deliberately separate from the
  // shared snapshot: wiping bookmarkRows on open used to blank the
  // in-text markers too (they derive from these rows), and a close
  // before the refetch landed — the cleanup invalidates the read's
  // ticket — left them gone for good while the store still held the
  // marks. The snapshot now survives the open/close; only the panel's
  // spinner waits on the refetch.
  const [panelRowsLoading, setPanelRowsLoading] = useState(false);
  const [bookmarkAttempt, setBookmarkAttempt] = useState(0);
  const [jumpTarget, setJumpTarget] = useState<EpubBookmarkTarget | null>(null);

  // Per-chapter 生词本 states for the tints. Bulk reads land by merge:
  // keys the local map already holds win, so a popup patch (or a bulk read
  // that began before it) can never revert what the reader just changed.
  // The read adjudicates through its own channel: teardown invalidates the
  // read's ticket (the cancelled flag this replaces), so a chapter's late
  // answer cannot speak for the chapter the reader moved to. A failed read
  // stays silent — the tint is best-effort, and the flag has no surface.
  const tintOwner = useOwner();
  const tintSettle = useSettle(tintOwner);
  // Destructured: the channel object follows the flag, but run is stable —
  // the effect must not re-arm because a read failed somewhere.
  const runTintRead = tintSettle.run;
  useEffect(() => {
    if (!resolvedStore) return;
    const chapter = book.chapters[chapterIndex];
    if (!chapter) return;
    const keys = new Set<string>();
    for (const block of chapter.blocks) {
      if (block.kind !== "sentence") continue;
      for (const segment of segmentOriginal(block.text, block.ipaSlots)
        .segments) {
        if (segment.kind === "word")
          keys.add(resolvedStore.stateKey(segment.word));
      }
    }
    void runTintRead(resolvedStore.statesFor([...keys]), {
      onFresh: (found) => {
        setWordStates((current) => {
          const next = new Map(current);
          for (const [key, value] of found) {
            if (!next.has(key)) next.set(key, value);
          }
          return next;
        });
      },
    });

    return () => {
      tintOwner.invalidate();
    };
  }, [book, chapterIndex, resolvedStore, runTintRead, tintOwner]);

  // Progress persistence: on a scroll, the topmost visible block index is
  // written to the seam, throttled — a closed tab loses at most one
  // throttle window of drift.
  const readingKey = `${docId}:${chapterIndex}`;
  useEffect(() => {
    const onScroll = () => {
      const now = Date.now();
      if (now - scrollSaveAt.current < 400) return;
      scrollSaveAt.current = now;
      void library.setProgress(docId, {
        chapterIndex,
        blockIndex: topmostVisibleBlockIndex(),
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [readingKey, library, docId, chapterIndex, scrollSaveAt]);

  // 重开扩展回到原处: after a reopened document's chapter renders, jump to
  // its saved block. restoreRef is a deliberate one-shot channel, not
  // reactive state. The host fills the ref before mounting this face;
  // chapter changes never re-arm a consumed position.
  useEffect(() => {
    const restore = restoreRef.current;
    if (!restore) return;
    restoreRef.current = null;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-block-index='${restore.blockIndex}']`
      );
      // Centered: the anchored block lands mid-viewport, clear of the
      // sticky head however tall it sits in either orientation (the
      // top-aligned scroll-margin guess was portrait-wrong).
      el?.scrollIntoView?.({ block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [readingKey, restoreRef]);

  // Chapter-scoped translation state resets when the chapter changes: a
  // stale chapter's percent or failure flag must not speak for the
  // chapter the reader moved to (declared before the subscription below,
  // so the replay of a still-running task re-arms the percent after the
  // reset on the very same commit).
  useEffect(() => {
    setChapterTranslations(null);
    setTaskPercent(null);
    setFailure(null);
  }, [readingKey]);

  // The chapter's settled 译文行, read per chapter through its own
  // settle channel: teardown invalidates the read's ticket, so a late
  // answer cannot speak for the chapter the reader moved to (the tint
  // read's same shape). A fresh re-read rides readAttempt — the task's
  // settled-translated event bumps it.
  const translationsOwner = useOwner();
  const translationsSettle = useSettle(translationsOwner);
  const runTranslationsRead = translationsSettle.run;
  useEffect(() => {
    const chapter = book.chapters[chapterIndex];
    if (!chapter) return;
    void runTranslationsRead(translations.getChapter(docId, chapterIndex), {
      onFresh: (record) => setChapterTranslations(record),
    });
    return () => translationsOwner.invalidate();
  }, [
    book,
    chapterIndex,
    docId,
    translations,
    readAttempt,
    runTranslationsRead,
    translationsOwner,
  ]);

  // The chapter task's live events. The subscription re-arms per chapter
  // (teardown unsubscribes — a late event for the chapter left behind has
  // no listener here, and the registry replays the running percent on
  // re-arm, so re-entering a translating chapter restores its label).
  useEffect(() => {
    return registry.subscribe(docId, chapterIndex, (event) => {
      if (event.kind === "progress") {
        setTaskPercent(event.percent);
        return;
      }
      setTaskPercent(null);
      if (event.outcome === "translated") {
        setReadAttempt((value) => value + 1);
      } else {
        setFailure(TRANSLATION_FAILURE_COPY);
      }
    });
  }, [docId, chapterIndex, registry]);

  // The configured fact: read on mount and whenever the settings overlay
  // closes (settingsRevision) or a failed read is retried. The read rides
  // the plain cancelled flag — same data every pass, no re-entrant cycle
  // (CODING_STANDARDS: the flag and the token are not interchangeable;
  // this read has no key cycle to revive). A failed read is its own
  // readable state — it must not masquerade as 未配置 or freeze as
  // still-loading.
  useEffect(() => {
    let cancelled = false;
    setSettingsLoadFailed(false);
    void settings
      .load()
      .then((value) => {
        if (!cancelled) setSettingsValue(value);
      })
      .catch(() => {
        if (!cancelled) setSettingsLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [settings, settingsRevision, settingsAttempt]);

  // 工具栏位置 (round 14): the EPUB face shares the PDF face's global
  // choice — top (under the title) or a fixed bar at the viewport's
  // bottom edge; the toggle rides the row itself (置底/置顶).
  const [toolbarPosition, setToolbarPosition] =
    useState<PdfToolbarPosition>("top");
  const toolbarOwner = useOwner();
  const { run: runToolbar } = useSettle(toolbarOwner);
  useEffect(() => {
    if (!uiSettings) return;
    void runToolbar(uiSettings.load(), {
      onFresh: (settings) => setToolbarPosition(settings.pdfToolbar),
    });
    return () => toolbarOwner.invalidate();
  }, [uiSettings, runToolbar, toolbarOwner]);
  const moveToolbar = () => {
    const next: PdfToolbarPosition =
      toolbarPosition === "top" ? "bottom" : "top";
    setToolbarPosition(next);
    void uiSettings?.savePdfToolbar(next);
  };
  const bookmarksOwner = useOwner();
  const bookmarksSettle = useSettle(bookmarksOwner);
  const runBookmarks = bookmarksSettle.run;

  // The document's marks, read once per open through the ops' shared
  // channel: the face's in-text markers ride these rows, and the plant's
  // same-position idempotence starts from this baseline. A failed read is
  // silent here — markers are best-effort, and the panel's open refetches
  // through the same channel and flags fresh failures.
  useEffect(() => {
    void runBookmarks(bookmarks.list(docId), {
      onFresh: (rows) => setBookmarkRows(rows),
    });
    return () => bookmarksOwner.invalidate();
  }, [bookmarks, docId, runBookmarks, bookmarksOwner]);

  // The bookmark panel's list: read on every open — a fresh open refetches
  // (the web session's same trade: stale client rows lose to fresh truth)
  // — through the one settle channel the ops share. Teardown invalidates
  // the read's ticket: a closed panel's late list cannot outvote the
  // reopened panel's own read. The shared snapshot is NOT wiped here —
  // the panel's wait rides panelRowsLoading, so the in-text markers keep
  // reading the last landed rows through an open, a slow read, or a
  // close before the read lands.
  useEffect(() => {
    if (!showBookmarks) return;
    setPanelRowsLoading(true);
    void runBookmarks(bookmarks.list(docId), {
      onFresh: (rows) => {
        setBookmarkRows(rows);
        setPanelRowsLoading(false);
      },
    });
    return () => {
      bookmarksOwner.invalidate();
      setPanelRowsLoading(false);
    };
  }, [
    bookmarks,
    docId,
    showBookmarks,
    bookmarkAttempt,
    runBookmarks,
    bookmarksOwner,
  ]);

  // A row click's jump: anchor the block once the chapter has rendered —
  // the restore-scroll effect's same rAF + data-block-index technique,
  // state-driven here because a click, not a ref, arms it. A jump whose
  // chapter never lands (a replaced book's out-of-range mark) simply sits
  // unarmed until the next jump replaces it.
  useEffect(() => {
    if (!jumpTarget || jumpTarget.chapter !== chapterIndex) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-block-index='${jumpTarget.block}']`)
        // Centered: the pin and its marked block present themselves
        // mid-viewport, clear of the sticky head at any height.
        ?.scrollIntoView?.({ block: "center" });
      setJumpTarget(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [jumpTarget, chapterIndex]);

  // The trigger: the cached settings start the task synchronously; the
  // registry refuses a second task for a running chapter. A fresh
  // attempt clears the failure flag (intent-side clear; the channel
  // never clears on start).
  const startTranslation = () => {
    const chapter = book.chapters[chapterIndex];
    const value = settingsValue;
    if (!chapter || !value || !isConfigured(value)) return;
    if (registry.isRunning(docId, chapterIndex)) return;
    const started = registry.start(
      {
        translator: createDeepSeekTranslator({
          apiKey: value.apiKey.trim(),
          baseUrl: value.baseUrl,
          model: value.model,
          stylePrompt: DEFAULT_TRANSLATION_STYLE_PROMPT,
        }),
        translations,
      },
      docId,
      chapterIndex,
      chapter
    );
    if (started) setFailure(null);
  };

  // The popup's status operation lands here first: the tint updates with
  // the write (即时生效), keyed by the store's one state-key rule.
  const handleStatusApplied = (applied: StatusApplied) => {
    if (!resolvedStore) return;
    const key = resolvedStore.stateKey(applied.word);
    setWordStates((current) => {
      const next = new Map(current);
      next.set(key, applied.status);
      return next;
    });
  };

  const chapter = book.chapters[chapterIndex];
  // This face is EPUB-only: the store's rows are kind-unioned since the
  // PDF face (ticket 03) joined, and a doc never mixes kinds — the narrow
  // here is the type-level statement of that fact.
  const epubBookmarkRows = useMemo(
    () => (bookmarkRows ?? []).filter(isEpubRow),
    [bookmarkRows]
  );
  // The face's in-text markers: the current chapter's planted blocks,
  // derived from the doc-wide rows — a chapter switch re-derives without a
  // refetch, and a plant/remove lands here through the local merges.
  const markedBlocks = useMemo(
    () =>
      new Set(
        epubBookmarkRows
          .filter((row) => row.chapter === chapterIndex)
          .map((row) => row.block)
      ),
    [epubBookmarkRows, chapterIndex]
  );
  // The tint walk reads the merged map through the store's one key rule.
  const stateOf = (word: string): VocabState | null =>
    resolvedStore?.stateKey(word) != null
      ? (wordStates.get(resolvedStore.stateKey(word)) ?? null)
      : null;
  const goChapter = (index: number) => {
    if (
      index !== chapterIndex &&
      index >= 0 &&
      index < book.chapters.length &&
      closeNote()
    ) {
      setLookup(null);
      onChapter(index);
      // The chapter switch is itself a position fact — written straight
      // to the seam (scroll writes cover the within-chapter drift).
      void library.setProgress(docId, { chapterIndex: index, blockIndex: 0 });
      // The seam says block 0; the viewport must agree. Window scroll
      // persists across the chapter swap (the EPUB face scrolls the
      // window), so without this reset the reader lands mid-chapter at
      // the inherited offset — invisible while the new chapter is
      // shorter than the offset (the clamp fakes a reset), glaring once
      // a book ships a tall chapter after a tall one (mobile-md-import
      // 真机 round 1; regression: scripts/browser-e2e/mobile-md-chapter-scroll.mjs).
      // The scroll event lands after React commits, so the throttled
      // save re-arms with the NEW chapter closure and rewrites the same
      // {index, 0} — the write ordering is benign.
      window.scrollTo(0, 0);
    }
  };
  // 打书签: the plant lands on the position progress would report,
  // narrowed to the blocks a bookmark may land on (the topmost visible
  // sentence block — the 落位契约) — and the store's same-position
  // idempotence makes a double click one mark.
  const plantBookmark = () => {
    void runBookmarks(
      bookmarks.add(docId, {
        chapter: chapterIndex,
        block: topmostVisibleSentenceIndex(chapter?.blocks),
      }),
      {
        onFresh: (row) =>
          setBookmarkRows((current) => {
            const rows = current ?? [];
            // The store's idempotence returns the existing row for a
            // replant; the local merge keeps the web session's shape —
            // known id no-ops, fresh row re-enters reading order.
            return rows.some((existing) => existing.id === row.id)
              ? rows
              : [...rows, row].sort(byReadingOrder);
          }),
      }
    );
  };
  const removeBookmark = (id: number) => {
    void runBookmarks(bookmarks.remove(docId, id), {
      onFresh: () =>
        setBookmarkRows((current) =>
          (current ?? []).filter((row) => row.id !== id)
        ),
    });
  };
  // 跳回: the row's chapter rides the TOC's own goChapter (the progress
  // write it makes is the chapter fact; the block anchor lands right
  // after), and the panel closes — the jump is the reader's next fact.
  const jumpToBookmark = (row: EpubBookmarkRow) => {
    if (!closeNote()) return;
    setLookup(null);
    setShowBookmarks(false);
    setJumpTarget({ chapter: row.chapter, block: row.block });
    if (row.chapter !== chapterIndex) goChapter(row.chapter);
  };
  // The trigger's three facts (web's same shape): running → 翻译中 N%
  // locked; settled with lines → 已翻译 locked (the web reading page's
  // client-side disable — the server route itself only 409s a chapter
  // already translating); otherwise 翻译, armed only when the stored
  // lines have been read (the gating read) and a key is configured.
  const translatedCount = chapterTranslations
    ? Object.keys(chapterTranslations).length
    : 0;
  const translateLabel =
    taskPercent !== null
      ? `翻译中 ${taskPercent}%`
      : translatedCount > 0
        ? "已翻译"
        : "翻译";
  const translateDisabled =
    taskPercent !== null ||
    translatedCount > 0 ||
    chapterTranslations === null ||
    settingsValue === null ||
    !isConfigured(settingsValue);
  const toolsRow = (
    <div
      className={`reader-tools${toolbarPosition === "bottom" ? " reader-tools-fixed" : ""}`}
    >
      {/* 显示开关 (GLOSSARY): hides the transcription line while the
          word units stay — clean reading and annotated reading
          switch instantly. */}
      <button
        type="button"
        className="reader-toggle"
        aria-pressed={showIpa}
        onClick={onToggleIpa}
      >
        音标
      </button>
      {/* The 译文行 显示开关 (GLOSSARY 译文行): same instant
          show/hide over the settled translations. */}
      <button
        type="button"
        className="reader-toggle"
        aria-pressed={showTranslation}
        onClick={() => setShowTranslation((shown) => !shown)}
      >
        译文
      </button>
      {/* 按需翻译 (GLOSSARY) trigger, one task per chapter (the
          registry refuses a second); the percent rides the label. */}
      <button
        type="button"
        className="reader-translate"
        disabled={translateDisabled}
        onClick={startTranslation}
      >
        {translateLabel}
      </button>
      <button
        type="button"
        className="reader-settings"
        onClick={() => {
          if (!closeNote()) return;
          onOpenSettings();
        }}
      >
        设置
      </button>
      {/* The chapter list lives behind the 目录 button in an overlay
          (真机 md round 3): the inline nav was a screen-tall strip above
          every page for a many-chapter book. One entry, every chapter;
          the jump inherits goChapter's dirty-note guard. */}
      <button
        type="button"
        className="reader-toggle"
        onClick={() => {
          if (!closeNote()) return;
          setLookup(null);
          setShowToc(true);
        }}
      >
        目录
      </button>
      {/* 书签 (ticket 10): the panel plants a mark at the current
          position, lists them in reading order, jumps back, deletes. */}
      <button
        type="button"
        className="reader-bookmarks"
        onClick={() => {
          if (!closeNote()) return;
          setLookup(null);
          setShowBookmarks(true);
        }}
      >
        书签
      </button>
      <button type="button" className="reader-toggle" onClick={moveToolbar}>
        {toolbarPosition === "top" ? "置底" : "置顶"}
      </button>
      <button
        type="button"
        className="reader-reopen"
        onClick={() => {
          if (!closeNote()) return;
          setLookup(null);
          onReopen();
        }}
      >
        {/* 返回, not 打开: the action is navigation back to the shelf,
            and the navigation-shaped label is the discoverable one
            (真机 md round 4 — the PDF face's own 打开 stays as is). */}
        返回
      </button>
    </div>
  );

  return (
    <main
      className={`reader${toolbarPosition === "bottom" ? " reader-epub-bottom" : ""}`}
      aria-label="扩展阅读页"
    >
      <header className="reader-head">
        <h1 className="reader-title">{book.title}</h1>
        {toolbarPosition === "top" ? toolsRow : null}
      </header>
      {settingsLoadFailed ? (
        <p className="reader-error" role="alert">
          设置读取失败，翻译按钮暂不可用。
          <button
            type="button"
            onClick={() => setSettingsAttempt((value) => value + 1)}
          >
            重试读取设置
          </button>
        </p>
      ) : null}
      {settingsValue !== null && !isConfigured(settingsValue) ? (
        <p className="reader-hint">
          未配置翻译服务，暂时无法翻译；在设置页填写 API Key 后此按钮恢复可用。
        </p>
      ) : null}
      {translationsSettle.failed ? (
        <p className="reader-error" role="alert">
          译文读取失败，无法确认已有译文。
          <button
            type="button"
            onClick={() => setReadAttempt((value) => value + 1)}
          >
            重试读取译文
          </button>
        </p>
      ) : null}
      {chapter ? (
        <EpubChapter
          key={`${docId}:${chapterIndex}`}
          docId={docId}
          chapterIndex={chapterIndex}
          chapter={chapter}
          notes={notes}
          showIpa={showIpa}
          translations={chapterTranslations ?? {}}
          showTranslation={showTranslation}
          markedBlocks={markedBlocks}
          statusOf={(word) => stateOf(word)}
          onWordClick={setLookup}
          onOpenNote={() => setLookup(null)}
          editorRef={editorRef}
        />
      ) : null}
      {lookup && resolvedStore ? (
        <WordLookupPopup
          click={lookup}
          store={resolvedStore}
          onClose={() => setLookup(null)}
          onStatusApplied={handleStatusApplied}
        />
      ) : null}
      {failure ? (
        <TranslateFailureFlag
          message={failure}
          onClose={() => setFailure(null)}
        />
      ) : null}
      {showBookmarks ? (
        <div className="overlay-veil" role="dialog" aria-label="书签">
          <div className="overlay-card bookmark-card">
            <h2 className="overlay-title">书签</h2>
            <button
              type="button"
              className="bookmark-plant"
              // The plant waits for the open's read: planting into a
              // pending list would merge the row locally, only for the
              // older snapshot to overwrite the panel when its read
              // lands (one channel, no invalidate between the marks).
              disabled={panelRowsLoading}
              onClick={plantBookmark}
            >
              在当前位置打书签
            </button>
            {/* One channel for the list and both ops: a fresh failure
                raises this flag, a fresh success retires it (the channel
                never clears on a run's start). The retry re-reads the
                list — fresh truth also settles a failed op's aftermath. */}
            {bookmarksSettle.failed ? (
              <p className="reader-error" role="alert">
                书签操作失败，请重试。
                <button
                  type="button"
                  onClick={() => setBookmarkAttempt((value) => value + 1)}
                >
                  重试读取书签
                </button>
              </p>
            ) : null}
            {/* The panel's wait is its own state, not the snapshot: the
                wait line shows only while NOTHING has landed and no
                failure speaks — a failure with no snapshot shows the
                flag alone (its retry is the way forward), and landed
                rows stay listed through a retry's refetch. */}
            {bookmarkRows === null ? (
              bookmarksSettle.failed ? null : (
                <p className="reader-status">读取书签中…</p>
              )
            ) : bookmarkRows.length === 0 ? (
              <p className="reader-status">
                还没有书签。点「在当前位置打书签」给当前阅读位置留个标记。
              </p>
            ) : (
              <ul className="bookmark-list">
                {epubBookmarkRows.map((row) => {
                  const title = book.chapters[row.chapter]?.title ?? "未知章节";
                  return (
                    <li key={row.id} className="bookmark-row">
                      <button
                        type="button"
                        className="bookmark-jump"
                        onClick={() => jumpToBookmark(row)}
                      >
                        <span className="bookmark-title">{title}</span>
                        <span className="bookmark-at">
                          {formatPlantedAt(row.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="bookmark-delete"
                        aria-label={`删除书签：${title}`}
                        // A pending (re)fetch locks the ops: a delete
                        // landing mid-refetch races the list read — the
                        // read started before it can resolve after it
                        // and resurrect the row with its stale snapshot.
                        disabled={panelRowsLoading}
                        onClick={() => removeBookmark(row.id)}
                      >
                        删除
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="overlay-actions">
              <button type="button" onClick={() => setShowBookmarks(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showToc ? (
        <div className="overlay-veil" role="dialog" aria-label="目录">
          <div className="overlay-card">
            {/* 返回 rides the card head: with a many-chapter list the
                bottom 关闭 sits below the fold, and the way out must not
                require scrolling (真机 md round 4). */}
            <button type="button" onClick={() => setShowToc(false)}>
              返回
            </button>
            <h2 className="overlay-title">目录</h2>
            <nav className="reader-toc" aria-label="章节列表">
              <ol>
                {book.chapters.map((entry, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={index === chapterIndex ? "true" : undefined}
                      onClick={() => {
                        setShowToc(false);
                        goChapter(index);
                      }}
                    >
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="overlay-actions">
              <button type="button" onClick={() => setShowToc(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <footer className="reader-pager">
        <button
          type="button"
          disabled={chapterIndex === 0}
          onClick={() => goChapter(chapterIndex - 1)}
        >
          上一章
        </button>
        <span className="reader-position">
          {chapterIndex + 1} / {book.chapters.length}
        </span>
        <button
          type="button"
          disabled={chapterIndex === book.chapters.length - 1}
          onClick={() => goChapter(chapterIndex + 1)}
        >
          下一章
        </button>
      </footer>
      {toolbarPosition === "bottom" ? toolsRow : null}
    </main>
  );
}
