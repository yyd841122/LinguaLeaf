import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The manual bookmark store (mobile-app tickets 10 and 03): where a
// reader planted a mark. A row is shaped by its book's kind — an EPUB row
// targets (chapter, block), the same coordinates reading progress and the
// view's data-block-index anchors use; a PDF row (ticket 03) targets a
// page, the canvas face's only position unit. One doc never mixes shapes:
// docIds are `doc:<title>` for EPUB and byte fingerprints for PDF, so the
// order and idempotence below branch per shape without ever facing the
// mixed case. The row model mirrors the SHAPE of the wire
// BookmarkSummary (apps/server/src/wire.ts) so the backup ticket (05)
// can carry PC-exported marks without a translation layer — the VALUES
// are phone-semantics 0-based; the PC database is 1-based and its export
// route converts (wire.ts's coordinate convention). PDF rows have no wire
// counterpart (the PC has no PDFs) — the backup builder filters them out
// while the format's version door stays shut (stub ticket 12). ids are
// minted
// locally (a per-record counter) — cross-device id collisions are the
// import side's merge problem, not this seam's. No per-book cap: the web
// server's cap is server hygiene, and local data has no such need.

export type EpubBookmarkTarget = { chapter: number; block: number };
export type PdfBookmarkTarget = { page: number };
export type BookmarkTarget = EpubBookmarkTarget | PdfBookmarkTarget;

export type EpubBookmarkRow = {
  id: number;
  chapter: number;
  block: number;
  createdAt: string;
};

export type PdfBookmarkRow = {
  id: number;
  page: number;
  createdAt: string;
};

export type BookmarkRow = EpubBookmarkRow | PdfBookmarkRow;

// The EPUB face's rows (every consumer there talks chapters and blocks).
export const isEpubRow = (row: BookmarkRow): row is EpubBookmarkRow =>
  "block" in row;
export const isPdfRow = (row: BookmarkRow): row is PdfBookmarkRow =>
  "page" in row;

// The backup's enumeration row (ticket 05): the docId rides along so the
// backup can key rows by book title across devices — the exported format
// drops the local id (the import side re-mints by position). Union rows
// ride as their kind; the backup builder keeps only EPUB rows.
export type StoredBookmarkRow = BookmarkRow & { docId: string };

export interface BookmarkStore {
  // Reading order — the order the panel lists rows in.
  list(docId: string): Promise<BookmarkRow[]>;
  // The backup's enumeration read: every doc's rows.
  exportAll(): Promise<StoredBookmarkRow[]>;
  // Same-position add is idempotent: an existing row at the target is
  // returned unchanged (the wire's 201-fresh / 200-existing semantics).
  // Callers narrow the row by their face's kind (isEpubRow / isPdfRow) —
  // a doc never mixes shapes.
  add(docId: string, target: BookmarkTarget): Promise<BookmarkRow>;
  // Removing an absent id is a no-op success (the wire's 204-for-any-id
  // semantics — deletion is explicit, but its failure is not a silent
  // no-op *report*).
  remove(docId: string, id: number): Promise<void>;
}

// The list order, one fact shared by the store's writes and the panel's
// local merges (web's session sorts fresh rows back in the same way).
// Pages and (chapter, block) never share a doc, so the comparator never
// meets the mixed pair.
export const byReadingOrder = (a: BookmarkRow, b: BookmarkRow): number =>
  isPdfRow(a) && isPdfRow(b)
    ? a.page - b.page
    : isEpubRow(a) && isEpubRow(b)
      ? a.chapter - b.chapter || a.block - b.block
      : 0;

type DocRecord = { nextId: number; rows: BookmarkRow[] };
type StoredRecord = { byDoc: Record<string, DocRecord> };
const empty = (): StoredRecord => ({ byDoc: {} });

const sameTarget = (row: BookmarkRow, target: BookmarkTarget): boolean =>
  "page" in target
    ? isPdfRow(row) && row.page === target.page
    : isEpubRow(row) &&
      row.chapter === target.chapter &&
      row.block === target.block;

// Mints the row for a target into the doc's record — the idempotence and
// the reading order live here, so both store twins carry them by
// construction.
const plantRow = (record: DocRecord, target: BookmarkTarget): BookmarkRow => {
  const existing = record.rows.find((row) => sameTarget(row, target));
  if (existing) return existing;
  const row: BookmarkRow =
    "page" in target
      ? {
          id: record.nextId++,
          page: target.page,
          createdAt: new Date().toISOString(),
        }
      : {
          id: record.nextId++,
          chapter: target.chapter,
          block: target.block,
          createdAt: new Date().toISOString(),
        };
  record.rows.push(row);
  record.rows.sort(byReadingOrder);
  return row;
};

// Memory-backed twin for tests (the injected store habit: jsdom never
// opens IndexedDB).
export function createMemoryBookmarkStore(): BookmarkStore {
  const byDoc = new Map<string, DocRecord>();
  const docOf = (docId: string): DocRecord => {
    const existing = byDoc.get(docId);
    if (existing) return existing;
    const fresh: DocRecord = { nextId: 1, rows: [] };
    byDoc.set(docId, fresh);
    return fresh;
  };
  return {
    async list(docId) {
      return docOf(docId).rows.map((row) => ({ ...row }));
    },
    async exportAll() {
      return [...byDoc.entries()].flatMap(([docId, record]) =>
        record.rows.map((row) => ({ ...row, docId }))
      );
    },
    async add(docId, target) {
      return { ...plantRow(docOf(docId), target) };
    },
    async remove(docId, id) {
      const record = docOf(docId);
      record.rows = record.rows.filter((row) => row.id !== id);
    },
  };
}

// The real store: one namespace record through the shared helper over the
// injected backend (IndexedDB on the phone) — writes run serialized on the
// helper's queue, like every other store seam.
const STORAGE_NAMESPACE = "bookmarks";

export function createBookmarkStore(storage: NamespaceStorage): BookmarkStore {
  const record = createNamespaceRecord<StoredRecord>(
    STORAGE_NAMESPACE,
    empty,
    storage
  );
  return {
    list(docId) {
      return record
        .read()
        .then((r) => (r.byDoc[docId]?.rows ?? []).map((row) => ({ ...row })));
    },
    async exportAll() {
      const r = await record.read();
      return Object.entries(r.byDoc).flatMap(([docId, doc]) =>
        doc.rows.map((row) => ({ ...row, docId }))
      );
    },
    add(docId, target) {
      return record.update(async (r, write) => {
        const doc = (r.byDoc[docId] ??= { nextId: 1, rows: [] });
        const row = plantRow(doc, target);
        await write(r);
        return { ...row };
      });
    },
    remove(docId, id) {
      return record.update(async (r, write) => {
        const doc = r.byDoc[docId];
        if (!doc) return;
        doc.rows = doc.rows.filter((row) => row.id !== id);
        await write(r);
      });
    },
  };
}
