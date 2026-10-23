import type { ImportRejection } from "../wire.js";
import type { PreparedBook } from "./pipeline.js";
import { isEpubFilename, readEpubBook } from "./epub.js";
import { isMarkdownFilename, readMarkdownBook } from "./markdown.js";
import { isPdfFilename, readPdfBook } from "./pdf.js";
import { UploadRejected } from "./upload-rejection.js";

// The upload front half's registry: the one place that knows which book
// formats exist. Each format module contributes its extension predicate
// and its reader; a bad upload comes back as one UploadRejected carrying
// a stable wire reason, so the router never learns a format's native
// failure shapes. Adding a format is one entry here plus its module.

// A format front half: the predicate that claims an upload by file name,
// and the reader that turns the bytes into a PreparedBook — or rejects
// them with a wire reason (upload-rejection.ts).
export type FormatReader = {
  accepts: (filename: string) => boolean;
  read: (content: Buffer, filename: string) => Promise<PreparedBook>;
};

// The shared body of both 415 fall-throughs: the router's no-file branch
// and readUpload's no-reader branch — what counts as a supported format
// is the registry's knowledge, so the envelope lives here.
export const UNSUPPORTED_FORMAT: ImportRejection = {
  code: "unsupported-format",
  error: "only .epub, .md, .markdown or .pdf files are accepted",
};

// Extension predicates are disjoint, so registration order is only a
// reading order. Markdown's reader takes text rather than bytes, hence
// the one adapter.
const READERS: FormatReader[] = [
  {
    accepts: isEpubFilename,
    read: (content, filename) => readEpubBook(content, filename),
  },
  {
    accepts: isMarkdownFilename,
    read: async (content, filename) =>
      readMarkdownBook(filename, content.toString("utf8")),
  },
  { accepts: isPdfFilename, read: readPdfBook },
];

// The upload front half's whole interface: name + bytes in, PreparedBook
// or UploadRejected out.
export async function readUpload(
  filename: string,
  content: Buffer
): Promise<PreparedBook> {
  const reader = READERS.find((candidate) => candidate.accepts(filename));
  if (!reader) {
    throw new UploadRejected(UNSUPPORTED_FORMAT.code, UNSUPPORTED_FORMAT.error);
  }
  return reader.read(content, filename);
}
