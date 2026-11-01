import { segmentOriginal } from "./sentence-segments.js";
import type { WordStatus } from "./word-lookup.js";

export type StatusApplied = {
  word: string;
  lemma: string | null;
  status: WordStatus;
};

// Only the fields the positional join needs; each host keeps its own block
// payload and any additional fields through the generic return type.
export type StatusJoinBlock = {
  kind: string;
  originalText: string;
  ipaSlots?: string[] | null;
  wordStatuses?: (WordStatus | null)[];
};

// wordStatuses follows the server's tokenizeWords order. Reconstruct that
// order with the same word segments the reader renders, even without IPA.
// Exact surface and lemma strings only: the client has no lemmatizer
// (popup-status-backedge spec, decision 2).
export function applyStatusToBlocks<B extends StatusJoinBlock>(
  blocks: readonly B[],
  applied: StatusApplied
): B[] {
  return blocks.map((block) => {
    if (block.kind !== "sentence" || !block.wordStatuses) return block;
    const words = segmentOriginal(
      block.originalText,
      block.ipaSlots ?? null
    ).segments.filter((segment) => segment.kind === "word");
    return {
      ...block,
      wordStatuses: block.wordStatuses.map((status, index) => {
        const word = words[index]?.word;
        return word === applied.word ||
          (applied.lemma !== null && word === applied.lemma)
          ? applied.status
          : status;
      }),
    };
  });
}
