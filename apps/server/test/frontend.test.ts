import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

// Dictionaries opened per test, closed in afterEach (audit 2026-10-23).
const openDictionaries: ReturnType<typeof openDictionary>[] = [];
import { openDictionary } from "../src/dict/dictionary.js";
import { openDatabase } from "../src/database.js";
import { attachFrontend } from "../src/frontend.js";
import type { InlineConfig, Logger } from "vite";

// Vite's dependency scanner races this file's teardown: closing the dev
// server mid-scan kills the scanner, and the default logger prints the full
// benign esbuild stack on stderr for every run of this file. The test asserts
// HTTP behavior, not Vite logs, so the server created here runs silent; the
// real dev server (main.ts) keeps its logger.
vi.mock("vite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vite")>();
  const silentLogger: Logger = {
    info: () => {},
    warn: () => {},
    warnOnce: () => {},
    error: () => {},
    clearScreen: () => {},
    hasWarned: false,
    hasErrorLogged: () => false,
  };
  return {
    ...actual,
    createServer: (config?: InlineConfig) =>
      actual.createServer({ ...config, customLogger: silentLogger }),
  };
});

describe("frontend hosting through the HTTP API seam", () => {
  let projectRoot: string;
  let database: Database.Database;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "lingualeaf-http-"));
    database = openDatabase(":memory:");
    const publicDirectory = join(projectRoot, ".output/web");
    await mkdir(join(publicDirectory, "assets"), { recursive: true });
    await writeFile(
      join(publicDirectory, "index.html"),
      "<!doctype html><title>LinguaLeaf</title>"
    );
    await writeFile(
      join(publicDirectory, "assets/app.js"),
      'console.log("LinguaLeaf");'
    );
  });

  afterEach(async () => {
    database.close();
    for (const dictionary of openDictionaries.splice(0)) dictionary.close();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("serves the built app, assets, chapter entry and API on one server", async () => {
    const dictionary = openDictionary(":memory:");
    openDictionaries.push(dictionary);
    const app = createApp(database, dictionary);
    const server = createServer(app);
    await attachFrontend(app, server, {
      development: false,
      runtimeRoot: projectRoot,
    });

    for (const path of ["/", "/book/example/1"]) {
      const response = await request(server).get(path);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.text).toContain("<title>LinguaLeaf</title>");
    }
    const asset = await request(server).get("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.text).toContain('console.log("LinguaLeaf")');
    expect((await request(server).get("/api/health")).body).toEqual({
      status: "ok",
      lastPageSeenAt: null,
      activeTasks: 0,
    });
    expect((await request(server).get("/api/missing")).status).toBe(404);
    expect((await request(server).get("/assets/missing.js")).status).toBe(404);
    expect((await request(server).post("/book/example/1")).status).toBe(404);
  });

  it("serves Vite HTML and the API through Express in development", async () => {
    const dictionary = openDictionary(":memory:");
    openDictionaries.push(dictionary);
    const app = createApp(database, dictionary);
    const server = createServer(app);
    const closeFrontend = await attachFrontend(app, server, {
      development: true,
      runtimeRoot: fileURLToPath(new URL("../../../", import.meta.url)),
    });
    try {
      for (const path of ["/", "/book/example/1"]) {
        const response = await request(server).get(path);
        expect(response.status).toBe(200);
        expect(response.text).toContain("/@vite/client");
        expect(response.text).toContain("<title>LinguaLeaf</title>");
      }
      // /src/main.tsx is intentionally not requested here: fetching it starts
      // Vite's dependency optimizer, and closing the server mid-optimization
      // deadlocks inside Vitest workers (vite.close() never resolves). React
      // transformation is already covered by the component seam (reading.test.tsx).
      expect((await request(server).get("/api/health")).body).toEqual({
        status: "ok",
        lastPageSeenAt: null,
        activeTasks: 0,
      });
      expect((await request(server).get("/api/missing")).status).toBe(404);
    } finally {
      await closeFrontend();
    }
  });
});
