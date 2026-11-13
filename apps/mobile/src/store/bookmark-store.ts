import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The manual bookmark store (mobile-app ticket 10): where a reader planted
// a mark, in the same {chapter, block} coordinates reading progress and
// the view's data-block-index anchors use. The row model mirrors the SHAPE
// of the wire BookmarkSummary (apps/server/src/wire.ts) so the backup
// ticket (05) can carry PC-exported marks without a translation layer —
// the VALUES are phone-semantics 0-based; the PC database is 1-based and
// its export route converts (wire.ts's coordinate convention). ids are
// minted
// locally (a per-record counter) — cross-device id collisions are the
// import side's merge problem, not this seam's. No per-book cap: the web
// server's cap is server hygiene, and local data has no such need.

export type BookmarkRow = {
  id: number;
  chapter: number;
  block: number;
  createdAt: string;
};

export type BookmarkTarget = { chapter: number; block: number };

// The backup's enumeration row (ticket 05): the docId rides along so the
// backup can key rows by book title across devices — the exported format
// drops the local id (the import side re-mints by position).
export type StoredBookmarkRow = BookmarkRow & { docId: string };

export interface BookmarkStore {
  // (chapter, block) reading order — the order the panel lists rows in.
  list(docId: string): Promise<BookmarkRow[]>;
  // The backup's enumeration read: every doc's rows.
  exportAll(): Promise<StoredBookmarkRow[]>;
  // Same-position add is idempotent: an existing (chapter, block) row is
  // returned unchanged (the wire's 201-fresh / 200-existing semantics).
  add(docId: string, target: BookmarkTarget): Promise<BookmarkRow>;
  // Removing an absent id is a no-op success (the wire's 204-for-any-id
  // semantics — deletion is explicit, but its failure is not a silent
  // no-op *report*).
  remove(docId: string, id: number): Promise<void>;
}

// The list order, one fact shared by the store's writes and the panel's
// local merges (web's session sorts fresh rows back in the same way).
export const byReadingOrder = (a: BookmarkRow, b: BookmarkRow): number =>
  a.chapter - b.chapter || a.block - b.block;

type DocRecord = { nextId: number; rows: BookmarkRow[] };
type StoredRecord = { byDoc: Record<string, DocRecord> };
const empty = (): StoredRecord => ({ byDoc: {} });

// Mints the row for a target into the doc's record — the idempotence and
// the reading order live here, so both store twins carry them by
// construction.
const plantRow = (record: DocRecord, target: BookmarkTarget): BookmarkRow => {
  const existing = record.rows.find(
    (row) => row.chapter === target.chapter && row.block === target.block
  );
  if (existing) return existing;
  const row: BookmarkRow = {
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
