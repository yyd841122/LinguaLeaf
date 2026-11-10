import { useEffect, useState, type RefObject } from "react";
import {
  useOwner,
  useSettle,
  type WordClick,
} from "@lingualeaf/reading-model/react";
import { segmentOriginal, type StatusApplied } from "@lingualeaf/reading-model";
import type { ExtBook } from "./import-book";
import type { VocabularyStore, VocabState } from "../store/vocabulary-store";
import type { ChapterProgress, LibraryStore } from "../store/library-store";
import type { NotesStore } from "../store/notes-store";
import type { TranslationStore } from "../store/translation-store";
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

// The settled-failure copy (ticket 04): a chapter whose every sentence
// came back null. The Translator contract reports wrong key and network
// down the same way (all null), so the copy names both and points at the
// settings page.
const TRANSLATION_FAILURE_COPY =
  "翻译失败：无法连接翻译服务，或密钥无效。请检查网络与设置页中的配置，然后重试。";

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
  registry = defaultRegistry,
  settingsRevision = 0,
  editorRef,
  restoreRef,
  scrollSaveAt,
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
  // The chapter task registry (module-level by default; injected for
  // tests): the task outlives chapter switches and this face's remounts.
  registry?: ChapterTaskRegistry;
  // Bumped by the host whenever the settings overlay closes — the trigger
  // re-reads its configured fact without remounting this face.
  settingsRevision?: number;
  editorRef: RefObject<NoteEditorHandle | null>;
  restoreRef: RefObject<ChapterProgress | null>;
  scrollSaveAt: RefObject<number>;
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
      let current = 0;
      for (const block of document.querySelectorAll<HTMLElement>(
        "[data-block-index]"
      )) {
        if (block.getBoundingClientRect().top <= 96) {
          current = Number(block.dataset.blockIndex ?? 0);
        }
      }
      void library.setProgress(docId, {
        chapterIndex,
        blockIndex: current,
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
      el?.scrollIntoView?.();
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
    }
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
  return (
    <main className="reader" aria-label="扩展阅读页">
      <header className="reader-head">
        <h1 className="reader-title">{book.title}</h1>
        <div className="reader-tools">
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
          <button
            type="button"
            className="reader-reopen"
            onClick={() => {
              if (!closeNote()) return;
              setLookup(null);
              onReopen();
            }}
          >
            打开其他文件
          </button>
        </div>
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
      <nav className="reader-toc" aria-label="目录">
        <ol>
          {book.chapters.map((entry, index) => (
            <li key={index}>
              <button
                type="button"
                aria-current={index === chapterIndex ? "true" : undefined}
                onClick={() => goChapter(index)}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
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
    </main>
  );
}
