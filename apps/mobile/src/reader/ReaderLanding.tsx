import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { LibraryEntry, LibraryStore } from "../store/library-store";
import type { PdfBytesStore } from "../store/idb-bytes-store";
import type { PdfPositionStore } from "../store/pdf-position-store";
import type { PersistenceResult } from "../store/storage-persistence";
import { PdfShelf } from "./PdfShelf";
import type { PdfShelfEntry, usePdfShelf } from "./usePdfShelf";

// Keep this station mounted while reading (phase=null): recents and drag
// depth retain their page lifetime, and returning to the picker refreshes
// recents without clearing the last snapshot during that read.
export function ReaderLanding({
  phase,
  error,
  library,
  shelf,
  shelfFailed,
  pdfBytes,
  pdfPositions,
  refreshPdfShelf,
  persistence,
  onFile,
  onReopenDocument,
  onReopenPdf,
  onOpenSettings,
}: {
  phase: "empty" | "importing" | "error" | null;
  error: string | null;
  library: LibraryStore;
  shelf: ReturnType<typeof usePdfShelf>["snapshot"];
  shelfFailed: boolean;
  pdfBytes: PdfBytesStore;
  pdfPositions: PdfPositionStore;
  refreshPdfShelf: () => Promise<void>;
  persistence: PersistenceResult | null;
  onFile: (file: File | undefined | null) => Promise<void>;
  onReopenDocument: (entry: LibraryEntry) => void;
  onReopenPdf: (entry: PdfShelfEntry) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [recents, setRecents] = useState<LibraryEntry[] | null>(null);
  const dropDepth = useRef(0);
  const pdfRecent = shelf?.recent;
  // The landing's recents: loaded whenever the picker shows.
  useEffect(() => {
    if (phase !== "empty") return;
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
  }, [phase, library]);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void onFile(event.target.files?.[0]);
    event.target.value = "";
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
    void onFile(event.dataTransfer.files?.[0]);
  };

  if (phase === null) return null;

  return (
    <main
      className="reader reader-entry"
      aria-label="扩展阅读页"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="reader-head">
        <h1 className="reader-title">LinguaLeaf</h1>
        <button
          type="button"
          className="reader-settings"
          onClick={onOpenSettings}
        >
          设置
        </button>
      </div>
      {phase === "importing" ? (
        <p className="reader-status" role="status">
          导入中…
        </p>
      ) : null}
      {phase === "error" ? (
        <p className="reader-error" role="alert">
          {error}
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
                  onClick={() => onReopenDocument(entry)}
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
            void onReopenPdf(entry);
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
        标注在本地完成：无服务进程；仅按需翻译按需联网。加密、损坏的档案与扫描版
        PDF（无文本层）无法导入。
      </p>
    </main>
  );
}
