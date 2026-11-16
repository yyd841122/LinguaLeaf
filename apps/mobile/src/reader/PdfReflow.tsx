import {
  createWordHandlers,
  useOwner,
  useSettle,
  type WordClick,
} from "@lingualeaf/reading-model/react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import type { IpaLookup } from "@lingualeaf/import-core";
import { eligiblePdfLines, markParagraphBreaks } from "./pdf-lines";
import type { PdfSession } from "./pdf";
import type { PdfNote, PdfNotesStore } from "../store/pdf-notes-store";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";

// The reflow reading face (ticket 03 人验 round 7): the page's visual
// lines rendered as EPUB-shaped text — the kernel's own word DOM
// (ipa-word bands over original-line blocks), comfortable phone type,
// vertical scroll, no panning. The canvas face keeps 坐标叠加 (the
// gate's coordinate-overlay form) one toggle away. Notes and line-level
// bookmarks share the same (page, lineIndex/lineText) anchors across
// both faces — a mark made here reads true over the canvas and back.

type ReflowLine = {
  lineIndex: number;
  lineText: string;
  // Word tokens with the text between them — rendered in order, spaces
  // riding the text parts.
  segments: (string | { word: string })[];
  // The line's text-space baseline — the paragraph-grouping fact
  // (round 15): the PDF's own leading tells where paragraphs break.
  baseline: number;
  // True when the next line starts a new paragraph (or none follows).
  paraEnd: boolean;
};

const lineSegments = (
  lineText: string,
  matches: RegExpMatchArray[]
): (string | { word: string })[] => {
  const parts: (string | { word: string })[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? cursor;
    if (start > cursor) parts.push(lineText.slice(cursor, start));
    parts.push({ word: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < lineText.length) parts.push(lineText.slice(cursor));
  return parts;
};

async function extractLines(
  doc: PdfSession["doc"],
  page: number
): Promise<ReflowLine[]> {
  const target = await doc.getPage(page);
  try {
    const content = await target.getTextContent();
    const lines = eligiblePdfLines(content.items).map((line) => {
      const left = Math.min(...line.items.map((item) => item.transform[4]));
      const right = Math.max(
        ...line.items.map((item) => item.transform[4] + item.width)
      );
      const fontPx = Math.max(
        ...line.items.map((item) =>
          Math.hypot(item.transform[2], item.transform[3])
        )
      );
      return {
        lineIndex: line.lineIndex,
        lineText: line.lineText,
        segments: lineSegments(line.lineText, line.matches),
        baseline: line.items[0]!.transform[5],
        left,
        right,
        fontPx,
        text: line.lineText,
        paraEnd: true,
      };
    });
    // Paragraph grouping (round 16): markParagraphBreaks reads the PDF's
    // own leading/indent/margin geometry — the 整段连贯 pass.
    markParagraphBreaks(lines);
    return lines;
  } finally {
    target.cleanup();
  }
}

// The shared face handle — structurally identical to PdfReader's
// ReaderFaceHandle (one type by shape, the canvas face keeps its own).
export type ReaderFaceHandle = {
  invalidate(): void;
  topmostVisibleLine(): { line: number; text: string } | null;
};

export function PdfReflow({
  docId,
  session,
  page,
  lookup,
  showIpa,
  notes,
  marks,
  jumpLine,
  onJumpSettled,
  onLongPressLine,
  editorRef,
  onOpenNote,
  onWordClick,
  ref,
}: {
  docId: string;
  session: PdfSession;
  page: number;
  lookup: IpaLookup;
  showIpa: boolean;
  notes: PdfNotesStore;
  // Both faces carry the shared handle (the button plant reads the
  // topmost visible line whichever face the reader is in).
  ref?: Ref<ReaderFaceHandle>;
  // This page's planted lines — the face-level marker fact, shared with
  // the canvas face through the same rows.
  marks: { line: number }[];
  jumpLine: { page: number; line: number } | null;
  onJumpSettled: () => void;
  onLongPressLine: (line: number, text: string) => void;
  editorRef: RefObject<NoteEditorHandle | null>;
  onOpenNote: () => void;
  onWordClick: (click: WordClick) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // The face renders PARAGRAPHS (round 18): consecutive lines of one
  // paragraph flow together as inline spans and the browser wraps them
  // at the container's width — the PDF's hard line ends must never
  // become display breaks (the choppy read the fit-width report's
  // rounds kept fighting). Line identity rides data attributes on the
  // spans, so notes, bookmarks and jumps stay line-addressed.
  const [paragraphs, setParagraphs] = useState<ReflowLine[][] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readOwner = useOwner(docId, session, page, attempt);
  const { run, failed } = useSettle(readOwner);
  useEffect(() => {
    setParagraphs(null);
    void run(extractLines(session.doc, page), {
      onFresh: (lines) => {
        const paragraphs: ReflowLine[][] = [];
        let current: ReflowLine[] = [];
        for (const line of lines) {
          current.push(line);
          if (line.paraEnd) {
            paragraphs.push(current);
            current = [];
          }
        }
        if (current.length) paragraphs.push(current);
        setParagraphs(paragraphs);
      },
    });
    return () => readOwner.invalidate();
    // attempt rides the deps: the 重试读取 button bumps it, and without
    // it here the owner's stable identity meant the click re-rendered
    // but never re-read (the retry stayed a dead button).
  }, [session, page, attempt, run, readOwner]);
  const [notesAttempt, setNotesAttempt] = useState(0);
  const notesOwner = useOwner(docId, session, page, notes, notesAttempt);
  const { run: runNotes, failed: notesFailed } = useSettle(notesOwner);
  const [saved, setSaved] = useState<PdfNote[] | null>(null);
  useEffect(() => {
    void runNotes(notes.list(docId), { onFresh: setSaved });
    return () => notesOwner.invalidate();
  }, [docId, notes, notesAttempt, runNotes, notesOwner]);
  useImperativeHandle(
    ref,
    () => ({
      invalidate() {
        /* Nothing in flight to revoke: the line read settles under its
           owner and the DOM is React's. */
      },
      topmostVisibleLine() {
        const el = container.current;
        if (!el || !paragraphs) return null;
        const top = el.getBoundingClientRect().top;
        for (const block of el.querySelectorAll<HTMLElement>(
          "[data-pdf-line-index]"
        )) {
          if (block.getBoundingClientRect().top >= top - 1)
            return {
              line: Number(block.dataset.pdfLineIndex),
              text: block.dataset.pdfLineText ?? "",
            };
        }
        return null;
      },
    }),
    [paragraphs]
  );
  // The armed jump (both faces' same shape): once this page's lines
  // exist, bring the row's line into view and disarm.
  useEffect(() => {
    if (!paragraphs || !jumpLine || jumpLine.page !== page) return;
    const raf = requestAnimationFrame(() => {
      container.current
        ?.querySelector(`[data-pdf-line-index="${jumpLine.line}"]`)
        ?.scrollIntoView?.({ block: "center" });
      onJumpSettled();
    });
    return () => cancelAnimationFrame(raf);
  }, [paragraphs, jumpLine, page, onJumpSettled]);
  // 长按打签: the canvas face's same gesture — 500ms beat on a word
  // plants on its line, a scroll cancels, the release's click is
  // swallowed. Line facts ride data attributes here (no geometry map).
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const clearPress = () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressOrigin.current = null;
  };
  useEffect(() => () => clearPress(), []);
  const lineAt = (
    target: EventTarget | null
  ): { line: number; text: string } | null => {
    const el = (target as HTMLElement | null)?.closest?.(
      "[data-pdf-line-index]"
    );
    if (!el) return null;
    const index = el.getAttribute("data-pdf-line-index");
    const text = el.getAttribute("data-pdf-line-text") ?? "";
    return index === null ? null : { line: Number(index), text };
  };
  const [popup, setPopup] = useState<{
    lineIndex: number;
    lineText: string;
    button: HTMLButtonElement;
    op: number;
  } | null>(null);
  const nextOp = useRef(0);
  const wordView = (word: string, key: string | number): ReactNode => {
    const ipa = showIpa ? lookup(word) : undefined;
    return ipa ? (
      <span
        className="ipa-word"
        data-word={word}
        key={key}
        role="button"
        tabIndex={0}
      >
        <span className="ipa-word-text">{word}</span>
        {/* ::before paints data-ipa without adding IPA to copied text. */}
        <span className="ipa-word-ipa" data-ipa={ipa} />
      </span>
    ) : (
      <span
        className="lookup-word"
        data-word={word}
        key={key}
        role="button"
        tabIndex={0}
      >
        {word}
      </span>
    );
  };
  return (
    <>
      {failed ? (
        <p role="alert" className="reader-error">
          页面文本读取失败，请切页或重试。
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            重试读取
          </button>
        </p>
      ) : null}
      {notesFailed ? (
        <p role="alert" className="reader-error">
          笔记读取失败，无法确认已有笔记。
          <button type="button" onClick={() => setNotesAttempt((v) => v + 1)}>
            重试读取笔记
          </button>
        </p>
      ) : null}
      {/* The canvas face's drift guard: notes whose lineText no longer
          matches any rendered line keep their rows but lose their pens —
          opening one would re-stamp the stale anchor as current text. */}
      {paragraphs !== null &&
      (saved ?? []).some(
        (note) =>
          note.page === page &&
          !paragraphs.some((paraLines) =>
            paraLines.some(
              (line) =>
                line.lineIndex === note.lineIndex &&
                line.lineText === note.lineText
            )
          )
      ) ? (
        <p role="alert" className="reader-error">
          已有笔记与本页行文本不符，已保留原笔记，未回挂不符条目。
        </p>
      ) : null}
      <div
        className="pdf-reflow"
        ref={container}
        {...createWordHandlers((click) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onWordClick(click);
        })}
        role="presentation"
        onPointerDown={(event) => {
          const at = lineAt(event.target);
          if (!at) return;
          pressOrigin.current = { x: event.clientX, y: event.clientY };
          pressTimer.current = setTimeout(() => {
            suppressClick.current = true;
            onLongPressLine(at.line, at.text);
          }, 500);
        }}
        onPointerMove={(event) => {
          const origin = pressOrigin.current;
          if (
            pressTimer.current !== null &&
            origin &&
            Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10
          )
            clearPress();
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onContextMenu={(event) => {
          if (lineAt(event.target)) event.preventDefault();
        }}
      >
        {paragraphs === null ? (
          <p className="reader-status">读取页面文本…</p>
        ) : paragraphs.length === 0 ? (
          <p className="reader-status">本页没有可读文本，请切「原版」查看。</p>
        ) : (
          paragraphs.map((paraLines) => {
            const first = paraLines[0]!;
            const marked = paraLines.some((line) =>
              marks.some((entry) => entry.line === line.lineIndex)
            );
            const paraNotes = (saved ?? []).filter((note) =>
              paraLines.some(
                (line) =>
                  note.page === page && note.lineIndex === line.lineIndex
              )
            );
            // A note's anchor matches only when its lineText is still the
            // rendered line's text — the drift guard below keys on it.
            const lineHasNote = (line: ReflowLine): boolean =>
              paraNotes.some(
                (note) =>
                  note.lineIndex === line.lineIndex &&
                  note.lineText === line.lineText
              );
            // A note's anchor matches only when its lineText is still the
            // rendered line's text — the drift guard keys on it. The
            // paragraph pen writes the paragraph's HEAD line (its fresh
            // write entry, labeled/locked by that line's own notes); every
            // OTHER noted line keeps its own inline pen (段中笔记可达 —
            // the pen used to open the head line blind, showing 编辑笔记
            // over a blank editor). A line whose notes drifted keeps its
            // rows but no pen opens it (the canvas face's drift guard).
            const headAnyNote = paraNotes.some(
              (note) => note.lineIndex === first.lineIndex
            );
            const headMismatch = paraNotes.some(
              (note) =>
                note.lineIndex === first.lineIndex &&
                note.lineText !== first.lineText
            );
            // A side line's pen locks the same way the head's does: ANY
            // drifted note on that line (a stale lineText under the same
            // lineIndex) keeps the pen closed — opening it would upsert
            // by (page, lineIndex, type) and re-stamp the drifted note
            // with the current line's text (the review's P1: a matching
            // sibling note used to enable the pen past the drifted one).
            const lineMismatch = (line: ReflowLine): boolean =>
              paraNotes.some(
                (note) =>
                  note.lineIndex === line.lineIndex &&
                  note.lineText !== line.lineText
              );
            const sideNotes = paraLines.filter(
              (line) => line.lineIndex !== first.lineIndex && lineHasNote(line)
            );
            return (
              <div
                key={first.lineIndex}
                className={`sentence-block${marked ? " block-marked" : ""}${
                  paraLines[paraLines.length - 1]!.paraEnd ? " para-end" : ""
                }`}
              >
                <p className="original-line">
                  {paraLines.map((line, lineAt) => (
                    <span
                      key={line.lineIndex}
                      data-pdf-line-index={line.lineIndex}
                      data-pdf-line-text={line.lineText}
                      className="pdf-reflow-line"
                    >
                      {line.segments.map((segment, index) =>
                        typeof segment === "string" ? (
                          <span key={index}>{segment}</span>
                        ) : (
                          wordView(segment.word, `${line.lineIndex}:${index}`)
                        )
                      )}
                      {lineAt < paraLines.length - 1 ? " " : null}
                    </span>
                  ))}
                  {/* The paragraph pen writes the head; these inline pens
                      keep every other noted line's own entry. */}
                  {sideNotes.map((line) => (
                    <button
                      key={line.lineIndex}
                      type="button"
                      className="block-note-button has-note"
                      aria-label="编辑笔记"
                      disabled={
                        saved === null || notesFailed || lineMismatch(line)
                      }
                      onClick={(event) => {
                        if (editorRef.current?.requestClose() === false) return;
                        onOpenNote();
                        setPopup({
                          lineIndex: line.lineIndex,
                          lineText: line.lineText,
                          button: event.currentTarget,
                          op: ++nextOp.current,
                        });
                      }}
                    >
                      ✎
                    </button>
                  ))}
                </p>
                <button
                  type="button"
                  className={`block-note-button${
                    lineHasNote(first) ? " has-note" : ""
                  }`}
                  aria-label={headAnyNote ? "编辑笔记" : "写笔记"}
                  disabled={saved === null || notesFailed || headMismatch}
                  onClick={(event) => {
                    if (editorRef.current?.requestClose() === false) return;
                    onOpenNote();
                    setPopup({
                      lineIndex: first.lineIndex,
                      lineText: first.lineText,
                      button: event.currentTarget,
                      op: ++nextOp.current,
                    });
                  }}
                >
                  ✎
                </button>
              </div>
            );
          })
        )}
      </div>
      {popup ? (
        <NoteEditor
          key={popup.op}
          ref={editorRef}
          ownerKey={`${docId}:${page}:${popup.lineIndex}`}
          ariaLabel="行笔记"
          initial={(saved ?? []).filter(
            (note) =>
              note.page === page &&
              note.lineIndex === popup.lineIndex &&
              // The drift guard's belt: only notes anchored to THIS
              // line's current text prefill the editor.
              note.lineText === popup.lineText
          )}
          button={popup.button}
          store={{
            save: (type, text) =>
              notes.save(
                {
                  type,
                  docId,
                  page,
                  lineIndex: popup.lineIndex,
                  lineText: popup.lineText,
                },
                text
              ),
            delete: (type) =>
              notes.delete({
                docId,
                page,
                lineIndex: popup.lineIndex,
                type,
              }),
          }}
          onCommitted={(type, note) => {
            setSaved((current) => {
              const rest = (current ?? []).filter(
                (entry) =>
                  !(
                    entry.page === page &&
                    entry.lineIndex === popup.lineIndex &&
                    entry.type === type
                  )
              );
              return note ? [...rest, note] : rest;
            });
          }}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </>
  );
}
