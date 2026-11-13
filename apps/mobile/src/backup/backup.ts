// The backup orchestrator (mobile-app ticket 05): assemble the versioned
// payload from the store seams, and apply a validated payload back through
// those same seams' upsert-shaped writes. Pure logic over the injected
// stores — jsdom tests drive memory twins; the Capacitor file/share side
// lives in the adapter (backup-file.ts), never here.

import type { LibraryStore } from "../store/library-store";
import { NOTES_PER_BOOK_LIMIT, type NotesStore } from "../store/notes-store";
import {
  isPdfRow,
  type BookmarkStore,
  type EpubBookmarkRow,
} from "../store/bookmark-store";
import type { TranslationStore } from "../store/translation-store";
import type { VocabularyStore } from "../store/vocabulary-store";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  type BackupPayload,
  type ImportSummary,
} from "./backup-format";

export type BackupStores = {
  store: VocabularyStore;
  notes: NotesStore;
  library: LibraryStore;
  bookmarks: BookmarkStore;
  translations: TranslationStore;
};

// The docId ↔ title pair is the one cross-host join (the phone derives
// docId as doc:<title>; the PC keys rows on integer book ids the format
// never carries). An id outside the doc: convention travels verbatim —
// it can only reattach on a host that spells its ids the same way.
const titleFromDocId = (docId: string): string =>
  docId.startsWith("doc:") ? docId.slice("doc:".length) : docId;
const docIdFromTitle = (title: string): string => `doc:${title}`;

export async function buildBackup(
  stores: BackupStores,
  now: () => number = Date.now
): Promise<BackupPayload> {
  const [vocabulary, notes, progress, bookmarks, translations] =
    await Promise.all([
      stores.store.exportAll(),
      stores.notes.exportAll(),
      stores.library.exportProgress(),
      stores.bookmarks.exportAll(),
      stores.translations.exportAll(),
    ]);

  const titles = new Set<string>();
  for (const note of notes) titles.add(titleFromDocId(note.docId));
  for (const title of Object.keys(progress)) titles.add(titleFromDocId(title));
  // PDF page rows stay device-local (the format carries EPUB marks only —
  // same posture as pdf-notes/positions since ticket 05; the version door
  // for PDF-side assets is stub ticket 12). A PDF doc with page marks but
  // no other asset therefore stays out of `books` entirely.
  for (const row of bookmarks) {
    if (!isPdfRow(row)) titles.add(titleFromDocId(row.docId));
  }
  for (const docId of Object.keys(translations)) {
    titles.add(titleFromDocId(docId));
  }

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date(now()).toISOString(),
    books: [...titles].sort().map((title) => ({ title })),
    assets: {
      vocabulary,
      notes: notes.map((note) => ({
        bookTitle: titleFromDocId(note.docId),
        chapterIndex: note.chapterIndex,
        blockIndex: note.blockIndex,
        type: note.type,
        text: note.text,
      })),
      progress: Object.fromEntries(
        Object.entries(progress).map(([docId, position]) => [
          titleFromDocId(docId),
          position,
        ])
      ),
      bookmarks: bookmarks
        .filter(
          (row): row is EpubBookmarkRow & { docId: string } => !isPdfRow(row)
        )
        .map((row) => ({
          bookTitle: titleFromDocId(row.docId),
          chapter: row.chapter,
          block: row.block,
          createdAt: row.createdAt,
        })),
      translations: Object.fromEntries(
        Object.entries(translations).map(([docId, chapters]) => [
          titleFromDocId(docId),
          chapters,
        ])
      ),
    },
  };
}

// Apply = per-asset upsert through each store's own write path — nothing
// is wiped: an import merges into whatever the phone already holds (the
// PC side wins each per-asset conflict as the migration source). The
// per-book note cap is honored BEFORE writing: notes beyond a book's
// headroom are pre-counted as skipped, so the cap can never fire mid-apply
// and leave a half-reported batch.
export async function applyBackup(
  payload: BackupPayload,
  stores: BackupStores
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    vocabulary: 0,
    notes: 0,
    notesSkippedOverCap: 0,
    progress: 0,
    bookmarks: 0,
    translations: 0,
  };

  for (const [lemma, status] of Object.entries(payload.assets.vocabulary)) {
    await stores.store.setStatus(lemma, status);
    summary.vocabulary += 1;
  }

  for (const [title, position] of Object.entries(payload.assets.progress)) {
    await stores.library.setProgress(docIdFromTitle(title), position);
    summary.progress += 1;
  }

  for (const row of payload.assets.bookmarks) {
    await stores.bookmarks.add(docIdFromTitle(row.bookTitle), {
      chapter: row.chapter,
      block: row.block,
    });
    summary.bookmarks += 1;
  }

  for (const [title, chapters] of Object.entries(payload.assets.translations)) {
    for (const [chapterKey, chapter] of Object.entries(chapters)) {
      const entries = Object.entries(chapter).map(
        ([blockKey, translation]) => ({
          blockIndex: Number(blockKey),
          translation,
        })
      );
      await stores.translations.saveTranslations(
        docIdFromTitle(title),
        Number(chapterKey),
        entries
      );
      summary.translations += entries.length;
    }
  }

  const notesByBook = new Map<string, typeof payload.assets.notes>();
  for (const note of payload.assets.notes) {
    const bag = notesByBook.get(note.bookTitle) ?? [];
    bag.push(note);
    notesByBook.set(note.bookTitle, bag);
  }
  for (const [title, incoming] of notesByBook) {
    const docId = docIdFromTitle(title);
    const existing = await stores.notes.list(docId);
    const existingAnchors = new Set(
      existing.map(
        (note) => `${note.chapterIndex}:${note.blockIndex}:${note.type}`
      )
    );
    // Replacements don't consume the cap; fresh notes share the headroom.
    const headroom = Math.max(0, NOTES_PER_BOOK_LIMIT - existing.length);
    let freshUsed = 0;
    for (const note of incoming) {
      const isReplacement = existingAnchors.has(
        `${note.chapterIndex}:${note.blockIndex}:${note.type}`
      );
      if (!isReplacement && freshUsed >= headroom) {
        summary.notesSkippedOverCap += 1;
        continue;
      }
      if (!isReplacement) freshUsed += 1;
      await stores.notes.save(
        {
          docId,
          chapterIndex: note.chapterIndex,
          blockIndex: note.blockIndex,
          type: note.type,
        },
        note.text
      );
      summary.notes += 1;
    }
  }

  return summary;
}
