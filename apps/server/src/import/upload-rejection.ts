import type { ImportErrorCode } from "../wire.js";

// The upload front half's normalized rejection. Every format reader and
// the size cap reject a bad upload by throwing this with a stable reason
// code from the wire vocabulary; the router answers it through the one
// reason → status table below and never learns a format's native error
// shapes (.scratch/format-reader-registry/).
export class UploadRejected extends Error {
  constructor(
    readonly reason: ImportErrorCode,
    message: string
  ) {
    super(message);
  }
}

// The one table pairing each wire reason with its HTTP status — what a
// bad upload costs the client, in one place. Multer's file-too-large
// rides it even though no format reader throws it.
export const REJECTION_STATUS: Record<ImportErrorCode, number> = {
  "unsupported-format": 415,
  "invalid-epub": 400,
  "invalid-pdf": 400,
  "encrypted-pdf": 400,
  "scanned-pdf": 422,
  "file-too-large": 413,
};
