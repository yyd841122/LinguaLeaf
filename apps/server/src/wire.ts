// The import lifecycle's wire vocabulary AND the reading-pair/shelf-row
// payload shapes — declared once so both tiers compile against one source.
// The server owns the values (it writes them); the web
// owns the label/copy maps keyed by them (apps/web/src/importCopy.ts).
// Type-only on purpose: every web-side import is `import type`, so the built
// bundle carries no server code, and nothing here exists at runtime.
// Adding a member to a union turns every consumer's next typecheck red
// until it handles the new value — the drift guard the hand-copied unions
// and the 文案 comparison could never give (.scratch/wire-vocabulary/).

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

// The vocabulary's stored states (ADR-0005, 生词本四态): a word_states row
// always carries one of these three. 'New' — never encountered — is the
// row's absence (the chapter payload's null), never a stored value: the
// auto-migration inserts 'learning' on the first lookup, and only the
// popup's explicit operations move a row from there.
export type WordStatus = "learning" | "known" | "ignored";

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
