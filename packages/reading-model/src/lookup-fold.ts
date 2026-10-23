// The lookup-key fold shared by every consumer that turns clicked or
// scanned text into a dictionary key: the server's importers and lookups,
// and the annotated book file's embedded-vocabulary popups. A divergent
// fold makes case and curly-quote variants silently miss the vocabulary.

// Import-time normalization: pure folding only — lower case, curly
// apostrophes, trimmed. No edge stripping: a source entry that only becomes
// a word after stripping ("3D" -> "d") must stay out of the dictionary.
export function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replaceAll("’", "'");
}

// Lookup-time normalization for tokens that arrive as clicked text: the
// import fold, plus the punctuation clinging to the edges ("book,",
// "'book'"). Internal apostrophes and hyphens survive ("don't",
// "well-known").
export function normalizeLookupToken(token: string): string {
  return normalizeToken(token).replace(/^[^a-z']+|[^a-z']+$/g, "");
}
