import { Router, json, type Request } from "express";
import type Database from "better-sqlite3";
import { normalizeLookupToken } from "@lingualeaf/reading-model";
import {
  WORD_STATUS_VALUES,
  clearWordState,
  setWordState,
} from "./vocab-store.js";
import type { WordStatus } from "./wire.js";

// The popup's status operations (ADR-0005): PUT sets the lemma's state
// idempotently — any state from any other state, the whole operation set
// the server expresses, no migration matrix — and DELETE returns it to
// New by removing the row. The path carries the lemma key the lookup
// response and the chapter payload already use: the frontend never
// lemmatizes (spec decision 3/5).
export function createVocabRouter(database: Database.Database): Router {
  const router = Router();

  // The runtime mirror of the schema CHECK, straight from the store's
  // value list.
  const isWordStatus = (value: unknown): value is WordStatus =>
    typeof value === "string" &&
    (WORD_STATUS_VALUES as readonly string[]).includes(value);

  // A path token that folds to nothing is just a word that is not there
  // (the book routes' non-integer-id precedent), not a bad request.
  const lemmaFromParams = (request: Request): string | null => {
    // A named non-repeat param is always one string on the wire; the
    // typeof guard satisfies Express 5's widened param typing, and a
    // non-string folds to the not-found empty.
    const raw = request.params.lemma;
    const lemma = normalizeLookupToken(typeof raw === "string" ? raw : "");
    return lemma || null;
  };

  router.put("/lemmas/:lemma", json(), (request, response) => {
    const lemma = lemmaFromParams(request);
    if (!lemma) {
      response.status(404).json({ error: "lemma not found" });
      return;
    }
    const body = request.body as { status?: unknown } | undefined;
    if (!isWordStatus(body?.status)) {
      response
        .status(400)
        .json({ error: "status must be learning, known, or ignored" });
      return;
    }
    setWordState(database, lemma, body.status);
    response.json({ lemma, status: body.status });
  });

  router.delete("/lemmas/:lemma", (request, response) => {
    const lemma = lemmaFromParams(request);
    if (!lemma) {
      response.status(404).json({ error: "lemma not found" });
      return;
    }
    clearWordState(database, lemma);
    response.status(204).end();
  });

  return router;
}
