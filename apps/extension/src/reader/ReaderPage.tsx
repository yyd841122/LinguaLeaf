import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { segmentOriginal, type StatusApplied } from "@lingualeaf/reading-model";
import {
  IMPORT_ERROR_COPY,
  importBookFromFile,
  type ExtBook,
} from "./import-book";
import {
  classifyPdfError,
  destroyPdf,
  detectScanned,
  openPdf,
  sampleTextLengths,
  type PdfSession,
} from "./pdf";
import type { IpaLookup } from "@lingualeaf/import-core";
import { UploadRejected } from "@lingualeaf/import-core";
import {
  loadOfflineDictionary,
  type OfflineDictionary,
} from "../dict/offline-dictionary";
import {
  createVocabularyStore,
  chromeBackend,
  type VocabularyStore,
  type VocabState,
} from "../store/vocabulary-store";
import {
  createChromeLibraryStore,
  type ChapterProgress,
  type LibraryEntry,
  type LibraryStore,
} from "../store/library-store";
import { WordLookupPopup } from "./WordLookupPopup";
import { createChromeNotesStore, type NotesStore } from "../store/notes-store";
import { DocumentReplacementRequired } from "../store/book-fingerprint";
import { EpubChapter } from "./EpubChapter";
import type { NoteEditorHandle } from "./NoteEditor";
import { PdfReader } from "./PdfReader";
import { pdfFingerprint } from "../store/pdf-fingerprint";
import {
  createChromePdfNotesStore,
  type PdfNotesStore,
} from "../store/pdf-notes-store";
import {
  createPdfPositionStore,
  type PdfPositionStore,
} from "../store/pdf-position-store";
import {
  createPdfBytesStore,
  readPdfBlob,
  type PdfBytesStore,
} from "../store/idb-bytes-store";
import {
  requestStoragePersistence,
  type PersistenceResult,
} from "../store/storage-persistence";
import { usePdfShelf, type PdfShelfEntry } from "./usePdfShelf";
import { PdfShelf } from "./PdfShelf";
import "./reader.css";

// The reader page's whole story: empty (choose or drop a file) → importing
// → reading, with errors as a phase that keeps the entry usable. The
// offline dictionary and the vocabulary store resolve once per mount; the
// store is injectable so tests drive the memory backend. Reading progress
// and PDF bytes persist locally; re-entry starts at the shelf and picker.
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
  | {
      phase: "pdf";
      docId: string;
      title: string;
      session: PdfSession;
      page: number;
      scale: number;
      lookup: IpaLookup;
    };

// Relative to the extension origin (and true over file:// too).
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
  const notes = useMemo(
    () => injectedNotes ?? createChromeNotesStore(),
    [injectedNotes]
  );
  const pdfNotes = useMemo(
    () => injectedPdfNotes ?? createChromePdfNotesStore(),
    [injectedPdfNotes]
  );
  const pdfPositions = useMemo(
    () => injectedPdfPositions ?? createPdfPositionStore(),
    [injectedPdfPositions]
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
  const [pdfSaveError, setPdfSaveError] = useState<string | null>(null);
  const shelfVisible = state.phase === "empty" || state.phase === "error";
  const {
    snapshot: shelf,
    failed: shelfFailed,
    refresh: refreshPdfShelf,
  } = usePdfShelf(pdfBytes, pdfPositions, shelfVisible);
  const pdfRecent = shelf?.recent;
  const openOwner = useOwner();
  const { run: runOpen } = useSettle(openOwner);
  // Accepted sessions are held immediately, including the interval before
  // React commits state and installs the session effect. Teardown can land
  // in that interval; the ref lets it release the transferred candidate.
  const acceptedSession = useRef<PdfSession | null>(null);
  useEffect(
    () => () => {
      openOwner.invalidate();
      const session = acceptedSession.current;
      acceptedSession.current = null;
      if (session) void destroyPdf(session);
    },
    [openOwner]
  );
  const activeSession = state.phase === "pdf" ? state.session : null;
  useEffect(
    () => () => {
      if (activeSession && acceptedSession.current === activeSession) {
        acceptedSession.current = null;
        void destroyPdf(activeSession);
      }
    },
    [activeSession]
  );
  const noteEditor = useRef<NoteEditorHandle>(null);
  const closeNote = () => noteEditor.current?.requestClose() !== false;
  const dropDepth = useRef(0);
  // One dictionary + one store per mount; a file picked mid-load simply
  // awaits them. The store composes the loaded dictionary with the chrome
  // backend unless a store was injected (tests drive the memory one) —
  // the page itself never touches chrome.*.
  const dictionary = useMemo(() => loadOfflineDictionary(DICTIONARY_URL), []);
  const storePromise = useMemo(
    () =>
      dictionary.then(
        (offline) =>
          injectedStore ?? createVocabularyStore(offline, chromeBackend())
      ),
    [dictionary, injectedStore]
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

  // The reading walk's tint source: state key → 生词本 state, loaded per
  // chapter (below) and patched by the popup's applyStatus.
  const [wordStates, setWordStates] = useState<Map<string, VocabState>>(
    new Map()
  );
  // A word click the popup anchors to (GLOSSARY: 点词查详情).
  const [lookup, setLookup] = useState<{
    word: string;
    point: { x: number; y: number };
  } | null>(null);
  // The library seam: documents, positions, recents. Injectable like the
  // vocabulary store; the real one is chrome-backed.
  const library = useMemo(
    () => injectedLibrary ?? createChromeLibraryStore(),
    [injectedLibrary]
  );
  const [recents, setRecents] = useState<LibraryEntry[] | null>(null);
  // The position a reopened document should restore to, consumed by the
  // scroll effect after the chapter renders.
  const restoreRef = useRef<ChapterProgress | null>(null);

  const acceptPdf = async (
    blob: Blob,
    filename: string,
    offline: OfflineDictionary,
    openTicket: ReturnType<typeof openOwner.mark>,
    save: boolean,
    expectedDocId?: string
  ) => {
    const bytes = await readPdfBlob(blob);
    const docId = await pdfFingerprint(bytes);
    if (expectedDocId && docId !== expectedDocId)
      throw new Error("PDF 书架字节与所选书不符");
    if (openTicket.stale()) return;
    let session: PdfSession;
    try {
      session = await openPdf(bytes, filename);
    } catch (error) {
      const reason = classifyPdfError(error);
      if (!reason) throw error;
      throw new UploadRejected(reason, String(error));
    }
    let transferred = false;
    try {
      if (openTicket.stale()) return;
      const lengths = await sampleTextLengths(session.doc);
      if (detectScanned(lengths))
        throw new UploadRejected(
          "scanned-pdf",
          "image-only PDF has no text layer"
        );
      const position = await pdfPositions.getPosition(docId);
      await runOpen(Promise.resolve(session), {
        ticket: openTicket,
        onFresh: () => {
          transferred = true;
          acceptedSession.current = session;
          setPdfSaveError(null);
          setState({
            phase: "pdf",
            docId,
            title: session.title,
            session,
            page: Math.min(session.pageCount, Math.max(1, position?.page ?? 1)),
            scale: position?.scale ?? 1,
            lookup: offline.ipaLookup(),
          });
        },
      });
      // Acceptance is the only shelf admission point. Do not await storage
      // on the reading path; the File is retained by the queued save.
      if (transferred && save) {
        const saving = pdfBytes.save({ docId, title: session.title, blob });
        // A commit refreshes the current picker even if the originating
        // session has already been left. Only feedback follows its ticket.
        void saving.then(refreshPdfShelf, refreshPdfShelf);
        void runOpen(
          saving.then(
            () => null,
            () => "PDF 未能存入书架，请重选同一个文件重试。"
          ),
          {
            ticket: openTicket,
            onFresh: setPdfSaveError,
          }
        );
      }
    } finally {
      if (!transferred) await destroyPdf(session);
    }
  };

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
      setWordStates(new Map());
      restoreRef.current = null;
      setState({ phase: "reading", docId, book, chapterIndex: 0 });
    } catch (error) {
      await runOpen(Promise.resolve(copyFor(error)), {
        ticket: openTicket,
        onFresh: (copy) => setState({ phase: "error", copy }),
      });
    }
  };

  // The landing's recents: loaded whenever the picker shows.
  useEffect(() => {
    if (state.phase !== "empty") return;
    let cancelled = false;
    library
      .listDocuments()
      .then((entries) => {
        if (!cancelled) setRecents(entries);
      })
      .catch((error: unknown) => {
        console.warn("recents load failed", error);
        if (!cancelled) setRecents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, library]);

  // 重开扩展回到原处: a recents click opens the stored book at its saved
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
        setWordStates(new Map());
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

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

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
  const book = state.phase === "reading" ? state.book : null;
  const chapterIndex = state.phase === "reading" ? state.chapterIndex : -1;
  useEffect(() => {
    if (!book || chapterIndex < 0 || !resolvedStore) return;
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
  const scrollSaveAt = useRef(0);
  const readingKey =
    state.phase === "reading" ? `${state.docId}:${state.chapterIndex}` : "idle";
  useEffect(() => {
    if (state.phase !== "reading") return;
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
      void library.setProgress(state.docId, {
        chapterIndex: state.chapterIndex,
        blockIndex: current,
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [readingKey, library, state]);

  // 重开扩展回到原处: after a reopened document's chapter renders, jump to
  // its saved block. restoreRef is a deliberate one-shot channel, not
  // reactive state; "idle" keys the effect off the reading phase without
  // extra deps.
  useEffect(() => {
    const restore = restoreRef.current;
    if (readingKey === "idle" || !restore) return;
    restoreRef.current = null;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-block-index='${restore.blockIndex}']`
      );
      el?.scrollIntoView?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [readingKey]);

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

  // Dragover must be cancelled for drop to fire; dragenter/leave counting
  // keeps the highlight from flickering across child elements.
  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dropDepth.current += 1;
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dropDepth.current = Math.max(0, dropDepth.current - 1);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dropDepth.current = 0;
    void handleFile(event.dataTransfer.files?.[0]);
  };

  if (state.phase === "pdf") {
    return (
      <>
        {lookup && resolvedStore ? (
          <WordLookupPopup
            click={lookup}
            store={resolvedStore}
            onClose={() => setLookup(null)}
            onStatusApplied={handleStatusApplied}
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
    );
  }

  if (state.phase === "reading") {
    const { book: currentBook, docId, chapterIndex } = state;
    const chapter = currentBook.chapters[chapterIndex];
    // The tint walk reads the merged map through the store's one key rule.
    const stateOf = (word: string): VocabState | null =>
      resolvedStore?.stateKey(word) != null
        ? (wordStates.get(resolvedStore.stateKey(word)) ?? null)
        : null;
    const goChapter = (index: number) => {
      if (
        index !== chapterIndex &&
        index >= 0 &&
        index < currentBook.chapters.length &&
        closeNote()
      ) {
        setLookup(null);
        setState({ ...state, chapterIndex: index });
        // The chapter switch is itself a position fact — written straight
        // to the seam (scroll writes below cover the within-chapter drift).
        void library.setProgress(docId, { chapterIndex: index, blockIndex: 0 });
      }
    };
    return (
      <main className="reader" aria-label="扩展阅读页">
        <header className="reader-head">
          <h1 className="reader-title">{currentBook.title}</h1>
          <div className="reader-tools">
            {/* 显示开关 (GLOSSARY): hides the transcription line while the
                word units stay — clean reading and annotated reading
                switch instantly. */}
            <button
              type="button"
              className="reader-toggle"
              aria-pressed={showIpa}
              onClick={() => setShowIpa((shown) => !shown)}
            >
              音标
            </button>
            <button
              type="button"
              className="reader-reopen"
              onClick={() => {
                if (!closeNote()) return;
                setLookup(null);
                setState({ phase: "empty" });
              }}
            >
              打开其他文件
            </button>
          </div>
        </header>
        <nav className="reader-toc" aria-label="目录">
          <ol>
            {currentBook.chapters.map((entry, index) => (
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
            editorRef={noteEditor}
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
            {chapterIndex + 1} / {currentBook.chapters.length}
          </span>
          <button
            type="button"
            disabled={chapterIndex === currentBook.chapters.length - 1}
            onClick={() => goChapter(chapterIndex + 1)}
          >
            下一章
          </button>
        </footer>
      </main>
    );
  }

  return (
    <main
      className="reader reader-entry"
      aria-label="扩展阅读页"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <h1 className="reader-title">LinguaLeaf</h1>
      {state.phase === "importing" ? (
        <p className="reader-status" role="status">
          导入中…
        </p>
      ) : null}
      {state.phase === "error" ? (
        <p className="reader-error" role="alert">
          {state.copy}
        </p>
      ) : null}
      {recents && recents.length > 0 ? (
        <nav className="reader-recents" aria-label="最近文档">
          <ol>
            {recents.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="reader-recent"
                  onClick={() => reopenDocument(entry)}
                >
                  {entry.title}
                </button>
                <span className="reader-hint">
                  第 {entry.progress.chapterIndex + 1} 章
                </span>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {shelfFailed ? (
        <p className="reader-hint" role="alert">
          PDF 书架读取失败。
          <button
            type="button"
            onClick={() => {
              void refreshPdfShelf();
            }}
          >
            重试读取 PDF 书架
          </button>
        </p>
      ) : null}
      {shelf ? (
        <PdfShelf
          entries={shelf.entries}
          bytes={pdfBytes}
          positions={pdfPositions}
          onOpen={(entry) => {
            void reopenPdf(entry);
          }}
          refresh={refreshPdfShelf}
          failed={shelfFailed}
        />
      ) : !shelfFailed ? (
        <p className="reader-hint">PDF 书架读取中…</p>
      ) : null}
      {pdfRecent &&
      !shelf?.entries.some((entry) => entry.docId === pdfRecent.docId) ? (
        <p className="reader-hint" aria-label="最近 PDF 会话">
          《{pdfRecent.title}》第 {pdfRecent.page} 页——选同一个文件继续
        </p>
      ) : null}
      <label className="reader-picker">
        <span>选择一个 EPUB 或 PDF 文件，或把它拖进本页。</span>
        <input
          type="file"
          accept=".epub,.pdf"
          aria-label="选择 EPUB 或 PDF 文件"
          onChange={onPick}
        />
      </label>
      {persistence && persistence !== "granted" ? (
        <p className="reader-hint" data-persistence={persistence}>
          {persistence === "unavailable"
            ? "浏览器未提供持久存储申请，书架由浏览器管理空间。"
            : persistence === "denied"
              ? "浏览器未授予持久存储，书架由浏览器管理空间。"
              : "持久存储申请失败，书架仍可使用。"}
        </p>
      ) : null}
      <p className="reader-hint">
        标注在浏览器本地完成：无网络、无服务进程。加密、损坏的档案与扫描版
        PDF（无文本层）无法导入。
      </p>
    </main>
  );
}
