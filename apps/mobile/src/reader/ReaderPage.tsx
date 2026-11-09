import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IMPORT_ERROR_COPY,
  importBookFromFile,
  type ExtBook,
} from "./import-book";
import { UploadRejected } from "@lingualeaf/import-core";
import {
  loadOfflineDictionary,
  type OfflineDictionary,
} from "../dict/offline-dictionary";
import {
  createVocabularyStore,
  createStorageBackend,
  type VocabularyStore,
} from "../store/vocabulary-store";
import {
  createLibraryStore,
  type ChapterProgress,
  type LibraryEntry,
  type LibraryStore,
} from "../store/library-store";
import { WordLookupPopup } from "./WordLookupPopup";
import { createNotesStore, type NotesStore } from "../store/notes-store";
import { DocumentReplacementRequired } from "../store/book-fingerprint";
import { EpubReader } from "./EpubReader";
import type { NoteEditorHandle } from "./NoteEditor";
import { PdfReader } from "./PdfReader";
import {
  createPdfNotesStore,
  type PdfNotesStore,
} from "../store/pdf-notes-store";
import {
  createPdfPositionStore,
  type PdfPositionStore,
} from "../store/pdf-position-store";
import {
  createPdfBytesStore,
  type PdfBytesStore,
} from "../store/idb-bytes-store";
import {
  requestStoragePersistence,
  type PersistenceResult,
} from "../store/storage-persistence";
import { usePdfShelf, type PdfShelfEntry } from "./usePdfShelf";
import { ReaderLanding } from "./ReaderLanding";
import { usePdfOpen, type OpenedPdf } from "./usePdfOpen";
import { createIdbNamespaceStorage } from "../store/idb-namespace-storage";
import "./reader.css";

// The reader page's whole story: empty (choose or drop a file) → importing
// → reading, with errors as a phase that keeps the entry usable. The
// offline dictionary and the vocabulary store resolve once per mount; the
// store is injectable so tests drive the memory backend. Reading progress
// and PDF bytes persist locally; re-entry starts at the shelf and picker.
// On the phone every seam defaults to the IndexedDB backend (mobile-app
// ticket 02) — the page itself never touches a host storage API.
type ReaderState =
  | { phase: "empty" }
  | { phase: "importing" }
  | { phase: "error"; copy: string }
  | {
      phase: "reading";
      docId: string;
      book: ExtBook;
      chapterIndex: number;
    }
  // The PDF session: pages render on demand (原位叠加 per ticket 01), so
  // a thousand-page book costs one page at a time — 渐进加载 by shape.
  | ({ phase: "pdf" } & OpenedPdf);

// Relative to the app origin — the baked asset rides the dist root the
// WebView serves from (the extension copy keeps its chrome-extension
// origin wording).
const DICTIONARY_URL = "./dictionary.json";

function copyFor(error: unknown): string {
  if (error instanceof UploadRejected) {
    const copy = IMPORT_ERROR_COPY[error.reason];
    if (copy) return copy;
  }
  // An unexpected failure must not masquerade as a broken file
  // (CODING_STANDARDS: missing and failed read differently to a reader).
  return "导入失败：出了点意外，请重试。";
}

export function ReaderPage({
  store: injectedStore,
  library: injectedLibrary,
  notes: injectedNotes,
  pdfNotes: injectedPdfNotes,
  pdfPositions: injectedPdfPositions,
  pdfBytes: injectedPdfBytes,
}: {
  store?: VocabularyStore;
  library?: LibraryStore;
  notes?: NotesStore;
  pdfNotes?: PdfNotesStore;
  pdfPositions?: PdfPositionStore;
  pdfBytes?: PdfBytesStore;
} = {}) {
  const [state, setState] = useState<ReaderState>({ phase: "empty" });
  const [showIpa, setShowIpa] = useState(true);
  // One namespace storage per mount backs all four record seams
  // (library / vocabulary / notes / pdf-notes) — one IndexedDB database,
  // one connection discipline; tests inject memory stores instead, so
  // jsdom never opens it.
  const idbStorage = useMemo(() => createIdbNamespaceStorage(), []);
  const notes = useMemo(
    () => injectedNotes ?? createNotesStore(idbStorage),
    [injectedNotes, idbStorage]
  );
  const pdfNotes = useMemo(
    () => injectedPdfNotes ?? createPdfNotesStore(idbStorage),
    [injectedPdfNotes, idbStorage]
  );
  const pdfPositions = useMemo(
    () => injectedPdfPositions ?? createPdfPositionStore(idbStorage),
    [injectedPdfPositions, idbStorage]
  );
  const pdfBytes = useMemo(
    () => injectedPdfBytes ?? createPdfBytesStore(),
    [injectedPdfBytes]
  );
  const persistencePromise = useRef<Promise<PersistenceResult> | null>(null);
  const [persistence, setPersistence] = useState<PersistenceResult | null>(
    null
  );
  const persistenceOwner = useOwner();
  const { run: runPersistence } = useSettle(persistenceOwner);
  useEffect(() => {
    persistencePromise.current ??= requestStoragePersistence();
    void runPersistence(persistencePromise.current, {
      onFresh: setPersistence,
    });
    return () => persistenceOwner.invalidate();
  }, [persistenceOwner, runPersistence]);
  const shelfVisible = state.phase === "empty" || state.phase === "error";
  const {
    snapshot: shelf,
    failed: shelfFailed,
    refresh: refreshPdfShelf,
  } = usePdfShelf(pdfBytes, pdfPositions, shelfVisible);
  const { acceptPdf, openOwner, runOpen, pdfSaveError } = usePdfOpen({
    activeSession: state.phase === "pdf" ? state.session : null,
    pdfPositions,
    pdfBytes,
    refreshPdfShelf,
    onAccepted: (opened) => setState({ phase: "pdf", ...opened }),
  });
  const noteEditor = useRef<NoteEditorHandle>(null);
  const closeNote = () => noteEditor.current?.requestClose() !== false;
  // One dictionary + one store per mount; a file picked mid-load simply
  // awaits them. The store composes the loaded dictionary with the
  // IndexedDB backend unless a store was injected (tests drive the memory
  // one) — the page itself never touches a host storage API.
  const dictionary = useMemo(() => loadOfflineDictionary(DICTIONARY_URL), []);
  const storePromise = useMemo(
    () =>
      dictionary.then(
        (offline) =>
          injectedStore ??
          createVocabularyStore(offline, createStorageBackend(idbStorage))
      ),
    [dictionary, injectedStore, idbStorage]
  );
  const [resolvedStore, setResolvedStore] = useState<VocabularyStore | null>(
    null
  );
  useEffect(() => {
    let cancelled = false;
    storePromise.then((store) => {
      if (!cancelled) setResolvedStore(store);
    });
    return () => {
      cancelled = true;
    };
  }, [storePromise]);

  // A word click the popup anchors to (GLOSSARY: 点词查详情).
  const [lookup, setLookup] = useState<{
    word: string;
    point: { x: number; y: number };
  } | null>(null);
  // The library seam: documents, positions, recents. Injectable like the
  // vocabulary store; the real one rides the IndexedDB namespace storage.
  const library = useMemo(
    () => injectedLibrary ?? createLibraryStore(idbStorage),
    [injectedLibrary, idbStorage]
  );
  // The position a reopened document should restore to, consumed by the
  // scroll effect after the chapter renders.
  const restoreRef = useRef<ChapterProgress | null>(null);
  // Preserve the page-lifetime throttle clock across EPUB face remounts.
  const scrollSaveAt = useRef(0);

  const handleFile = async (file: File | undefined | null) => {
    if (!file || state.phase === "importing") return;
    if (!closeNote()) return;
    reopenOwner.invalidate();
    openOwner.invalidate();
    const openTicket = openOwner.mark();
    setLookup(null);
    setState({ phase: "importing" });
    try {
      const offline: OfflineDictionary = await dictionary;
      if (/\.pdf$/i.test(file.name)) {
        // Hold the picker File itself BEFORE PDF.js gets a derived buffer.
        // openPdf may transfer/detach that buffer; the File remains intact.
        await acceptPdf(file, file.name, offline, openTicket, true);
        return;
      }
      const book = await importBookFromFile(file, offline.ipaLookup());
      // The document id is its title: re-importing a book updates it in
      // place instead of duplicating the shelf entry.
      const docId = `doc:${book.title}`;
      try {
        await library.saveDocument({ id: docId, title: book.title, book });
      } catch (error) {
        if (!(error instanceof DocumentReplacementRequired)) throw error;
        let count: number;
        try {
          count = (await notes.list(docId)).length;
        } catch {
          setState({
            phase: "error",
            copy: "笔记读取失败，未替换原书，请重试。",
          });
          return;
        }
        if (
          !window.confirm(
            `新书内容与原书不同，替换将使 ${count} 条已有笔记错位，阅读进度也可能错位。继续替换？`
          )
        ) {
          setState({ phase: "empty" });
          return;
        }
        await library.saveDocument({
          id: docId,
          title: book.title,
          book,
          replaceFingerprint: error.previousFingerprint,
        });
      }
      restoreRef.current = null;
      setState({ phase: "reading", docId, book, chapterIndex: 0 });
    } catch (error) {
      await runOpen(Promise.resolve(copyFor(error)), {
        ticket: openTicket,
        onFresh: (copy) => setState({ phase: "error", copy }),
      });
    }
  };

  // 重开应用回到原处: a recents click opens the stored book at its saved
  // position (GLOSSARY: 扩展阅读页 remembers, the storage seam persists).
  // The open is async; the settling channel (GLOSSARY 落回裁决) drops every
  // answer but the latest click's: each click invalidates the previous
  // click's ticket before its own leaves, so a slow A cannot replace a B
  // the reader already chose — and an A→A re-click cannot revive the first
  // answer either (invalidate kills for good; the seq counter this
  // replaces compared, which is the revival trap CODING_STANDARDS names).
  // A failed open rides the outcome unspoken: no error surface, the
  // picker stays for another try.
  const reopenOwner = useOwner();
  const reopenSettle = useSettle(reopenOwner);
  const reopenDocument = (entry: LibraryEntry) => {
    if (state.phase === "importing" || !closeNote()) return;
    reopenOwner.invalidate();
    openOwner.invalidate();
    void reopenSettle.run(library.openDocument(entry.id), {
      onFresh: (book) => {
        if (!book) return;
        restoreRef.current = entry.progress;
        setState({
          phase: "reading",
          docId: entry.id,
          book,
          chapterIndex: entry.progress.chapterIndex,
        });
      },
    });
  };

  const reopenPdf = async (entry: PdfShelfEntry) => {
    if (state.phase === "importing" || !closeNote()) return;
    reopenOwner.invalidate();
    openOwner.invalidate();
    const ticket = openOwner.mark();
    setLookup(null);
    setState({ phase: "importing" });
    try {
      const record = await pdfBytes.get(entry.docId);
      await acceptPdf(
        record.blob,
        record.title,
        await dictionary,
        ticket,
        false,
        entry.docId
      );
    } catch {
      await runOpen(
        Promise.resolve("PDF 书架读取失败，请重试打开或选择同一个文件。"),
        {
          ticket,
          onFresh: (copy) => setState({ phase: "error", copy }),
        }
      );
    }
  };

  return (
    <>
      <ReaderLanding
        phase={
          state.phase === "reading" || state.phase === "pdf"
            ? null
            : state.phase
        }
        error={state.phase === "error" ? state.copy : null}
        library={library}
        shelf={shelf}
        shelfFailed={shelfFailed}
        pdfBytes={pdfBytes}
        pdfPositions={pdfPositions}
        refreshPdfShelf={refreshPdfShelf}
        persistence={persistence}
        onFile={handleFile}
        onReopenDocument={reopenDocument}
        onReopenPdf={reopenPdf}
      />
      {state.phase === "pdf" ? (
        <>
          {lookup && resolvedStore ? (
            <WordLookupPopup
              click={lookup}
              store={resolvedStore}
              onClose={() => setLookup(null)}
              // PDF has no vocabulary tints; the popup commits to the store.
              onStatusApplied={() => undefined}
            />
          ) : null}
          {pdfSaveError ? (
            <p className="reader-hint" role="alert">
              {pdfSaveError}
            </p>
          ) : null}
          <PdfReader
            key={state.docId}
            docId={state.docId}
            notes={pdfNotes}
            positions={pdfPositions}
            editorRef={noteEditor}
            onOpenNote={() => setLookup(null)}
            title={state.title}
            session={state.session}
            page={state.page}
            scale={state.scale}
            lookup={state.lookup}
            showIpa={showIpa}
            onPage={(page) => setState({ ...state, page })}
            onScale={(scale) => setState({ ...state, scale })}
            onToggleIpa={() => setShowIpa((shown) => !shown)}
            onWordClick={setLookup}
            onReopen={() => {
              if (!closeNote()) return;
              openOwner.invalidate();
              setLookup(null);
              setState({ phase: "empty" });
            }}
          />
        </>
      ) : null}
      {state.phase === "reading" ? (
        <EpubReader
          docId={state.docId}
          book={state.book}
          chapterIndex={state.chapterIndex}
          showIpa={showIpa}
          resolvedStore={resolvedStore}
          notes={notes}
          library={library}
          editorRef={noteEditor}
          restoreRef={restoreRef}
          scrollSaveAt={scrollSaveAt}
          onChapter={(chapterIndex) => setState({ ...state, chapterIndex })}
          onToggleIpa={() => setShowIpa((shown) => !shown)}
          onReopen={() => setState({ phase: "empty" })}
        />
      ) : null}
    </>
  );
}
