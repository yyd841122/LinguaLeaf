// The import chain's rejection vocabulary — the union's home. Both reading
// tiers branch on these codes: the server maps them to HTTP statuses
// (REJECTION_STATUS, apps/server/src/import/upload-rejection.ts) and the
// extension maps them to user-facing copy. The server's wire module
// re-exports the two types so the web tier keeps its single import site
// (apps/server/src/wire.ts).
export type ImportErrorCode =
  | "unsupported-format" // 415 — extension not accepted (server); copy (extension)
  | "invalid-epub" // 400 — EPUB unparseable
  | "invalid-pdf" // 400 — PDF unparseable
  | "encrypted-pdf" // 400 — password-protected PDF
  | "scanned-pdf" // 422 — image-only PDF
  | "file-too-large"; // 413 — past the upload limit

// The shape of every coded import rejection: a stable machine code beside
// the reader-facing message (CODING_STANDARDS: error bodies are a code plus
// copy; clients branch on the code).
export type ImportRejection = {
  code: ImportErrorCode;
  error: string;
};

// Every format reader rejects a bad upload by throwing this with a stable
// reason code; the router answers it through the one reason → status table
// and never learns a format's native error shapes (.scratch/format-reader-registry/).
export class UploadRejected extends Error {
  constructor(
    readonly reason: ImportErrorCode,
    message: string
  ) {
    super(message);
  }
}
