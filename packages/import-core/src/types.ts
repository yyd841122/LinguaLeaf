import type { ExtractedChapter } from "./extract-html.js";

// What the format-specific front halves hand to the shared import: extracted
// chapters plus the book title. Everything past this type — sentence
// splitting, IPA slots — is one pure path (the annotation pass itself stays
// with its dictionary: the server's pipeline.ts, the extension's offline
// dictionary).
export type BookFormat = "markdown" | "epub" | "pdf";

export type PreparedBook = {
  title: string;
  format: BookFormat;
  chapters: ExtractedChapter[];
  // PDF fact (the shelf's long-book hint rides on it); the other front
  // halves leave it unset.
  pageCount?: number;
};
