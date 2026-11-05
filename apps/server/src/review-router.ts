import { Router } from "express";
import type Database from "better-sqlite3";
import { listReviewNotes } from "./book-store.js";
import type { ReviewNotesResponse } from "./wire.js";

export function createReviewRouter(database: Database.Database): Router {
  const router = Router();
  router.get("/notes", (_request, response) => {
    response.json({
      entries: listReviewNotes(database),
    } satisfies ReviewNotesResponse);
  });
  return router;
}
