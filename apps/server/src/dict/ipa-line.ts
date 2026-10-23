import type { Dictionary } from "./dictionary.js";
import { resolveIpa } from "./dictionary.js";
import { WORD_PATTERN } from "@lingualeaf/reading-model";

// The word rule itself is the reading model's WORD_PATTERN: the import's
// slots are filled in its match order, and both reading frontends walk the
// same matches.
export function tokenizeWords(sentence: string): string[] {
  return sentence.match(WORD_PATTERN) ?? [];
}

// One IPA slot per word token, in token order; a word no source knows
// leaves its slot as an empty string. This array is the word-pairing source
// of truth — the flat line cannot be re-split reliably because IPA
// transcriptions may contain spaces themselves (USA: "ˌjuː es ˈeɪ").
export function buildIpaSlots(
  dictionary: Dictionary,
  sentence: string
): string[] {
  return tokenizeWords(sentence).map(
    (word) => resolveIpa(dictionary, word) ?? ""
  );
}

// The flat IPA line: slots joined with single spaces. A word no source knows
// leaves its slot empty — middle slots keep the two-space gap so each
// transcription stays tied to its word (HTML collapses the gap visually);
// leading and trailing empties are trimmed away.
export function buildIpaLine(dictionary: Dictionary, sentence: string): string {
  return buildIpaSlots(dictionary, sentence).join(" ").trim();
}
