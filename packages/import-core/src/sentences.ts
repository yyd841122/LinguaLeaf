import sbd from "sbd";

// Splits an English paragraph into sentences. sbd's abbreviation handling
// (Mr., e.g., U.S., ...) is why this is not Intl.Segmenter: ICU's rules in
// Node 24 split after "Mr." (no CLDR suppressions in the bundled data). This
// module is the seam where the strategy can be swapped without touching the
// import pipeline.
export function splitSentences(paragraph: string): string[] {
  // Newlines split first, sbd runs per piece without newline_boundaries:
  // sbd's boundary mode swaps newlines for a sentinel and eats punctuation
  // runs beside it ("Wait----" lost its dashes at the break) — audit
  // 2026-10-23. Same split points, honest text.
  return paragraph
    .split(/\r\n|\n|\r/)
    .flatMap((piece) => sbd.sentences(piece))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
