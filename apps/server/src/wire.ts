// The import lifecycle's wire vocabulary AND the reading-pair/shelf-row
// payload shapes — declared once so both tiers compile against one source.
// The server owns the values (it writes them); the web
// owns the label/copy maps keyed by them (apps/web/src/importCopy.ts).
// Type-only on purpose: every web-side import is `import type`, so the built
// bundle carries no server code, and nothing here exists at runtime.
// Adding a member to a union turns every consumer's next typecheck red
// until it handles the new value — the drift guard the hand-copied unions
// and the 文案 comparison could never give (.scratch/wire-vocabulary/).
import type { WordStatus } from "@lingualeaf/reading-model";

// The shelf states of a book (ticket 08). 'importing' covers everything
// between the POST that created the row and the settle write; the
// reader-facing states are 'ready' and 'failed'.
export type BookStatus = "importing" | "ready" | "failed";

// The on-demand translation lifecycle of one chapter (ADR-0004,
// on-demand-translation ticket 01). 'translating' covers everything between
// the trigger POST's claim write and the task's settle write; the reading
// page's button keys its three shapes on these values. The pattern mirrors
// books.status: a restart sweep (ticket 04) is what moves a stranded
// 'translating' to 'failed'.
export type TranslationStatus =
  "untranslated" | "translating" | "translated" | "failed";

// The on-demand translation half of the chapter payload (ADR-0004): what
// the reading page's button and poll key on. translationAvailable (ticket
// 03) is the server's answer to "is a translation service configured",
// riding the same payload — the chapter GET and the trigger's 202 — so the
// button greys without a config endpoint of its own. The store's ChapterData
// stays translator-blind; the router, which holds the assembled translator,
// augments the payload with the flag.
export type ChapterTranslationState = {
  translationStatus: TranslationStatus;
  translationPercent: number | null;
  translationError: string | null;
  translationAvailable: boolean;
};

// The stages the bookshelf shows while importing. The translating stage
// left the pipeline with on-demand translation (ADR-0004, ticket 02) — an
// import is IPA lookups plus the block insert, effectively instant, so no
// stage carries a percent anymore. books.import_percent stays on the wire
// for rows older imports wrote; the startup sweep clears it.
export type ImportStage = "annotating" | "saving";

// Stable machine codes for the upload rejections the shelf branches on —
// re-exported from their home in @lingualeaf/import-core (extension-reader
// ticket 02): the extension branches the same codes into user copy, so the
// union lives with the import chain both hosts run. The body's `error`
// field stays reader-facing prose the server may reword; the code is the
// contract, so client branches survive copy edits. Each reason's HTTP
// status lives in one table: REJECTION_STATUS
// (apps/server/src/import/upload-rejection.ts).
export type { ImportErrorCode, ImportRejection } from "@lingualeaf/import-core";

// Shared vocabulary states (ADR-0005); kept type-only so wire consumers
// acquire no runtime dependency on the reading model.
export type { WordStatus } from "@lingualeaf/reading-model";

export type SentenceBlockPayload = {
  position: number;
  kind: "sentence";
  originalText: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translationText: string | null;
  // One entry per word token (the server's tokenizeWords order): the
  // token's lemma's 生词本 state, null = New (ADR-0005). The frontend
  // renders these verbatim and never lemmatizes (vocabulary-states spec, decision 5).
  wordStatuses: (WordStatus | null)[];
};

// EPUB/Markdown illustrations become placeholder blocks at their reading
// position (ticket 07): the alt text captions the placeholder, the image
// bytes themselves are not rendered.
export type PlainBlockPayload = {
  position: number;
  kind: "code" | "raw" | "image";
  originalText: string;
};

export type BlockPayload = SentenceBlockPayload | PlainBlockPayload;

export type ChapterPayload = ChapterTranslationState & {
  position: number;
  title: string;
  level: number | null;
  blocks: BlockPayload[];
};

export type BookSummary = {
  id: number;
  title: string;
  format: string;
  createdAt: string;
  // The async import lifecycle (ticket 08): 'importing' books show live
  // progress on the shelf, 'failed' books show the reason, 'ready' books
  // are the readable links.
  status: BookStatus;
  importStage: ImportStage | null;
  importPercent: number | null;
  importError: string | null;
  // PDF only (null for the other formats): drives the long-book hint on
  // the importing row.
  pageCount: number | null;
  progress: { chapter: number; block: number } | null;
};

export type BookToc = Omit<BookSummary, "progress"> & {
  chapters: { position: number; title: string; level: number | null }[];
};

// One manual bookmark (reading-bookmarks ticket 01): a reader-planted
// position marker in a book, keyed by the same chapter/block coordinates
// the progress pair and the reading view's data-position attributes use.
// The id is the proxy primary key (names may come later, spec P4);
// createdAt is the ISO string the INSERT wrote. The list route serves
// these in (chapter, block) reading order.
export type BookmarkSummary = {
  id: number;
  chapter: number;
  block: number;
  createdAt: string;
};

// The bookmark routes' stable error codes (reading-bookmarks ticket 01) —
// the machine half of each coded body, declared here so the router's
// bodies and the contract pins compile against one union and the first
// client branch on `code` inherits the type anchor (CODING_STANDARDS.md,
// "Error bodies are a code plus copy"). The body's `error` field stays
// rewordable prose.
export type BookmarkErrorCode =
  | "book-not-found"
  | "book-not-ready"
  | "invalid-position"
  | "bookmark-target-not-found"
  | "bookmark-limit-reached";

export type BookmarkError = {
  code: BookmarkErrorCode;
  error: string;
};

export type NoteType = "progress" | "feeling" | "idea" | "question";
export type NoteAnchor =
  { chapter: null; block: null } | { chapter: number; block: number };
export type NoteContent = { type: NoteType; text: string };
export type NoteSummary = NoteContent & {
  id: number;
  chapter: number | null;
  block: number | null;
  createdAt: string;
  updatedAt: string;
};
export type CreateNoteRequest = {
  type?: NoteType;
  text: string;
} & Partial<NoteAnchor>;
export type NotesResponse = { notes: NoteSummary[] };
export type NoteResponse = { note: NoteSummary };
export type NoteErrorCode =
  | "book-not-found"
  | "book-not-ready"
  | "invalid-position"
  | "invalid-note"
  | "note-target-not-found"
  | "note-not-found"
  | "note-exists"
  | "note-limit-reached";
export type NoteError = {
  code: NoteErrorCode;
  error: string;
  note?: NoteSummary;
};
