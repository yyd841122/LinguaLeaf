import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { LibraryEntry, LibraryStore } from "../store/library-store";
import type { PdfBytesStore } from "../store/idb-bytes-store";
import type { PdfPositionStore } from "../store/pdf-position-store";
import type { PersistenceResult } from "../store/storage-persistence";
import { PdfShelf } from "./PdfShelf";
import type { PdfShelfEntry, usePdfShelf } from "./usePdfShelf";
import type { BackupManager } from "../backup/backup-manager";
import type { ImportSummary } from "../backup/backup-format";

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
  backup,
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
  // The backup face (ticket 05): null while the vocabulary seam resolves
  // — the section hides, the recents-list posture.
  backup: BackupManager | null;
  onFile: (file: File | undefined | null) => Promise<void>;
  onReopenDocument: (entry: LibraryEntry) => void;
  onReopenPdf: (entry: PdfShelfEntry) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [recents, setRecents] = useState<LibraryEntry[] | null>(null);
  // Bumped by a backup import's success: the recents read re-runs so a
  // restored position shows on the shelf — the 续读 click reads
  // entry.progress, and a stale row would reopen the old chapter
  // (mobile-progress-stale-reopen 缺陷 1; the ticket-05 import path
  // introduced the regression).
  const [recentsRevision, setRecentsRevision] = useState(0);
  // The backup block's local facts (ticket 05): one busy bit and the two
  // outcome lines. Errors stay until the next action; the import summary
  // reads per-asset counts, the cap's skips included.
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSaved, setBackupSaved] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null
  );
  const dropDepth = useRef(0);
  const pdfRecent = shelf?.recent;
  // The landing's recents: loaded whenever the picker shows — and after
  // a backup import that landed while the ERROR page was up (the error
  // page offers the import too, so a restore there must refresh the
  // rows the error page still renders; the A-3 review's probe showed
  // the empty-only guard leaving the stale chapter clickable).
  useEffect(() => {
    if (phase !== "empty" && recentsRevision === 0) return;
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
  }, [phase, library, recentsRevision]);

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void onFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const resetBackupLines = () => {
    setBackupError(null);
    setBackupSaved(null);
    setImportSummary(null);
  };

  const onSaveLocal = () => {
    if (!backup || backupBusy) return;
    setBackupBusy(true);
    resetBackupLines();
    void backup
      .saveBackupLocally()
      .then((saved) => {
        setBackupBusy(false);
        setBackupSaved(saved.path);
      })
      .catch((error: unknown) => {
        setBackupBusy(false);
        setBackupError(
          error instanceof Error && error.message
            ? error.message
            : "保存失败，请重试。"
        );
      });
  };

  const onExport = () => {
    if (!backup || backupBusy) return;
    setBackupBusy(true);
    resetBackupLines();
    void backup
      .exportBackup()
      .then(() => {
        setBackupBusy(false);
      })
      .catch((error: unknown) => {
        setBackupBusy(false);
        setBackupError(
          error instanceof Error && error.message
            ? error.message
            : "分享失败，请重试。"
        );
      });
  };

  const onImportPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!backup || backupBusy || !file) return;
    setBackupBusy(true);
    resetBackupLines();
    void backup
      .importBackup(file)
      .then((summary) => {
        setBackupBusy(false);
        setImportSummary(summary);
        // The import landed progress/bookmarks/etc. on the shelf's rows:
        // re-read the recents so the 续读 hints (and the reopen targets)
        // carry the restored positions.
        setRecentsRevision((value) => value + 1);
      })
      .catch((error: unknown) => {
        setBackupBusy(false);
        setBackupError(
          error instanceof Error && error.message
            ? error.message
            : "导入失败，请重试。"
        );
      });
  };

  const importLine = (summary: ImportSummary): string => {
    const parts = [
      `生词本 ${summary.vocabulary} 条`,
      `笔记 ${summary.notes} 条`,
      `进度 ${summary.progress} 本`,
      `书签 ${summary.bookmarks} 条`,
      `译文 ${summary.translations} 行`,
    ];
    const skipped =
      summary.notesSkippedOverCap > 0
        ? `；${summary.notesSkippedOverCap} 条笔记超出每书 100 条上限，未导入`
        : "";
    return `导入完成：${parts.join("、")}${skipped}。`;
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
        <span>选择一个 EPUB、PDF 或 Markdown 文件，或把它拖进本页。</span>
        <input
          type="file"
          accept=".epub,.pdf,.md,.markdown"
          aria-label="选择 EPUB、PDF 或 Markdown 文件"
          onChange={onPick}
        />
      </label>
      {backup ? (
        <section className="backup-block" aria-label="备份与恢复">
          <h2 className="backup-title">备份与恢复</h2>
          <p className="reader-hint">
            导出生词本、笔记、进度、书签与译文为一个备份文件；导入按资产合并进现有数据，不清空。
          </p>
          <div className="backup-actions">
            <button
              type="button"
              className="backup-export"
              disabled={backupBusy}
              onClick={onSaveLocal}
            >
              保存到本机
            </button>
            <button
              type="button"
              className="backup-share"
              disabled={backupBusy}
              onClick={onExport}
            >
              分享备份
            </button>
            <label
              className={`backup-import${backupBusy ? " backup-busy" : ""}`}
            >
              <span>{backupBusy ? "处理中…" : "导入备份"}</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="选择备份文件"
                onChange={onImportPick}
              />
            </label>
          </div>
          {backupSaved ? (
            <p className="reader-status" role="status">
              已保存到手机的「下载」目录：{backupSaved}
            </p>
          ) : null}
          {importSummary ? (
            <p className="reader-status" role="status">
              {importLine(importSummary)}
            </p>
          ) : null}
          {backupError ? (
            <p className="reader-error" role="alert">
              {backupError}
            </p>
          ) : null}
        </section>
      ) : null}
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
