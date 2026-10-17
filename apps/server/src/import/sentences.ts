import sbd from "sbd";

// Splits an English paragraph into sentences. sbd's abbreviation handling
// (Mr., e.g., U.S., ...) is why this is not Intl.Segmenter: ICU's rules in
// Node 24 split after "Mr." (no CLDR suppressions in the bundled data). This
// module is the seam where the strategy can be swapped without touching the
// import pipeline.
export function splitSentences(paragraph: string): string[] {
  return sbd
    .sentences(paragraph, { newline_boundaries: true })
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
