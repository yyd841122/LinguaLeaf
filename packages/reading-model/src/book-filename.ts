// Download filename rules for the annotated book attachment — shared by
// both ends of the download: the server writes the Content-Disposition
// header, the web client re-checks whatever actually arrives in it. What
// is stripped is what no common filesystem accepts in a name; the Chinese
// title survives (it rides in the RFC 5987 filename* form Express
// generates).

// The one cleaning pass: control characters and filename punctuation
// become underscores, trailing dots and spaces go (Windows silently drops
// them on save), edges are trimmed. Returns "" for an empty or missing
// name — the callers own their fallbacks.
export function cleanFilenameBase(name: string | null): string {
  return (
    (name ?? "")
      // \p{Cc} covers the control characters no filesystem wants in a name
      // (written as the Unicode category — a literal \x00 range would trip
      // the no-control-regex rule).
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
      .replace(/[. ]+$/, "")
      .trim()
  );
}

// The server's attachment name from a book title: the cleaned base, the
// .html suffix always appended, "book" when nothing survives the cleaning.
export function annotatedBookFilename(title: string | null): string {
  const base = cleanFilenameBase(title);
  return `${base.length > 0 ? base : "book"}.html`;
}
