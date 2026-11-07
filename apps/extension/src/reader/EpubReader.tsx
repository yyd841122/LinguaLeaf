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
import { EpubChapter } from "./EpubChapter";
import type { NoteEditorHandle } from "./NoteEditor";
import { WordLookupPopup } from "./WordLookupPopup";

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
  editorRef,
  restoreRef,
  scrollSaveAt,
  onChapter,
  onToggleIpa,
  onReopen,
}: {
  docId: string;
  book: ExtBook;
  chapterIndex: number;
  showIpa: boolean;
  resolvedStore: VocabularyStore | null;
  notes: NotesStore;
  library: LibraryStore;
  editorRef: RefObject<NoteEditorHandle | null>;
  restoreRef: RefObject<ChapterProgress | null>;
  scrollSaveAt: RefObject<number>;
  onChapter: (index: number) => void;
  onToggleIpa: () => void;
  onReopen: () => void;
}) {
  const closeNote = () => editorRef.current?.requestClose() !== false;
  // The reading walk's tint source: state key → 生词本 state, loaded per
  // chapter and patched by the popup's applyStatus.
  const [wordStates, setWordStates] = useState<Map<string, VocabState>>(
    new Map()
  );
  const [lookup, setLookup] = useState<WordClick | null>(null);

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
