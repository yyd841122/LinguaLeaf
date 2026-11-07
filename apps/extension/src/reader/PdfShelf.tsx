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
}: {
  entry: PdfShelfEntry;
  bytes: PdfBytesStore;
  onOpen: (entry: PdfShelfEntry) => void;
  onDeleted: (docId: string) => Promise<void>;
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
    </section>
  );
}
