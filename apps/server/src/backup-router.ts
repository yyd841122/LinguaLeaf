import { Router } from "express";
import type Database from "better-sqlite3";
import {
  getProgress,
  listBookmarks,
  listNotes,
  listSettledTranslations,
  listShelf,
} from "./book-store.js";
import { loadWordStatuses } from "./vocab-store.js";
import { BACKUP_APP, BACKUP_VERSION, type BackupPayload } from "./wire.js";
import type { SettledTranslationRow } from "./book-store.js";

// The PC's full-backup export (mobile-app ticket 05, ADR-0008's named
// route): assemble the versioned payload from the book database — every
// learner asset except the book files themselves, which the phone
// re-imports (the docId re-derives from the title and reattaches).
// Book-level notes (null anchors) have no place on the phone's block
// grid; they are skipped and the count rides the response header, so
// nothing vanishes silently.
export function createBackupRouter(database: Database.Database): Router {
  const router = Router();
  router.get("/backup", (_request, response) => {
    const shelf = listShelf(database);
    const notes: BackupPayload["assets"]["notes"] = [];
    const bookmarks: BackupPayload["assets"]["bookmarks"] = [];
    const progress: BackupPayload["assets"]["progress"] = {};
    let bookLevelNotesSkipped = 0;
    const books: { title: string }[] = [];

    for (const entry of shelf) {
      books.push({ title: entry.title });
      for (const note of listNotes(database, entry.id)) {
        if (note.chapter === null || note.block === null) {
          bookLevelNotesSkipped += 1;
          continue;
        }
        notes.push({
          bookTitle: entry.title,
          // PC positions are 1-based; the format is phone-semantics
          // 0-based (see wire.ts's coordinate convention).
          chapterIndex: note.chapter - 1,
          blockIndex: note.block - 1,
          type: note.type,
          text: note.text,
        });
      }
      for (const bookmark of listBookmarks(database, entry.id)) {
        bookmarks.push({
          bookTitle: entry.title,
          chapter: bookmark.chapter - 1,
          block: bookmark.block - 1,
          createdAt: bookmark.createdAt,
        });
      }
      const position = getProgress(database, entry.id);
      if (position) {
        progress[entry.title] = {
          chapterIndex: position.chapter - 1,
          blockIndex: position.block - 1,
        };
      }
    }

    const payload: BackupPayload = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      books: books.sort((a, b) => a.title.localeCompare(b.title)),
      assets: {
        vocabulary: Object.fromEntries(loadWordStatuses(database)),
        notes,
        progress,
        bookmarks,
        translations: nestTranslations(listSettledTranslations(database)),
      },
    };

    // The skip count is diagnostic (the web's summary line names it); the
    // body stays the clean format the phone's validator expects.
    response.set(
      "Content-Disposition",
      `attachment; filename="${backupFilename()}"`
    );
    if (bookLevelNotesSkipped > 0) {
      response.set(
        "X-Backup-Skipped-Book-Notes",
        String(bookLevelNotesSkipped)
      );
    }
    response.json(payload);
  });
  return router;
}

// Translations are PC learner assets too (the chapter route's settled
// lines): nested bookTitle → chapter → block → line, the phone-side
// merge semantics ride the same shape. PC positions are 1-based; the
// format is 0-based (wire.ts's coordinate convention).
function nestTranslations(
  rows: SettledTranslationRow[]
): BackupPayload["assets"]["translations"] {
  const out: BackupPayload["assets"]["translations"] = {};
  for (const row of rows) {
    const chapters = (out[row.title] ??= {});
    const blocks = (chapters[String(row.chapter - 1)] ??= {});
    blocks[String(row.block - 1)] = row.line;
  }
  return out;
}

function backupFilename(): string {
  const t = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `lingualeaf-backup-v1-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(
    t.getDate()
  )}-${pad(t.getHours())}${pad(t.getMinutes())}.json`;
}
