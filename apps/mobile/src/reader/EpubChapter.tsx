import type { NoteType } from "../../../server/src/wire";
import {
  AnnotatedBlockView,
  createWordHandlers,
  useOwner,
  useSettle,
  type AnnotatedBlock,
  type StatusReader,
  type WordClick,
} from "@lingualeaf/reading-model/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { NotesStore, ReaderNote } from "../store/notes-store";
import type { ExtChapter } from "./import-book";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";

// The settled 译文行 rides the sentence block only while the 开关 shows
// it AND a line exists: no entry → no row (an untranslated sentence reads
// as the original alone, 留空 semantics; exactOptionalPropertyTypes bars
// passing translationText: undefined outright).
function annotatedBlock(
  block: ExtChapter["blocks"][number],
  index: number,
  translations: Record<number, string>,
  showTranslation: boolean
): AnnotatedBlock {
  if (block.kind === "sentence" && showTranslation) {
    const line = translations[index];
    if (line !== undefined) return { ...block, translationText: line };
  }
  return block;
}

// Remounted by document/chapter (including replacement content). Async reads
// and marker patches belong to this chapter, never whichever one is next.
export function EpubChapter({
  docId,
  chapterIndex,
  chapter,
  notes,
  showIpa,
  translations,
  showTranslation,
  markedBlocks = new Set<number>(),
  readingAloudBlock = null,
  statusOf,
  onWordClick,
  onOpenNote,
  editorRef,
}: {
  docId: string;
  chapterIndex: number;
  chapter: ExtChapter;
  notes: NotesStore;
  showIpa: boolean;
  // Settled 译文行 for this chapter, keyed by block index (ticket 04);
  // the reader owns the store read, the chapter only renders it.
  translations: Record<number, string>;
  showTranslation: boolean;
  // The chapter's bookmarked block indexes (ticket 10): the reader derives
  // them from the doc-wide rows; the chapter only paints the marker.
  markedBlocks?: ReadonlySet<number>;
  // The sentence 听书 is on (ticket 07): null when the walk is off-chapter
  // or idle — the chapter only paints the highlight.
  readingAloudBlock?: number | null;
  statusOf: StatusReader;
  onWordClick: (click: WordClick) => void;
  onOpenNote: () => void;
  editorRef: RefObject<NoteEditorHandle | null>;
}) {
  const [savedNotes, setSavedNotes] = useState<ReaderNote[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [popup, setPopup] = useState<{
    blockIndex: number;
    button: HTMLButtonElement;
    op: number;
  } | null>(null);
  const nextOp = useRef(0);
  const owner = useOwner(docId, chapterIndex, chapter, notes);
  const { run, failed } = useSettle(owner);
  useEffect(() => {
    void run(notes.list(docId), { onFresh: setSavedNotes });
    return () => owner.invalidate();
  }, [notes, docId, attempt, owner, run]);
  const chapterTicket = owner.mark();
  const committed = (
    anchorIndex: number,
    type: NoteType,
    note: ReaderNote | null
  ) => {
    void run(Promise.resolve(note), {
      ticket: chapterTicket,
      onFresh: (value) =>
        setSavedNotes((current) => {
          const rest = (current ?? []).filter(
            (entry) =>
              entry.chapterIndex !== chapterIndex ||
              entry.blockIndex !== anchorIndex ||
              entry.type !== type
          );
          return value ? [...rest, value] : rest;
        }),
    });
  };
  const noteFor = (index: number) =>
    (savedNotes ?? []).filter(
      (note) => note.chapterIndex === chapterIndex && note.blockIndex === index
    );
  return (
    <>
      {failed ? (
        <p className="reader-error" role="alert">
          笔记读取失败，无法确认已有笔记。
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试读取笔记
          </button>
        </p>
      ) : null}
      <section
        className="reader-chapter"
        aria-label={chapter.title}
        {...createWordHandlers(onWordClick)}
      >
        {/* 章首版式 (redesign 02, 仿参照图): centered chapter number in
            small type, the title across the full column below it. */}
        <header className="chapter-opening">
          <span className="chapter-number">第 {chapterIndex + 1} 章</span>
          <h2 className="chapter-title">{chapter.title}</h2>
        </header>
        {chapter.blocks.map((block, index) => (
          <div
            key={index}
            data-block-index={index}
            className={
              `${markedBlocks.has(index) ? "block-marked" : ""}${
                readingAloudBlock === index ? " reading-aloud" : ""
              }`.trim() || undefined
            }
          >
            <AnnotatedBlockView
              block={annotatedBlock(
                block,
                index,
                translations,
                showTranslation
              )}
              showIpa={showIpa}
              showTranslation={showTranslation}
              statusOf={statusOf}
              note={
                block.kind === "sentence"
                  ? {
                      exists: noteFor(index).length > 0,
                      disabled: savedNotes === null || failed,
                      onClick: (button) => {
                        if (editorRef.current?.requestClose() === false) return;
                        onOpenNote();
                        setPopup({
                          blockIndex: index,
                          button,
                          op: ++nextOp.current,
                        });
                      },
                    }
                  : undefined
              }
            />
          </div>
        ))}
      </section>
      {popup ? (
        <NoteEditor
          key={popup.op}
          ref={editorRef}
          ownerKey={`${docId}:${chapterIndex}:${popup.blockIndex}`}
          ariaLabel="句子块笔记"
          initial={noteFor(popup.blockIndex)}
          button={popup.button}
          store={{
            save: (type, text) =>
              notes.save(
                { docId, chapterIndex, blockIndex: popup.blockIndex, type },
                text
              ),
            delete: (type) =>
              notes.delete({
                type,
                docId,
                chapterIndex,
                blockIndex: popup.blockIndex,
              }),
          }}
          onCommitted={(type, note) => committed(popup.blockIndex, type, note)}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </>
  );
}
