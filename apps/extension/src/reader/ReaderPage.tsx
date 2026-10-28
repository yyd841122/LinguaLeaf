import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { segmentOriginal, type Segment } from "@lingualeaf/reading-model";
import type { ReactNode } from "react";
import {
  IMPORT_ERROR_COPY,
  importBookFromFile,
  readAsArrayBuffer,
  type ExtBlock,
  type ExtBook,
} from "./import-book";
import {
  classifyPdfError,
  destroyPdf,
  detectScanned,
  openPdf,
  renderPdfPage,
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
import "./reader.css";

// The reader page's whole story: empty (choose or drop a file) → importing
// → reading, with errors as a phase that keeps the entry usable. The
// offline dictionary and the vocabulary store resolve once per mount; the
// store is injectable so tests drive the memory backend. Reading progress
// itself arrives with ticket 05's storage work — a closed tab forgets the
// book, and re-entry starts at the file picker.
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

// The original line's word units — the web reader's WordSegments shape,
// driven by the same segmentOriginal walk, so word/slot pairing and the
// data-word click targets are identical across frontends. An empty slot
// renders the word as a plain lookup target: the gap is invisible, the
// line stays aligned. 生词本 tints ride per word (ADR-0005): Learning
// keeps the lookup affordance (查词底色), Known/Ignored drop it
// (word-settled — the affordance withdraws from words the reader has).
function WordSegments({
  segments,
  showSlots,
  stateOf,
}: {
  segments: Segment[];
  showSlots: boolean;
  stateOf: (word: string) => VocabState | null;
}) {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const segment of segments) {
    if (segment.kind === "text") {
      nodes.push(segment.text);
      continue;
    }
    const ipa = showSlots ? segment.ipa : undefined;
    const settled =
      stateOf(segment.word) === "known" || stateOf(segment.word) === "ignored";
    nodes.push(
      ipa ? (
        <span
          className={settled ? "ipa-word word-settled" : "ipa-word"}
          data-word={segment.word}
          key={index}
          role="button"
          tabIndex={0}
        >
          <span className="ipa-word-text">{segment.word}</span>
          {/* Transcription rides as data-ipa and paints via ::before:
              pseudo-element content never enters a text selection (the
              shared stylesheet carries the rule). */}
          <span className="ipa-word-ipa" data-ipa={ipa} />
        </span>
      ) : (
        <span
          className={settled ? "lookup-word word-settled" : "lookup-word"}
          data-word={segment.word}
          key={index}
          role="button"
          tabIndex={0}
        >
          {segment.word}
        </span>
      )
    );
    index += 1;
  }
  return <>{nodes}</>;
}

function BlockView({
  block,
  showIpa,
  stateOf,
}: {
  block: ExtBlock;
  showIpa: boolean;
  stateOf: (word: string) => VocabState | null;
}) {
  if (block.kind === "sentence") {
    // Two separate facts: whether slots pair with the words (same walk as
    // the import that built them — they always do here), and whether the
    // reader wants IPA at all. With IPA hidden the word units stay.
    const { segments } = segmentOriginal(block.text, block.ipaSlots);
    return (
      <div className="sentence-block">
        <p className="original-line">
          <WordSegments
            segments={segments}
            showSlots={showIpa}
            stateOf={stateOf}
          />
        </p>
      </div>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="code-block">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "image") {
    return (
      <figure className="image-block">
        <span className="image-placeholder" aria-hidden="true">
          🖼
        </span>
        {block.text ? <figcaption>{block.text}</figcaption> : null}
      </figure>
    );
  }
  return <p className="raw-block">{block.text}</p>;
}

export function ReaderPage({
  store: injectedStore,
  library: injectedLibrary,
}: {
  store?: VocabularyStore;
  library?: LibraryStore;
} = {}) {
  const [state, setState] = useState<ReaderState>({ phase: "empty" });
  const [showIpa, setShowIpa] = useState(true);
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

  const handleFile = async (file: File | undefined | null) => {
    if (!file || state.phase === "importing") return;
    setState({ phase: "importing" });
    try {
      const offline: OfflineDictionary = await dictionary;
      if (/\.pdf$/i.test(file.name)) {
        // The shared read shape (import-book's readAsArrayBuffer): the one
        // FileReader form both jsdom and Edge implement.
        const bytes = await readAsArrayBuffer(file);
        let session: PdfSession;
        try {
          session = await openPdf(bytes, file.name);
        } catch (error) {
          // pdf.js's native failures ride the shared rejection vocabulary;
          // anything unmapped keeps its own story (the 意外 copy).
          const reason = classifyPdfError(error);
          if (!reason) throw error;
          throw new UploadRejected(reason, String(error));
        }
        const lengths = await sampleTextLengths(session.doc);
        if (detectScanned(lengths)) {
          await destroyPdf(session);
          throw new UploadRejected(
            "scanned-pdf",
            "image-only PDF has no text layer"
          );
        }
        setState({
          phase: "pdf",
          title: session.title,
          session,
          page: 1,
          scale: 1,
          lookup: offline.ipaLookup(),
        });
        return;
      }
      const book = await importBookFromFile(file, offline.ipaLookup());
      // The document id is its title: re-importing a book updates it in
      // place instead of duplicating the shelf entry.
      const docId = `doc:${book.title}`;
      await library.saveDocument({ id: docId, title: book.title, book });
      setWordStates(new Map());
      restoreRef.current = null;
      setState({ phase: "reading", docId, book, chapterIndex: 0 });
    } catch (error) {
      setState({ phase: "error", copy: copyFor(error) });
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
  // The open is async; only the latest click's answer may land — a slow
  // A must not replace a B the reader already chose.
  const reopenSeq = useRef(0);
  const reopenDocument = async (entry: LibraryEntry) => {
    const seq = ++reopenSeq.current;
    const book = await library.openDocument(entry.id);
    if (!book || seq !== reopenSeq.current) return;
    setWordStates(new Map());
    restoreRef.current = entry.progress;
    setState({
      phase: "reading",
      docId: entry.id,
      book,
      chapterIndex: entry.progress.chapterIndex,
    });
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

  // Per-chapter 生词本 states for the tints. Bulk reads land by merge:
  // keys the local map already holds win, so a popup patch (or a bulk read
  // that began before it) can never revert what the reader just changed.
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
    let cancelled = false;
    resolvedStore
      .statesFor([...keys])
      .then((found) => {
        if (cancelled) return;
        setWordStates((current) => {
          const next = new Map(current);
          for (const [key, value] of found) {
            if (!next.has(key)) next.set(key, value);
          }
          return next;
        });
      })
      .catch(() => {
        // The tint read is best-effort: a failed read leaves the words
        // untinted rather than crashing the reading view.
      });
    return () => {
      cancelled = true;
    };
  }, [book, chapterIndex, resolvedStore]);

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
  const handleStatusApplied = (applied: {
    word: string;
    lemma: string | null;
    status: VocabState;
  }) => {
    if (!resolvedStore) return;
    const key = resolvedStore.stateKey(applied.word);
    setWordStates((current) => {
      const next = new Map(current);
      next.set(key, applied.status);
      return next;
    });
  };

  // One delegated click listener for the chapter: word units carry
  // data-word, everything else stays inert. Clicks carry 0/0 in synthetic
  // environments; real clicks carry the pointer position.
  const onSectionClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const word = target.closest("[data-word]")?.getAttribute("data-word");
    if (word) {
      setLookup({ word, point: { x: event.clientX, y: event.clientY } });
    }
  };
  // Keyboard reaches the same words: Enter/Space on a focused word runs
  // the same lookup, anchored to the word's own box.
  const onWordKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const word = target.closest("[data-word]")?.getAttribute("data-word");
    if (!word) return;
    event.preventDefault();
    const box = target.getBoundingClientRect();
    setLookup({
      word,
      point: { x: box.left + box.width / 2, y: box.bottom },
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
        <PdfReader
          key={state.title}
          title={state.title}
          session={state.session}
          page={state.page}
          scale={state.scale}
          lookup={state.lookup}
          showIpa={showIpa}
          onPage={(page) => setState({ ...state, page })}
          onScale={(scale) => setState({ ...state, scale })}
          onToggleIpa={() => setShowIpa((shown) => !shown)}
          onWordClick={(word, point) => setLookup({ word, point })}
          onReopen={() => {
            void destroyPdf(state.session);
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
      if (index >= 0 && index < currentBook.chapters.length) {
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
              onClick={() => setState({ phase: "empty" })}
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
          <section
            className="reader-chapter"
            aria-label={chapter.title}
            onClick={onSectionClick}
            onKeyDown={onWordKeyDown}
          >
            <h2>{chapter.title}</h2>
            {chapter.blocks.map((block, index) => (
              <div key={index} data-block-index={index}>
                <BlockView block={block} showIpa={showIpa} stateOf={stateOf} />
              </div>
            ))}
          </section>
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
                  onClick={() => void reopenDocument(entry)}
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
      <label className="reader-picker">
        <span>选择一个 EPUB 或 PDF 文件，或把它拖进本页。</span>
        <input
          type="file"
          accept=".epub,.pdf"
          aria-label="选择 EPUB 或 PDF 文件"
          onChange={onPick}
        />
      </label>
      <p className="reader-hint">
        标注在浏览器本地完成：无网络、无服务进程。加密、损坏的档案与扫描版
        PDF（无文本层）无法导入。
      </p>
    </main>
  );
}

// The PDF reading view (ticket 06): one page on canvas at a time — a big
// book is progressive by shape — with the proven word/IPA overlay. Word
// units carry data-word, so the popup seam is the EPUB one verbatim.
function PdfReader({
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
  title: string;
  session: PdfSession;
  page: number;
  scale: number;
  lookup: IpaLookup;
  showIpa: boolean;
  onPage: (page: number) => void;
  onScale: (scale: number) => void;
  onToggleIpa: () => void;
  onWordClick: (word: string, point: { x: number; y: number }) => void;
  onReopen: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    let cancelled = false;
    renderPdfPage(
      canvas,
      overlay,
      session.doc,
      page,
      scale,
      lookup,
      showIpa
    ).catch((error: unknown) => {
      if (!cancelled) console.warn("pdf page render failed", error);
    });
    return () => {
      cancelled = true;
    };
  }, [session, page, scale, lookup, showIpa]);

  // One delegated click for the overlay: word spans carry data-word,
  // everything else stays inert — the same seam the chapter view uses.
  const onOverlayClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const word = target.closest("[data-word]")?.getAttribute("data-word");
    if (word) {
      onWordClick(word, { x: event.clientX, y: event.clientY });
    }
  };

  return (
    <main className="reader" aria-label="扩展阅读页">
      <header className="reader-head">
        <h1 className="reader-title">{title}</h1>
        <div className="reader-tools">
          <button
            type="button"
            className="reader-toggle"
            aria-pressed={showIpa}
            onClick={onToggleIpa}
          >
            音标
          </button>
          {[0.75, 1, 1.5].map((zoom) => (
            <button
              key={zoom}
              type="button"
              className="reader-toggle"
              aria-pressed={scale === zoom}
              onClick={() => onScale(zoom)}
            >
              {zoom * 100}%
            </button>
          ))}
          <button type="button" className="reader-reopen" onClick={onReopen}>
            打开其他文件
          </button>
        </div>
      </header>
      <div
        className="pdf-stage"
        ref={overlayRef}
        onClick={onOverlayClick}
        role="presentation"
      >
        <canvas ref={canvasRef} />
      </div>
      <footer className="reader-pager">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          上一页
        </button>
        <span className="reader-position">
          {page} / {session.pageCount}
        </span>
        <button
          type="button"
          disabled={page >= session.pageCount}
          onClick={() => onPage(page + 1)}
        >
          下一页
        </button>
      </footer>
    </main>
  );
}
