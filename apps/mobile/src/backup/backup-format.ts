// The versioned backup payload (mobile-app ticket 05): the one format
// both hosts emit and only the phone consumes. Device-local ids — the
// phone's `doc:<title>` keys, the PC's integer book ids — never enter
// the format: the book TITLE is the one join key both sides derive, and
// the import side re-mints bookmark ids (ticket 10's same-position
// idempotence makes that merge-safe). The version field is the forward
// door: readers reject versions they do not know rather than guess.
// Settings never ride a backup: the translation API key is a secret.

// The format's identity lives in the shared wire vocabulary (one source
// for both hosts); this module owns the phone-side validator and the
// import summary.
import {
  BACKUP_APP,
  BACKUP_VERSION,
  NOTE_TYPES,
  type BackupPayload,
  type NoteType,
} from "../../../server/src/wire";
import type { VocabState } from "../store/vocabulary-store";
// The validator mirrors the apply path's deterministic constraints (the
// zero-write gate): a note the stores would refuse at write time — the
// 10,000-char cap — must fail validation instead of dying mid-apply with
// the other assets already landed.
import { NOTE_TEXT_LIMIT } from "../store/notes-store";

export { BACKUP_APP, BACKUP_VERSION };
export type { BackupPayload };

// The import's readable outcome: per-asset counts, plus the notes each
// book's 100-note cap left behind (skipping is reported, never silent).
export type ImportSummary = {
  vocabulary: number;
  notes: number;
  notesSkippedOverCap: number;
  progress: number;
  bookmarks: number;
  translations: number;
};

const VOCAB_STATES: readonly VocabState[] = ["learning", "known", "ignored"];

class BackupFormatError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Chapter/block keys ride the payload as strings and apply writes
// Number(key) straight into the stores: a non-canonical spelling — "-1",
// "1.5", "01" — would coerce to a negative, fractional, or aliased
// chapter and land as corrupt data after earlier assets already wrote.
// The canonical decimal spelling of a non-negative integer is the only
// shape both hosts mint (String(integer) on every export path).
function isCanonicalIndexKey(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(key);
}

// The shape guards carry the failing ASSET's name — a corrupt file must
// read as "the notes section is broken", not a bare damage line.
function asString(value: unknown, section: string): string {
  if (typeof value !== "string") {
    throw new BackupFormatError(`备份已损坏：${section}无效。`);
  }
  return value;
}

function asIndex(value: unknown, section: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BackupFormatError(`备份已损坏：${section}无效。`);
  }
  return value;
}

// Full structural validation before any write: the import is
// all-or-nothing at the format gate — a corrupt file names what failed
// and nothing lands (ticket: 损坏文件拒绝且报错可读).
export function validateBackupPayload(value: unknown): BackupPayload {
  if (!isPlainObject(value) || value.app !== BACKUP_APP) {
    throw new BackupFormatError("不是 LinguaLeaf 备份文件。");
  }
  if (value.version !== BACKUP_VERSION) {
    throw new BackupFormatError(
      `备份版本不受支持（文件 version ${String(value.version)}，本机支持 ${BACKUP_VERSION}）。`
    );
  }
  if (typeof value.exportedAt !== "string" || !value.exportedAt) {
    throw new BackupFormatError("备份已损坏：缺少导出时间。");
  }
  if (!Array.isArray(value.books)) throw new BackupFormatError("备份已损坏。");

  const assets = value.assets;
  if (!isPlainObject(assets)) throw new BackupFormatError("备份已损坏。");

  const vocabulary = assets.vocabulary;
  if (!isPlainObject(vocabulary))
    throw new BackupFormatError("备份已损坏：生词本段无效。");
  for (const [lemma, status] of Object.entries(vocabulary)) {
    if (!lemma || !VOCAB_STATES.includes(status as VocabState)) {
      throw new BackupFormatError("备份已损坏：生词本段无效。");
    }
  }

  if (!Array.isArray(assets.notes))
    throw new BackupFormatError("备份已损坏：笔记段无效。");
  for (const raw of assets.notes) {
    if (!isPlainObject(raw))
      throw new BackupFormatError("备份已损坏：笔记段无效。");
    const title = asString(raw.bookTitle, "笔记段");
    if (!title) throw new BackupFormatError("备份已损坏：笔记段无效。");
    asIndex(raw.chapterIndex, "笔记段");
    asIndex(raw.blockIndex, "笔记段");
    if (!NOTE_TYPES.includes(raw.type as NoteType)) {
      throw new BackupFormatError("备份已损坏：笔记段无效。");
    }
    if (
      typeof raw.text !== "string" ||
      !raw.text.trim() ||
      raw.text.length > NOTE_TEXT_LIMIT
    ) {
      throw new BackupFormatError("备份已损坏：笔记段无效。");
    }
  }

  const progress = assets.progress;
  if (!isPlainObject(progress))
    throw new BackupFormatError("备份已损坏：进度段无效。");
  for (const [title, position] of Object.entries(progress)) {
    if (!title || !isPlainObject(position)) {
      throw new BackupFormatError("备份已损坏：进度段无效。");
    }
    asIndex(position.chapterIndex, "进度段");
    asIndex(position.blockIndex, "进度段");
  }

  if (!Array.isArray(assets.bookmarks)) {
    throw new BackupFormatError("备份已损坏：书签段无效。");
  }
  for (const raw of assets.bookmarks) {
    if (!isPlainObject(raw))
      throw new BackupFormatError("备份已损坏：书签段无效。");
    if (!asString(raw.bookTitle, "书签段")) {
      throw new BackupFormatError("备份已损坏：书签段无效。");
    }
    asIndex(raw.chapter, "书签段");
    asIndex(raw.block, "书签段");
    if (typeof raw.createdAt !== "string" || !raw.createdAt) {
      throw new BackupFormatError("备份已损坏：书签段无效。");
    }
  }

  const translations = assets.translations;
  if (!isPlainObject(translations)) {
    throw new BackupFormatError("备份已损坏：译文段无效。");
  }
  // Keys get the same gate as values: the book title must be present,
  // and every chapter/block key the canonical spelling of a non-negative
  // integer (apply coerces them with Number(); a stray key would land as
  // a corrupt chapter). Values-only checks let "-1"/"01"/"abc" through
  // to the apply path.
  for (const [title, chapters] of Object.entries(translations)) {
    if (!title || !isPlainObject(chapters))
      throw new BackupFormatError("备份已损坏：译文段无效。");
    for (const [chapterKey, chapter] of Object.entries(chapters)) {
      if (!isCanonicalIndexKey(chapterKey) || !isPlainObject(chapter))
        throw new BackupFormatError("备份已损坏：译文段无效。");
      for (const [blockKey, line] of Object.entries(chapter)) {
        if (!isCanonicalIndexKey(blockKey) || typeof line !== "string")
          throw new BackupFormatError("备份已损坏：译文段无效。");
      }
    }
  }

  return value as unknown as BackupPayload;
}

export function isBackupFormatError(
  error: unknown
): error is BackupFormatError {
  return error instanceof BackupFormatError;
}
