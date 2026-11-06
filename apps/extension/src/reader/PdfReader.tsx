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
  type Ref,
  type RefObject,
} from "react";
import type { IpaLookup } from "@lingualeaf/import-core";
import {
  renderPdfPage,
  invalidatePdfRender,
  clearPdfOverlay,
  type PdfSession,
} from "./pdf";
import type { PdfNote, PdfNotesStore } from "../store/pdf-notes-store";
import type { PdfPositionStore } from "../store/pdf-position-store";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";

// The PDF reading view (ticket 06): one page on canvas at a time — a big
// book is progressive by shape — with the proven word/IPA overlay. Word
// units carry data-word, so the popup seam is the EPUB one verbatim.
export function PdfReader({
  docId,
  notes,
  positions,
  editorRef,
  onOpenNote,
  title,
  session,
  page,
  scale,
  lookup,
  showIpa,
  onPage,
  onScale,
  onToggleIpa,
  onWordClick,
  onReopen,
}: {
  docId: string;
  notes: PdfNotesStore;
  positions: PdfPositionStore;
  editorRef: RefObject<NoteEditorHandle | null>;
  onOpenNote: () => void;
  title: string;
  session: PdfSession;
  page: number;
  scale: number;
  lookup: IpaLookup;
  showIpa: boolean;
  onPage: (page: number) => void;
  onScale: (scale: number) => void;
  onToggleIpa: () => void;
  onWordClick: (click: WordClick) => void;
  onReopen: () => void;
}) {
  const stage = useRef<PdfPageHandle>(null);
  const navigate = (apply: () => void) => {
    if (editorRef.current?.requestClose() === false) return;
    stage.current?.invalidate();
    apply();
  };
  useEffect(() => {
    void positions.setPosition({ docId, title, page, scale });
  }, [positions, docId, title, page, scale]);

  return (
    <main className="reader" aria-label="扩展阅读页">
      <header className="reader-head">
        <h1 className="reader-title">{title}</h1>
        <div className="reader-tools">
          <button
            type="button"
            className="reader-toggle"
            aria-pressed={showIpa}
            onClick={() => navigate(onToggleIpa)}
          >
            音标
          </button>
          {[0.75, 1, 1.5].map((zoom) => (
            <button
              key={zoom}
              type="button"
              className="reader-toggle"
              aria-pressed={scale === zoom}
              onClick={() => {
                if (zoom !== scale) navigate(() => onScale(zoom));
              }}
            >
              {zoom * 100}%
            </button>
          ))}
          <button
            type="button"
            className="reader-reopen"
            onClick={() => navigate(onReopen)}
          >
            打开其他文件
          </button>
        </div>
      </header>
      <PdfPage
        key={`${page}:${scale}:${showIpa}`}
        ref={stage}
        docId={docId}
        session={session}
        page={page}
        scale={scale}
        lookup={lookup}
        showIpa={showIpa}
        notes={notes}
        editorRef={editorRef}
        onOpenNote={onOpenNote}
        onWordClick={onWordClick}
      />
      <footer className="reader-pager">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => navigate(() => onPage(page - 1))}
        >
          上一页
        </button>
        <span className="reader-position">
          {page} / {session.pageCount}
        </span>
        <button
          type="button"
          disabled={page >= session.pageCount}
          onClick={() => navigate(() => onPage(page + 1))}
        >
          下一页
        </button>
      </footer>
    </main>
  );
}

type PdfPageHandle = { invalidate(): void };
function PdfPage({
  docId,
  session,
  page,
  scale,
  lookup,
  showIpa,
  notes,
  editorRef,
  onOpenNote,
  onWordClick,
  ref,
}: {
  docId: string;
  session: PdfSession;
  page: number;
  scale: number;
  lookup: IpaLookup;
  showIpa: boolean;
  notes: PdfNotesStore;
  editorRef: RefObject<NoteEditorHandle | null>;
  onOpenNote: () => void;
  onWordClick: (click: WordClick) => void;
  ref: Ref<PdfPageHandle>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<PdfNote[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [popup, setPopup] = useState<{
    lineIndex: number;
    lineText: string;
    button: HTMLButtonElement;
    op: number;
  } | null>(null);
  const nextOp = useRef(0);
  const renderOwner = useOwner(docId, session, page, scale, showIpa);
  const { run: render, failed: renderFailed } = useSettle(renderOwner);
  const readOwner = useOwner(docId, session, page, notes);
  const { run: read, failed } = useSettle(readOwner);
  const markerOwner = useOwner(docId, session, page);
  const { run: patch } = useSettle(markerOwner);
  const invalidate = () => {
    renderOwner.invalidate();
    readOwner.invalidate();
    markerOwner.invalidate();
    if (overlay.current) {
      invalidatePdfRender(overlay.current);
      clearPdfOverlay(overlay.current);
    }
  };
  useImperativeHandle(ref, () => ({ invalidate }));
  useEffect(() => {
    const target = overlay.current;
    if (!canvas.current || !target) return;
    void render(
      renderPdfPage(
        canvas.current,
        target,
        session.doc,
        page,
        scale,
        lookup,
        showIpa
      ),
      { onFresh: () => setReady(true) }
    );
    return () => {
      renderOwner.invalidate();
      invalidatePdfRender(target);
      clearPdfOverlay(target);
    };
  }, [session, page, scale, lookup, showIpa, render, renderOwner]);
  useEffect(() => {
    void read(notes.list(docId), { onFresh: setSaved });
    return () => readOwner.invalidate();
  }, [notes, docId, attempt, read, readOwner]);
  useEffect(() => () => markerOwner.invalidate(), [markerOwner]);

  // Rendering, reads and marker patches each settle under their own owner.
  // Canonical text is carried by the render's eligiblePdfLines result in DOM.
  const [drift, setDrift] = useState(false);
  useEffect(() => {
    if (!ready || !overlay.current) return;
    const buttons = [
      ...overlay.current.querySelectorAll<HTMLButtonElement>("[data-pdf-note]"),
    ];
    const pageNotes = (saved ?? []).filter((note) => note.page === page);
    setDrift(
      pageNotes.some(
        (note) =>
          !buttons.some(
            (button) =>
              Number(button.dataset.pdfNote) === note.lineIndex &&
              button.dataset.lineText === note.lineText
          )
      )
    );
    const ticket = markerOwner.mark();
    for (const button of buttons) {
      const lineIndex = Number(button.dataset.pdfNote);
      const lineText = button.dataset.lineText!;
      const note = pageNotes.find((entry) => entry.lineIndex === lineIndex);
      button.disabled =
        saved === null || failed || (!!note && note.lineText !== lineText);
      button.classList.toggle("has-note", !!note && note.lineText === lineText);
      button.setAttribute("aria-label", note ? "编辑笔记" : "写笔记");
      button.onclick = () => {
        if (
          ticket.stale() ||
          button.disabled ||
          editorRef.current?.requestClose() === false
        )
          return;
        onOpenNote();
        setPopup({ lineIndex, lineText, button, op: ++nextOp.current });
      };
    }
    return () => {
      for (const button of buttons) button.onclick = null;
    };
  }, [ready, saved, failed, page, markerOwner, editorRef, onOpenNote]);
  const markerTicket = markerOwner.mark();
  return (
    <>
      {renderFailed ? (
        <p role="alert" className="reader-error">
          PDF 页面渲染失败，请切页或重新打开文件。
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="reader-error">
          笔记读取失败，无法确认已有笔记。
          <button
            type="button"
            onClick={() => {
              readOwner.invalidate();
              setAttempt((value) => value + 1);
            }}
          >
            重试读取笔记
          </button>
        </p>
      ) : null}
      {drift ? (
        <p role="alert" className="reader-error">
          已有笔记与本页行文本不符，已保留原笔记，未回挂不符条目。
        </p>
      ) : null}
      <div
        className="pdf-stage"
        ref={overlay}
        {...createWordHandlers(onWordClick)}
        role="presentation"
      >
        <canvas ref={canvas} />
      </div>
      {popup ? (
        <NoteEditor
          key={popup.op}
          ref={editorRef}
          ownerKey={`${docId}:${page}:${popup.lineIndex}`}
          ariaLabel="行笔记"
          initial={saved?.find(
            (note) => note.page === page && note.lineIndex === popup.lineIndex
          )}
          button={popup.button}
          store={{
            save: (text) =>
              notes.save(
                {
                  docId,
                  page,
                  lineIndex: popup.lineIndex,
                  lineText: popup.lineText,
                },
                text
              ),
            delete: () =>
              notes.delete({ docId, page, lineIndex: popup.lineIndex }),
          }}
          onCommitted={(note) => {
            void patch(Promise.resolve(note), {
              ticket: markerTicket,
              onFresh: (value) =>
                setSaved((current) => {
                  const rest = (current ?? []).filter(
                    (entry) =>
                      entry.page !== page || entry.lineIndex !== popup.lineIndex
                  );
                  return value ? [...rest, value] : rest;
                }),
            });
          }}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </>
  );
}
