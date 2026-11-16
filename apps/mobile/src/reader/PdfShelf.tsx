import { useEffect, useState } from "react";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import type { PdfBytesStore } from "../store/idb-bytes-store";
import type { PdfPositionStore } from "../store/pdf-position-store";
import type { PdfShelfEntry } from "./usePdfShelf";

// Each row owns its mutation feedback. Concurrent deletions cannot clear
// another row's in-flight marker or report another document's failure.
function PdfShelfRow({
  entry,
  bytes,
  onOpen,
  onDeleted,
  onRename,
}: {
  entry: PdfShelfEntry;
  bytes: PdfBytesStore;
  onOpen: (entry: PdfShelfEntry) => void;
  onDeleted: (docId: string) => Promise<void>;
  onRename: (entry: PdfShelfEntry) => void;
}) {
  const owner = useOwner(entry.docId);
  const { run, failed } = useSettle(owner);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => () => owner.invalidate(), [owner]);
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    const outcome = await run(bytes.delete(entry.docId), {
      // Commit changes the shelf even if this row's UI has since gone away.
      onLanded: () => {
        void onDeleted(entry.docId);
      },
    });
    if (outcome.fresh) setDeleting(false);
  };
  return (
    <li data-pdf-doc-id={entry.docId}>
      <button
        type="button"
        className="reader-recent"
        disabled={deleting}
        onClick={() => onOpen(entry)}
      >
        {entry.title}
      </button>
      <span className="reader-hint">第 {entry.page} 页</span>
      {/* 手动改名 (mobile-ipa-buttons 04): a PDF's metadata title (a
          watermark site, say) is what import stored — the reader fixes
          the shelf label by hand. */}
      <button
        type="button"
        aria-label={`修改《${entry.title}》的书名`}
        disabled={deleting}
        onClick={() => onRename(entry)}
      >
        改名
      </button>
      <button
        type="button"
        aria-label={`从书架删除《${entry.title}》`}
        disabled={deleting}
        onClick={() => {
          void remove();
        }}
      >
        ×
      </button>
      {failed ? (
        <p className="reader-hint" role="alert">
          PDF 删除失败，原书仍在书架，请重试。
        </p>
      ) : null}
    </li>
  );
}

function RecentCleanup({
  docId,
  positions,
  onCleaned,
}: {
  docId: string;
  positions: PdfPositionStore;
  onCleaned: () => void;
}) {
  const owner = useOwner(docId);
  const { run } = useSettle(owner);
  useEffect(() => () => owner.invalidate(), [owner]);
  return (
    <p className="reader-hint" role="alert">
      PDF 已从书架删除，最近会话清理失败。
      <button
        type="button"
        onClick={() => {
          void run(positions.clearRecentIf(docId), { onFresh: onCleaned });
        }}
      >
        重试清理最近 PDF 会话
      </button>
    </p>
  );
}

export function PdfShelf({
  entries,
  bytes,
  positions,
  onOpen,
  refresh,
  failed,
}: {
  entries: PdfShelfEntry[];
  bytes: PdfBytesStore;
  positions: PdfPositionStore;
  onOpen: (entry: PdfShelfEntry) => void;
  refresh: () => Promise<void>;
  failed: boolean;
}) {
  const [cleanupFailures, setCleanupFailures] = useState<Set<string>>(
    new Set()
  );
  // The rename face (mobile-ipa-buttons 04): one overlay for the whole
  // shelf, armed by a row's 改名 click. The draft is plain state — the
  // store write is the only thing that rides a settle channel.
  const [renaming, setRenaming] = useState<PdfShelfEntry | null>(null);
  const [draft, setDraft] = useState("");
  const [renamingBusy, setRenamingBusy] = useState(false);
  const renameOwner = useOwner();
  const renameSettle = useSettle(renameOwner);
  useEffect(() => () => renameOwner.invalidate(), [renameOwner]);
  const startRename = (entry: PdfShelfEntry) => {
    // Intent-side clear (the channel's rule): a previous attempt's
    // failure must not pre-judge the next one.
    renameSettle.clear();
    setDraft(entry.title);
    setRenaming(entry);
  };
  const cancelRename = () => {
    renameOwner.invalidate();
    setRenaming(null);
  };
  const commitRename = async () => {
    const entry = renaming;
    if (!entry || renamingBusy || !draft.trim()) return;
    setRenamingBusy(true);
    const outcome = await renameSettle.run(bytes.rename(entry.docId, draft));
    setRenamingBusy(false);
    if (outcome.ok && outcome.fresh) {
      setRenaming(null);
      // The shelf's rows (and the reading face's title at its next open)
      // read the stored record: one refresh retells them.
      void refresh();
    }
    // A fresh failure raises the channel's flag — the overlay keeps the
    // draft and offers 保存 again; a stale outcome belongs to an overlay
    // the reader already left.
  };
  const owner = useOwner();
  const { run } = useSettle(owner);
  useEffect(() => () => owner.invalidate(), [owner]);
  const cleaned = (docId: string) => {
    setCleanupFailures((current) => {
      const next = new Set(current);
      next.delete(docId);
      return next;
    });
    void refresh();
  };
  const cleanupTicket = owner.mark();
  const onDeleted = async (docId: string) => {
    // Bytes commit first. Recent cleanup has no shared transaction and can
    // fail independently; row removal never waits on convenience cleanup.
    void refresh();
    const outcome = await run(positions.clearRecentIf(docId), {
      ticket: cleanupTicket,
    });
    if (!outcome.fresh) return;
    if (outcome.ok) cleaned(docId);
    else setCleanupFailures((current) => new Set(current).add(docId));
  };
  return (
    <section aria-label="PDF 书架" className="reader-recents pdf-shelf">
      <h2>PDF 书架</h2>
      {entries.length === 0 && !failed ? (
        <p className="reader-hint">书架暂无 PDF。</p>
      ) : null}
      <ol>
        {entries.map((entry) => (
          <PdfShelfRow
            key={entry.docId}
            entry={entry}
            bytes={bytes}
            onOpen={onOpen}
            onDeleted={onDeleted}
            onRename={startRename}
          />
        ))}
      </ol>
      {[...cleanupFailures].map((docId) => (
        <RecentCleanup
          key={docId}
          docId={docId}
          positions={positions}
          onCleaned={() => cleaned(docId)}
        />
      ))}
      {renaming ? (
        <div className="overlay-veil" role="dialog" aria-label="修改书名">
          <div className="overlay-card">
            <h2 className="overlay-title">修改书名</h2>
            <label className="settings-field">
              <span className="settings-label">书名</span>
              <input
                type="text"
                value={draft}
                aria-label="书名"
                // Commit on Enter matches the settings card's rhythm; the
                // buttons remain the discoverable path.
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commitRename();
                }}
              />
            </label>
            {renameSettle.failed ? (
              <p className="reader-error" role="alert">
                改名失败，请重试。
              </p>
            ) : null}
            <div className="overlay-actions">
              <button
                type="button"
                className="settings-save"
                disabled={renamingBusy || !draft.trim()}
                onClick={() => {
                  void commitRename();
                }}
              >
                保存
              </button>
              <button
                type="button"
                disabled={renamingBusy}
                onClick={cancelRename}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
