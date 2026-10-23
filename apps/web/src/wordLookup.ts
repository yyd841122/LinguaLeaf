import { ApiError, fetchJson } from "./api";
import type { WordLookup } from "@lingualeaf/reading-model";

// The entry shape and the pronunciation half are the reading model's shared
// vocabulary (packages/reading-model) — the exported file's popup folds,
// anchors, and speaks through the same code. Re-exported here so the popup
// and its tests keep one import site.
export type { WordLookup } from "@lingualeaf/reading-model";
export { speakWord } from "@lingualeaf/reading-model";

// A 404 reads as null — the word is simply not in the dictionary, which the
// popup reports as 未收录. Any other failure throws: a server hiccup must
// not masquerade as a missing word.
export async function fetchWordLookup(
  word: string
): Promise<WordLookup | null> {
  try {
    return await fetchJson<WordLookup>(
      `/api/lookup/${encodeURIComponent(word)}`
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
