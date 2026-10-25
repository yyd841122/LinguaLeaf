import { ApiError, fetchJson } from "./api";
import type { WordStatus } from "../../server/src/wire";
import type { WordLookup } from "@lingualeaf/reading-model";

// The entry shape and the pronunciation half are the reading model's shared
// vocabulary (packages/reading-model) — the exported file's popup folds,
// anchors, and speaks through the same code. Re-exported here so the popup
// and its tests keep one import site.
export type { WordLookup } from "@lingualeaf/reading-model";
export { speakWord } from "@lingualeaf/reading-model";

// The lookup response on the wire: the reading-model entry plus the
// lemma's 生词本 status (ADR-0005) — the server writes the auto-migration
// (a hit's New→learning) in the same request, so a found word always
// carries a concrete state.
export type WordLookupResponse = WordLookup & { status: WordStatus };

// A 404 reads as null — the word is simply not in the dictionary, which the
// popup reports as 未收录. Any other failure throws: a server hiccup must
// not masquerade as a missing word.
export async function fetchWordLookup(
  word: string
): Promise<WordLookupResponse | null> {
  try {
    return await fetchJson<WordLookupResponse>(
      `/api/lookup/${encodeURIComponent(word)}`
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

// The popup's explicit state set (ADR-0005): idempotent — any state from
// any other state is the whole operation set. The key is the lemma the
// lookup response carried (the frontend never lemmatizes). Throws on
// failure; the popup shows its own notice.
export async function putWordStatus(
  lemma: string,
  status: WordStatus
): Promise<void> {
  await fetchJson(`/api/vocab/lemmas/${encodeURIComponent(lemma)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
