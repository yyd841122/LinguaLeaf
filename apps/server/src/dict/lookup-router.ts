import { Router } from "express";
import type { Dictionary } from "./dictionary.js";
import { lookupWord, vocabularyStateKey } from "./dictionary.js";
import type { WordStatus } from "../wire.js";

// The states store the lookup needs, injected at construction (grilling
// decision 3): this router holds no SQL and never sees the book database —
// the store owns word_states everywhere (vocab-store.ts, the sql-locality
// gate's owner for the table).
export type WordStatesStore = {
  // The lookup's one write-and-read: an unstated lemma enters as
  // 'learning' in the same request; an existing row (known/ignored
  // included) is untouched. Returns the status as the request leaves it.
  statusAfterLookup(lemma: string): WordStatus;
};

// The data source for the word-lookup popup (spec: 点词查详情): the token
// comes in as clicked — punctuation and case included — and the response
// carries the lemma, the American IPA, the part of speech, the Chinese
// translation, and the lemma's 生词本 status (ADR-0005): the one automatic
// migration (a hit's New→learning) is written server-side in this same
// request, so the frontend renders the state with zero logic of its own.
// A miss (404) writes nothing.
export function createLookupRouter(
  dictionary: Dictionary,
  wordStates: WordStatesStore
): Router {
  const router = Router();
  router.get("/:word", (request, response) => {
    const entry = lookupWord(dictionary, request.params.word);
    if (!entry) {
      response.status(404).json({ error: "word not found" });
      return;
    }
    // States key on the lemma (ADR-0005): any surface form of a word
    // lands on one row. The key rule lives once in dictionary.ts — the
    // chapter join reads states through the same function. entry.word is
    // lookupWord's folded form, the key's input.
    const status = wordStates.statusAfterLookup(
      vocabularyStateKey(dictionary, entry.word)
    );
    response.json({ ...entry, status });
  });
  return router;
}
