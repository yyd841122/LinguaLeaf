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

// The stages the bookshelf shows while importing. IPA lookups and insert
// are effectively instant; only 'translating' lasts long enough to be
// watched, so it is the one stage that carries a percent.
export type ImportStage = "annotating" | "translating" | "saving";

// Stable machine codes for the upload rejections the shelf branches on.
// The body's `error` field stays reader-facing prose the server may reword;
// the code is the contract, so client branches survive copy edits.
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
