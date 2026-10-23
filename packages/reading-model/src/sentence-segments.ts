import { WORD_PATTERN } from "./word-pattern.js";

// One rendered unit of a sentence block's original line: a run of non-word
// text, or a word optionally carrying its IPA transcription. The rendering
// stays with each frontend (JSX in the app, escaped HTML strings in the
// export); what is shared is the walk and the pairing decision.
export type TextSegment = { kind: "text"; text: string };
export type WordSegment = { kind: "word"; word: string; ipa: string | null };
export type Segment = TextSegment | WordSegment;

// Walks the same word matches the import used to fill the IPA slots, pairing
// each word with its transcription. Slots pair only when their count equals
// the word count — books whose slots predate the pairing, or whose slots no
// longer match the words, come back unpaired with every transcription null:
// exactly the fallback both frontends render as the flat IPA line.
export function segmentOriginal(
  originalText: string,
  ipaSlots: string[] | null
): { paired: boolean; segments: Segment[] } {
  const matches = [...originalText.matchAll(WORD_PATTERN)];
  const paired = ipaSlots !== null && ipaSlots.length === matches.length;
  const segments: Segment[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? cursor;
    if (start > cursor) {
      segments.push({ kind: "text", text: originalText.slice(cursor, start) });
    }
    segments.push({
      kind: "word",
      word: match[0],
      ipa: paired ? (ipaSlots[index] ?? null) : null,
    });
    cursor = start + match[0].length;
  });
  segments.push({ kind: "text", text: originalText.slice(cursor) });
  return { paired, segments };
}
