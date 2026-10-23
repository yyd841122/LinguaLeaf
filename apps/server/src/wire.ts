// The import lifecycle's wire vocabulary — the machine fields the API puts
// on the wire and the shelf reads back, declared once so both tiers compile
// against one source. The server owns the values (it writes them); the web
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

// The stages the bookshelf shows while importing. The translating stage
// left the pipeline with on-demand translation (ADR-0004, ticket 02) — an
// import is IPA lookups plus the block insert, effectively instant, so no
// stage carries a percent anymore. books.import_percent stays on the wire
// for rows older imports wrote; the startup sweep clears it.
export type ImportStage = "annotating" | "saving";

// Stable machine codes for the upload rejections the shelf branches on.
// The body's `error` field stays reader-facing prose the server may reword;
// the code is the contract, so client branches survive copy edits. Each
// reason's HTTP status lives in one table: REJECTION_STATUS
// (apps/server/src/import/upload-rejection.ts).
export type ImportErrorCode =
  | "unsupported-format" // 415 — extension not accepted
  | "invalid-epub" // 400 — EPUB unparseable
  | "invalid-pdf" // 400 — PDF unparseable
  | "encrypted-pdf" // 400 — password-protected PDF
  | "scanned-pdf" // 422 — image-only PDF
  | "file-too-large"; // 413 — past the upload limit

// The shape of every coded upload rejection: a stable machine code beside
// the reader-facing message. The router builds these with `satisfies`, so
// a typo'd code is a compile error where the body is written.
export type ImportRejection = {
  code: ImportErrorCode;
  error: string;
};
