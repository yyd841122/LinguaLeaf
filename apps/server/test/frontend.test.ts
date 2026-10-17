import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { attachFrontend } from "../src/frontend.js";

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
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("serves the built app, assets, chapter entry and API on one server", async () => {
    const app = createApp(database);
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
    });
    expect((await request(server).get("/api/missing")).status).toBe(404);
    expect((await request(server).get("/assets/missing.js")).status).toBe(404);
    expect((await request(server).post("/book/example/1")).status).toBe(404);
  });

  it("serves Vite HTML and the API through Express in development", async () => {
    const app = createApp(database);
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
      });
      expect((await request(server).get("/api/missing")).status).toBe(404);
    } finally {
      await closeFrontend();
    }
  });
});
