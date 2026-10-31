import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type Database from "better-sqlite3";
import type { Dictionary } from "./dict/dictionary.js";
import type { Translator } from "./translate/translator.js";
import { createBooksRouter } from "./books-router.js";
import { createLookupRouter } from "./dict/lookup-router.js";
import { createVocabRouter } from "./vocab-router.js";
import { learnWordIfAbsent } from "./vocab-store.js";
import { activeTaskCount } from "./task-lifecycle.js";

// The translator is the chapter route's optional network source (ADR-0004):
// absent means the 翻译本章 trigger answers 409 until a key is configured.
// It is deliberately NOT handed to the import task — imports stopped
// translating in on-demand-translation ticket 02.
export function createApp(
  database: Database.Database,
  dictionary: Dictionary,
  translator?: Translator | null
) {
  const app = express();
  app.disable("x-powered-by");

  // A local single-user reader: mutating requests from a foreign Origin get
  // no path (a drive-by page could otherwise POST books or flip progress).
  // Same-origin (Origin host === Host header) and headerless tooling (curl,
  // supertest, same-origin GET) pass untouched; ALLOWED_ORIGINS (comma-
  // separated) admits deliberate extra origins.
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (mutating && typeof origin === "string") {
      let trusted = allowedOrigins.has(origin);
      if (!trusted) {
        try {
          const host = request.headers.host ?? "";
          trusted = new URL(origin).host === host;
        } catch {
          trusted = false;
        }
      }
      if (!trusted) {
        response.status(403).json({ error: "cross-origin request rejected" });
        return;
      }
    }
    next();
  });

  // The launcher watchdog's page-presence signal (plan.md T4 修订): every
  // open reader page heartbeats, and the watchdog stops the server only
  // after the idle limit passes with no heartbeat and no background task.
  // The timestamp is in-memory — after a restart it reads "no page yet".
  let lastPageSeenAt: string | null = null;
  app.post("/api/heartbeat", (_request, response) => {
    lastPageSeenAt = new Date().toISOString();
    response.status(204).end();
  });

  app.get("/api/health", (_request, response) => {
    database.prepare("SELECT 1").get();
    response.json({
      status: "ok",
      lastPageSeenAt,
      activeTasks: activeTaskCount(),
    });
  });

  app.use("/api/books", createBooksRouter(database, dictionary, translator));

  // The popup's explicit state operations (ADR-0005).
  app.use("/api/vocab", createVocabRouter(database));

  // The lookup's states store is assembled here, where the book database
  // lives (grilling decision 3): the router itself stays SQL-free.
  app.use(
    "/api/lookup",
    createLookupRouter(dictionary, {
      statusAfterLookup: (lemma) => learnWordIfAbsent(database, lemma),
    })
  );

  // Keep unknown API requests out of the frontend's SPA fallback.
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found" });
  });

  // One JSON envelope for anything a handler throws: details land in the
  // server log, the client gets a bare 500 body — Express's default error
  // page prints stack traces when NODE_ENV is unset.
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction
    ) => {
      console.error(error);
      if (response.headersSent) {
        next(error);
        return;
      }
      response.status(500).json({ error: "internal server error" });
    }
  );

  return app;
}
