import type { ExtBook } from "../reader/import-book";
import { createNamespaceRecord } from "./namespace-record";

// The reading position inside one document: the chapter plus the block the
// reader's viewport sits on — the same {chapter, block} shape the web
// reader persists.
export type ChapterProgress = { chapterIndex: number; blockIndex: number };

export type LibraryEntry = {
  id: string;
  title: string;
  // The recents order: most recently opened first.
  lastOpenedAt: number;
  progress: ChapterProgress;
};

// The library half of the storage seam (spec: 进度与列表走存储 seam): the
// imported documents themselves, their reading positions, and the recents
// list. Memory-backed for tests; chrome.storage.local for the real thing.
// Everything here dies with the extension's storage (数据自决: 卸载即清).
export interface LibraryStore {
  // Insert or replace by id; an existing document keeps its progress.
  saveDocument(doc: {
    id: string;
    title: string;
    book: ExtBook;
  }): Promise<void>;
  // The recents list, most recently opened first.
  listDocuments(): Promise<LibraryEntry[]>;
  // The book's blocks, and the touch that moves it up the recents.
  openDocument(id: string): Promise<ExtBook | null>;
  setProgress(id: string, progress: ChapterProgress): Promise<void>;
}

export type MemoryLibraryStore = LibraryStore & {
  documents: Map<
    string,
    { title: string; book: ExtBook; lastOpenedAt: number }
  >;
  progress: Map<string, ChapterProgress>;
};

export function createMemoryLibraryStore(
  now: () => number = Date.now
): MemoryLibraryStore {
  const documents = new Map<
    string,
    { title: string; book: ExtBook; lastOpenedAt: number }
  >();
  const progress = new Map<string, ChapterProgress>();
  return {
    documents,
    progress,
    async saveDocument({ id, title, book }) {
      documents.set(id, {
        title,
        book,
        lastOpenedAt: documents.get(id)?.lastOpenedAt ?? now(),
      });
    },
    async listDocuments() {
      return [...documents.entries()]
        .map(([id, doc]) => ({
          id,
          title: doc.title,
          lastOpenedAt: doc.lastOpenedAt,
          progress: progress.get(id) ?? { chapterIndex: 0, blockIndex: 0 },
        }))
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    },
    async openDocument(id) {
      const doc = documents.get(id);
      if (!doc) return null;
      doc.lastOpenedAt = now();
      return doc.book;
    },
    async setProgress(id, value) {
      progress.set(id, value);
    },
  };
}

// The real store: one namespace record in chrome.storage.local through the
// shared helper — every write (a debounced progress save can overlap a
// document open, so "single writer" was wishful) runs serialized on the
// helper's queue. Deliberately thin — behavior lives in the shared
// semantics above and is tested against the memory twin, plus one
// serialization pin for the queue itself.
const STORAGE_NAMESPACE = "library";

export type ChromeLibraryRecord = {
  documents: Record<
    string,
    { title: string; lastOpenedAt: number; book: ExtBook }
  >;
  progress: Record<string, ChapterProgress>;
};

export function createChromeLibraryStore(): LibraryStore {
  const record = createNamespaceRecord<ChromeLibraryRecord>(
    STORAGE_NAMESPACE,
    () => ({ documents: {}, progress: {} })
  );
  return {
    saveDocument({ id, title, book }) {
      return record.update(async (r, write) => {
        const existing = r.documents[id];
        r.documents[id] = {
          title,
          book,
          lastOpenedAt: existing?.lastOpenedAt ?? Date.now(),
        };
        await write(r);
      });
    },
    async listDocuments() {
      const r = await record.read();
      return Object.entries(r.documents)
        .map(([id, doc]) => ({
          id,
          title: doc.title,
          lastOpenedAt: doc.lastOpenedAt,
          progress: r.progress[id] ?? { chapterIndex: 0, blockIndex: 0 },
        }))
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    },
    openDocument(id) {
      return record.update(async (r, write) => {
        const doc = r.documents[id];
        if (!doc) return null;
        doc.lastOpenedAt = Date.now();
        await write(r);
        return doc.book;
      });
    },
    setProgress(id, value) {
      return record.update(async (r, write) => {
        r.progress[id] = value;
        await write(r);
      });
    },
  };
}
