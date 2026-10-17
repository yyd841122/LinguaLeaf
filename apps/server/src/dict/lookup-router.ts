import { Router } from "express";
import type { Dictionary } from "./dictionary.js";
import { lookupWord } from "./dictionary.js";

// The data source for the word-lookup popup (spec: 点词查详情): the token
// comes in as clicked — punctuation and case included — and the response
// carries the lemma, the American IPA, the part of speech, and the Chinese
// translation. Unknown words are a 404, not an empty 200.
export function createLookupRouter(dictionary: Dictionary): Router {
  const router = Router();
  router.get("/:word", (request, response) => {
    const entry = lookupWord(dictionary, request.params.word);
    if (!entry) {
      response.status(404).json({ error: "word not found" });
      return;
    }
    response.json(entry);
  });
  return router;
}
