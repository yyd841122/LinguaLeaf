// The lookup-key fold shared by every consumer that turns clicked or
// scanned text into a dictionary key: the server's importers and lookups,
// and the annotated book file's embedded-vocabulary popups. A divergent
// fold makes case and curly-quote variants silently miss the vocabulary.

// Import-time normalization: pure folding only — lower case, curly
// apostrophes, trimmed. No edge stripping: a source entry that only becomes
// a word after stripping ("3D" -> "d") must stay out of the dictionary.
export function normalizeToken(token: string): string {
  // .replace, not .replaceAll: the annotated book file compiles to an
  // es2017 target and esbuild does not polyfill ES2021 methods — an old
  // browser would throw on every word click (audit 2026-10-23).
  return token
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'");
}

// Lookup-time normalization for tokens that arrive as clicked text: the
// import fold, plus the punctuation clinging to the edges ("book,",
// "'book'"). Internal apostrophes and hyphens survive ("don't",
// "well-known").
// A folded token longer than this is not a word (the longest real English
// words sit near 45) — reading it as a miss bounds every consumer's work
// before normalization output reaches them (audit 2026-10-23).
export const MAX_LOOKUP_TOKEN_CHARS = 64;

export function normalizeLookupToken(token: string): string {
  // Linear edge walk, not the anchored-alternation regex: that pattern
  // degrades quadratically on long non-word runs, and uploaded book text
  // reaches this on the server's synchronous lookup path (audit 2026-10-23
  // — a 40k-char token cost ~4x the CPU of 20k).
  const folded = normalizeToken(token);
  if (folded.length > MAX_LOOKUP_TOKEN_CHARS) return "";
  const isWordChar = (ch: string | undefined): boolean =>
    ch !== undefined && /[a-z']/.test(ch);
  let start = 0;
  let end = folded.length;
  while (start < end && !isWordChar(folded[start])) start += 1;
  while (end > start && !isWordChar(folded[end - 1])) end -= 1;
  return folded.slice(start, end);
}
