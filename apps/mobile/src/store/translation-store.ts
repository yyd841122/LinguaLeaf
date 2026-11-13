import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The store of settled 译文行 (mobile-app ticket 04). Translations live
// OUTSIDE the fingerprinted book shape on purpose: the fingerprint guards
// book content against silent replacement, and a re-imported EPUB carries
// no translations — if translations rode the blocks, either the re-import
// would read as a content change or a re-save would drop what was
// translated. Keyed docId → chapterIndex → blockIndex; the block index
// counts ALL blocks (the same rule notes and progress anchor by), so the
// chapter task can hold its sentence blocks once and write back by the
// held indices.

// One chapter's settled translations: blockIndex → translation. Only
// sentence blocks appear; an untranslated sentence has no entry.
export type ChapterTranslations = Record<number, string>;

export type TranslationEntry = { blockIndex: number; translation: string };

export interface TranslationStore {
  getChapter(docId: string, chapterIndex: number): Promise<ChapterTranslations>;
  saveTranslations(
    docId: string,
    chapterIndex: number,
    entries: TranslationEntry[]
  ): Promise<void>;
  // The backup's enumeration read (ticket 05): the whole doc → chapter
  // (string key) → block → line map, cloned.
  exportAll(): Promise<Record<string, Record<string, ChapterTranslations>>>;
}

type StoredRecord = {
  byDoc: Record<string, Record<string, ChapterTranslations>>;
};
const empty = (): StoredRecord => ({ byDoc: {} });

// Memory-backed twin for tests (the injected store habit: jsdom never
// opens IndexedDB).
export function createMemoryTranslationStore(): TranslationStore {
  const byDoc = new Map<string, Map<number, ChapterTranslations>>();
  return {
    async getChapter(docId, chapterIndex) {
      return { ...(byDoc.get(docId)?.get(chapterIndex) ?? {}) };
    },
    async exportAll() {
      const out: Record<string, Record<string, ChapterTranslations>> = {};
      for (const [docId, chapters] of byDoc) {
        out[docId] = {};
        for (const [chapterIndex, chapter] of chapters) {
          out[docId][String(chapterIndex)] = { ...chapter };
        }
      }
      return out;
    },
    async saveTranslations(docId, chapterIndex, entries) {
      const chapters = byDoc.get(docId) ?? new Map();
      const chapter = { ...(chapters.get(chapterIndex) ?? {}) };
      for (const { blockIndex, translation } of entries)
        chapter[blockIndex] = translation;
      chapters.set(chapterIndex, chapter);
      byDoc.set(docId, chapters);
    },
  };
}

// The real store: one namespace record through the shared helper over the
// injected backend (IndexedDB on the phone) — writes run serialized on the
// helper's queue, like every other store seam.
const STORAGE_NAMESPACE = "translations";

export function createTranslationStore(
  storage: NamespaceStorage
): TranslationStore {
  const record = createNamespaceRecord<StoredRecord>(
    STORAGE_NAMESPACE,
    empty,
    storage
  );
  return {
    async getChapter(docId, chapterIndex) {
      const r = await record.read();
      return { ...(r.byDoc[docId]?.[String(chapterIndex)] ?? {}) };
    },
    async exportAll() {
      const r = await record.read();
      const out: Record<string, Record<string, ChapterTranslations>> = {};
      for (const [docId, chapters] of Object.entries(r.byDoc)) {
        out[docId] = {};
        for (const [chapterIndex, chapter] of Object.entries(chapters)) {
          out[docId][chapterIndex] = { ...chapter };
        }
      }
      return out;
    },
    saveTranslations(docId, chapterIndex, entries) {
      return record.update(async (r, write) => {
        const doc = (r.byDoc[docId] ??= {});
        const key = String(chapterIndex);
        doc[key] = { ...doc[key], ...toEntryMap(entries) };
        await write(r);
      });
    },
  };
}

function toEntryMap(entries: TranslationEntry[]): ChapterTranslations {
  const chapter: ChapterTranslations = {};
  for (const { blockIndex, translation } of entries)
    chapter[blockIndex] = translation;
  return chapter;
}
