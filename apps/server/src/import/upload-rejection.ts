import type { ImportErrorCode } from "@lingualeaf/import-core";

// The rejection class and the wire union live with the import chain
// (@lingualeaf/import-core) so the extension can branch the same reasons;
// re-exported here so the server's import sites keep one import path. What
// stays server-side is the HTTP cost model: the one table pairing each
// wire reason with its status — what a bad upload costs the client, in one
// place. Multer's file-too-large rides it even though no format reader
// throws it.
export { UploadRejected } from "@lingualeaf/import-core";

export const REJECTION_STATUS: Record<ImportErrorCode, number> = {
  "unsupported-format": 415,
  "invalid-epub": 400,
  "invalid-pdf": 400,
  "encrypted-pdf": 400,
  "scanned-pdf": 422,
  "file-too-large": 413,
};
