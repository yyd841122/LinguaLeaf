import express from "express";
import type Database from "better-sqlite3";
import type { Dictionary } from "./dict/dictionary.js";
import type { Translator } from "./translate/translator.js";
import { createBooksRouter } from "./books-router.js";
import { createLookupRouter } from "./dict/lookup-router.js";

// The translator is the import pipeline's optional annotation source: like
// the dictionary, absent means imports complete with the annotation line
// empty (translation here, IPA there).
export function createApp(
  database: Database.Database,
  dictionary: Dictionary,
  translator?: Translator | null
) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_request, response) => {
    database.prepare("SELECT 1").get();
    response.json({ status: "ok" });
  });

  app.use("/api/books", createBooksRouter(database, dictionary, translator));

  app.use("/api/lookup", createLookupRouter(dictionary));

  // Keep unknown API requests out of the frontend's SPA fallback.
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found" });
  });

  return app;
}
