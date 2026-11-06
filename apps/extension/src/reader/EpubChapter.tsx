import {
  AnnotatedBlockView,
  createWordHandlers,
  useOwner,
  useSettle,
  type StatusReader,
  type WordClick,
} from "@lingualeaf/reading-model/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { NotesStore, ReaderNote } from "../store/notes-store";
import type { ExtChapter } from "./import-book";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";

// Remounted by document/chapter (including replacement content). Async reads
// and marker patches belong to this chapter, never whichever one is next.
export function EpubChapter({
  docId,
  chapterIndex,
  chapter,
  notes,
  showIpa,
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
  const committed = (anchorIndex: number, note: ReaderNote | null) => {
    void run(Promise.resolve(note), {
      ticket: chapterTicket,
      onFresh: (value) =>
        setSavedNotes((current) => {
          const rest = (current ?? []).filter(
            (entry) =>
              entry.chapterIndex !== chapterIndex ||
              entry.blockIndex !== anchorIndex
          );
          return value ? [...rest, value] : rest;
        }),
    });
  };
  const noteFor = (index: number) =>
    savedNotes?.find(
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
        <h2>{chapter.title}</h2>
        {chapter.blocks.map((block, index) => (
          <div key={index} data-block-index={index}>
            <AnnotatedBlockView
              block={block}
              showIpa={showIpa}
              showTranslation={false}
              statusOf={statusOf}
              note={
                block.kind === "sentence"
                  ? {
                      exists: !!noteFor(index),
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
            save: (text) =>
              notes.save(
                { docId, chapterIndex, blockIndex: popup.blockIndex },
                text
              ),
            delete: () =>
              notes.delete({
                docId,
                chapterIndex,
                blockIndex: popup.blockIndex,
              }),
          }}
          onCommitted={(note) => committed(popup.blockIndex, note)}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </>
  );
}
