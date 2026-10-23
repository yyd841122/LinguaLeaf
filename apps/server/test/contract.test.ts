import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";
import { Blob, File } from "node:buffer";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { createImportingBook, setImportProgress } from "../src/book-store.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { createFakeTranslator } from "./fixtures/translator.js";
import { waitForShelfBook } from "./fixtures/async-import.js";
import { createEncryptedPdf, createScannedPdf } from "./fixtures/pdf.js";
import { buildEpub } from "./fixtures/epub.js";
import { ApiError, fetchJson } from "../../../apps/web/src/api";
import { IMPORT_STAGE_LABELS } from "../../../apps/web/src/importCopy";
import { fetchWordLookup } from "../../../apps/web/src/wordLookup";
import {
  fetchReadingProgress,
  saveReadingProgress,
} from "../../../apps/web/src/readingProgress";
import { downloadAttachment } from "../../../apps/web/src/download";

// The tier seam's test surface: the real web fetch clients (apps/web/src)
// driving the real Express app over a real socket. This is the executable
// pin behind CODING_STANDARDS.md's "Client calls match real response shapes"
// — statuses, body presence (204!), header shapes, error families — where
// both sides of the seam actually meet.
//
// Mechanics:
// - globalThis.fetch is wrapped to resolve the clients' relative URLs
//   against the test server's base. Production's adapter for that job is
//   the browser; this wrapper is the test adapter — two adapters make the
//   seam real.
// - downloadAttachment's browser half (object URL store + anchor click) is
//   a stub; everything else — headers, bytes, statuses — is real wire.
// - This file is excluded from tsc (web sources use Bundler-style
//   extensionless imports NodeNext cannot follow); the vitest gate owns it.

const sampleBookPath = fileURLToPath(
  new URL("./fixtures/sample-book.md", import.meta.url)
);
const chineseTitleBookPath = fileURLToPath(
  new URL("./fixtures/chinese-title-book.md", import.meta.url)
);

type Stack = {
  app: Express;
  database: Database.Database;
  dictionary: ReturnType<typeof createFixtureDictionary>;
  server: Server;
};

let stack: Stack | undefined;
let realFetch: typeof globalThis.fetch;
let savedCreateObjectURL: typeof URL.createObjectURL | undefined;
let savedRevokeObjectURL: typeof URL.revokeObjectURL | undefined;
let createObjectURLMock: ReturnType<typeof vi.fn>;

// One stack per test: fresh database, fixture dictionary, and a real
// listening socket the clients' fetch reaches through the resolving
// adapter installed below.
async function startStack(
  options: {
    translate?: (sentences: string[]) => Promise<(string | null)[]>;
  } = {}
): Promise<Stack> {
  const database = openDatabase(":memory:");
  const dictionary = createFixtureDictionary();
  const translator = options.translate
    ? createFakeTranslator(options.translate)
    : undefined;
  const app = createApp(database, dictionary, translator ?? null);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(
      new URL(String(input), `http://127.0.0.1:${port}`),
      init
    )) as typeof globalThis.fetch;
  stack = { app, database, dictionary, server };
  return stack;
}

// The upload client path exactly as BookshelfPage runs it: fetchJson with
// a FormData body carrying one File.
async function uploadBookBytes(
  bytes: Buffer,
  filename: string,
  type: string
): Promise<{ id: number } & Record<string, unknown>> {
  const form = new FormData();
  form.append("file", new File([bytes], filename, { type }));
  return fetchJson<{ id: number } & Record<string, unknown>>("/api/books", {
    method: "POST",
    body: form,
  });
}

async function uploadBook(
  path: string
): Promise<{ id: number } & Record<string, unknown>> {
  return uploadBookBytes(await readFile(path), basename(path), "text/markdown");
}

async function uploadReadyBook(path: string): Promise<number> {
  const created = await uploadBook(path);
  await waitForShelfBook(stack!.app, created.id, "ready");
  return created.id;
}

// The rejection half of the upload seam: every error family comes back as
// one ApiError the shelf can branch on.
async function uploadRejection(
  filename: string,
  bytes: Buffer
): Promise<unknown> {
  const form = new FormData();
  form.append("file", new File([bytes], filename));
  return fetchJson("/api/books", { method: "POST", body: form }).then(
    () => null,
    (error) => error
  );
}

// Stub for downloadAttachment's browser half: an object-URL store that
// records the blob, and an anchor factory that records what the client
// named the download. Everything the stub touches is DOM; nothing it
// touches is the wire.
function installBrowserHalf(): {
  clicked: { download: string; href: string }[];
} {
  savedCreateObjectURL = URL.createObjectURL;
  savedRevokeObjectURL = URL.revokeObjectURL;
  createObjectURLMock = vi.fn(() => "blob:contract");
  URL.createObjectURL =
    createObjectURLMock as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  const clicked: { download: string; href: string }[] = [];
  (globalThis as { document?: unknown }).document = {
    body: { appendChild: (element: unknown) => element },
    createElement: () => {
      const anchor = {
        href: "",
        download: "",
        click() {
          clicked.push({ download: anchor.download, href: anchor.href });
        },
        remove() {},
      };
      return anchor;
    },
  };
  return { clicked };
}

beforeEach(() => {
  createObjectURLMock = vi.fn();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  Reflect.deleteProperty(globalThis, "document");
  if (savedCreateObjectURL) {
    URL.createObjectURL = savedCreateObjectURL;
    URL.revokeObjectURL = savedRevokeObjectURL!;
    savedCreateObjectURL = undefined;
    savedRevokeObjectURL = undefined;
  }
  if (stack) {
    const { server, database, dictionary } = stack;
    stack = undefined;
    // closeAllConnections drops undici's keep-alive sockets so close
    // settles immediately.
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    server.closeAllConnections();
    database.close();
    dictionary.close();
  }
});

describe("fetchJson over the real server (api.ts)", () => {
  it("reads the shelf envelope a fresh server returns", async () => {
    await startStack();
    const shelf = await fetchJson<{ books: unknown[] }>("/api/books");
    expect(shelf).toEqual({ books: [] });
  });

  it("carries the ready book's shelf fields the web reads", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const shelf = await fetchJson<{
      books: Array<Record<string, unknown>>;
    }>("/api/books");
    expect(shelf.books[0]).toMatchObject({
      id,
      title: "The Way of the Test",
      status: "ready",
      progress: null,
    });
  });

  it("reads a 204 delete as success with no body", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const deleted = await fetchJson(`/api/books/${id}`, { method: "DELETE" });
    expect(deleted).toBeUndefined();
    const shelf = await fetchJson<{ books: unknown[] }>("/api/books");
    expect(shelf.books).toEqual([]);
  });

  it("surfaces a JSON error body on the ApiError", async () => {
    await startStack();
    const error = await fetchJson("/api/books/9999").then(
      () => null,
      (caught) => caught
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).body).toEqual({ error: "book not found" });
  });
});

describe("fetchWordLookup over the real server (wordLookup.ts)", () => {
  it("returns the lookup entry's full shape for a known word", async () => {
    await startStack();
    const entry = await fetchWordLookup("book");
    expect(entry).toEqual({
      word: "book",
      lemma: null,
      ipa: "bʊk",
      pos: "n. v.",
      translation: "n. 书, 簿, 账册\nv. 预订, 登记",
    });
  });

  it("resolves an inflected form to its lemma's entry", async () => {
    await startStack();
    const entry = await fetchWordLookup("wrote");
    expect(entry).toMatchObject({ word: "wrote", lemma: "write" });
  });

  it("reaches apostrophe entries from the curly surface form", async () => {
    await startStack();
    const entry = await fetchWordLookup("don’t");
    expect(entry).toMatchObject({ word: "don't", ipa: "doʊnt" });
  });

  it("reads a 404 as null — the word is simply not in the dictionary", async () => {
    await startStack();
    const entry = await fetchWordLookup("iguana");
    expect(entry).toBeNull();
  });

  it("throws a server hiccup — a 500 must not read as the word being missing", async () => {
    await startStack();
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // A real break, not a mocked fetch: the closed SQLite handle makes the
    // next lookup throw into the error middleware's 500 JSON envelope.
    // The instance's close is stubbed so the shared afterEach's second
    // close stays a no-op.
    stack!.dictionary.close();
    (stack!.dictionary as { close: () => void }).close = () => {};
    try {
      await expect(fetchWordLookup("book")).rejects.toMatchObject({
        status: 500,
        body: { error: "internal server error" },
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("reading progress over the real server (readingProgress.ts)", () => {
  it("reads an unread ready book as null (404)", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const progress = await fetchReadingProgress(id);
    expect(progress).toBeNull();
  });

  it("round-trips a save through PUT and GET", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    // A position the book actually has: chapter 2 (Red) holds 4 blocks.
    await saveReadingProgress(id, { chapter: 2, block: 4 });
    const progress = await fetchReadingProgress(id);
    expect(progress).toEqual({ chapter: 2, block: 4 });
  });

  it("surfaces the invalid-position 400 with its body", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const error = await fetchJson(`/api/books/${id}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: 0, block: 0 }),
    }).then(
      () => null,
      (caught) => caught
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({
      error: "chapter and block must be positive integers",
    });
  });

  it("keeps an importing book's reading routes at 409, not 404", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { app } = await startStack({
      translate: async (sentences) => {
        await gate;
        return sentences.map(() => null);
      },
    });
    const created = await uploadBook(sampleBookPath);
    // The book sits in 'importing' until the gate opens, so the 409 is
    // deterministic: reading routes answer only settled books.
    await expect(fetchReadingProgress(created.id)).rejects.toMatchObject({
      status: 409,
    });
    // The rest of the guarded family: chapter content through fetchJson,
    // the export through downloadAttachment's catchable failure (its !ok
    // path throws before any DOM work).
    await expect(
      fetchJson(`/api/books/${created.id}/chapters/1`)
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      downloadAttachment(`/api/books/${created.id}/export`)
    ).rejects.toMatchObject({ status: 409 });
    // The TOC route carries no not-ready guard — it answers the importing
    // row with an empty chapter list. Pinned, not endorsed: this is the
    // test that flips if the TOC joins respondIfNotReady.
    const importing = await fetchJson<{ chapters: unknown[] }>(
      `/api/books/${created.id}`
    );
    expect(importing).toMatchObject({
      id: created.id,
      status: "importing",
      chapters: [],
    });
    releaseGate();
    await waitForShelfBook(app, created.id, "ready");
  });
});

describe("the reading page's fetches over the real server (ReadingPage.tsx)", () => {
  it("delivers the table of contents in the shape the web's TOC type declares", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const toc = await fetchJson<{
      id: number;
      title: string;
      chapters: { position: number; title: string; level: number | null }[];
    }>(`/api/books/${id}`);
    expect(toc.id).toBe(id);
    expect(toc.title).toBe("The Way of the Test");
    expect(toc.chapters).toHaveLength(5);
    // One entry at its exact key set: whatever else the route grows is the
    // shelf's business — the reading page reads position, title, level.
    expect(toc.chapters[3]).toEqual({
      position: 4,
      title: "Interlude: The Command",
      level: 3,
    });
  });

  it("delivers chapter blocks as the Block union the reader switches on", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const red = await fetchJson<{
      position: number;
      title: string;
      blocks: Array<Record<string, unknown>>;
    }>(`/api/books/${id}/chapters/2`);
    expect(red.position).toBe(2);
    expect(red.title).toBe("Chapter One: Red");
    // Sentence arm: the annotation lines arrive decoded — ipaSlots an
    // array (not the column's JSON text), the untranslated line null.
    expect(red.blocks[0]).toEqual({
      position: 1,
      kind: "sentence",
      originalText: "Mr. Gupta woke early.",
      ipaSlots: expect.any(Array),
      ipaText: expect.any(String),
      translationText: null,
    });
    // Passthrough arms (the interlude chapter) carry exactly the three
    // keys — no annotation fields.
    const interlude = await fetchJson<{
      blocks: Array<Record<string, unknown>>;
    }>(`/api/books/${id}/chapters/4`);
    expect(interlude.blocks[1]).toEqual({
      position: 2,
      kind: "code",
      originalText: "npm test -- --filter core",
    });
    expect(interlude.blocks[2]).toEqual({
      position: 3,
      kind: "raw",
      originalText: "Reading more: the official handbook. It is free.",
    });
  });

  it("reads a heading-only chapter as an empty block list and an out-of-range one as a 404", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    const green = await fetchJson<{ blocks: unknown[] }>(
      `/api/books/${id}/chapters/3`
    );
    expect(green.blocks).toEqual([]);
    await expect(
      fetchJson(`/api/books/${id}/chapters/99`)
    ).rejects.toMatchObject({
      status: 404,
      body: { error: "chapter not found" },
    });
  });

  it("delivers an image block's placeholder shape from an EPUB upload", async () => {
    await startStack();
    const epub = await buildEpub({
      title: "Seam Image Book",
      docs: [
        {
          href: "text/one.xhtml",
          body: "<h1>One</h1><p>Before the picture.</p><img src='pix.png' alt='A red dot'/>",
        },
      ],
      images: [{ href: "pix.png" }],
    });
    const created = await uploadBookBytes(
      epub,
      "seam-image-book.epub",
      "application/epub+zip"
    );
    await waitForShelfBook(stack!.app, created.id, "ready");
    const chapter = await fetchJson<{
      blocks: Array<Record<string, unknown>>;
    }>(`/api/books/${created.id}/chapters/1`);
    expect(chapter.blocks).toHaveLength(2);
    expect(chapter.blocks[1]).toEqual({
      position: 2,
      kind: "image",
      originalText: "A red dot",
    });
  });
});

describe("downloadAttachment over the real server (download.ts)", () => {
  let clicked: { download: string; href: string }[];

  beforeEach(() => {
    clicked = installBrowserHalf().clicked;
  });

  it("names a Chinese-title download from the filename* header", async () => {
    await startStack();
    const id = await uploadReadyBook(chineseTitleBookPath);
    await downloadAttachment(`/api/books/${id}/export`);
    // "三体: 黑暗森林" — the colon is sanitized server-side, the rest
    // survives the RFC 5987 round-trip the client decodes.
    expect(clicked[0]?.download).toBe("三体_ 黑暗森林.html");
    expect(clicked[0]?.href).toBe("blob:contract");
    const blob = createObjectURLMock.mock.calls[0]?.[0] as Blob;
    expect(blob.size).toBeGreaterThan(0);
  });

  it("names an ASCII-title download from the plain quoted header", async () => {
    await startStack();
    const id = await uploadReadyBook(sampleBookPath);
    await downloadAttachment(`/api/books/${id}/export`);
    expect(clicked[0]?.download).toBe("The Way of the Test.html");
  });

  it("throws a catchable failure for a missing book (404)", async () => {
    await startStack();
    await expect(
      downloadAttachment("/api/books/9999/export")
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("upload rejections through the real client path (fetchJson + FormData)", () => {
  // Every rejection body carries a stable machine code beside the prose
  // (apps/server/src/wire.ts) — these pins are the executable half of the
  // shelf's copy map (apps/web/src/importCopy.ts).
  it("pins the 202 body the shelf prepends as a book row", async () => {
    await startStack();
    // BookshelfPage prepends this body straight into the shelf list, so the
    // fields it renders ride the wire contract (CODING_STANDARDS: extend
    // the suite in the same change as a new consumer — audit 2026-10-23).
    // No translator configured: the whole task runs inside the POST, so the
    // row answers settled.
    const created = await uploadBook(sampleBookPath);
    expect(created).toMatchObject({
      title: expect.any(String),
      format: "markdown",
      status: "ready",
      importStage: null,
      importPercent: null,
      importError: null,
      createdAt: expect.any(String),
      pageCount: null,
    });
  });

  it("rejects an unknown extension with the 415 copy", async () => {
    await startStack();
    const error = await uploadRejection(
      "notes.txt",
      Buffer.from("just some notes")
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(415);
    expect((error as ApiError).body).toEqual({
      code: "unsupported-format",
      error: "only .epub, .md, .markdown or .pdf files are accepted",
    });
  });

  it("rejects a scanned PDF with the 422 scan code", async () => {
    await startStack();
    const error = await uploadRejection(
      "scanned.pdf",
      await createScannedPdf()
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).body).toEqual({
      code: "scanned-pdf",
      error: "扫描件/图片型 PDF 暂不支持",
    });
  });

  it("rejects an encrypted PDF with its stable code — the shelf keys on the code, not the 文案", async () => {
    await startStack();
    const error = await uploadRejection(
      "encrypted.pdf",
      await createEncryptedPdf()
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({
      code: "encrypted-pdf",
      error: "加密 PDF 暂不支持",
    });
  });

  it("rejects a broken EPUB with the invalid-copy 400", async () => {
    await startStack();
    const error = await uploadRejection(
      "broken.epub",
      Buffer.from("this is not a zip archive")
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect(String((error as ApiError).body?.error)).toMatch(/^invalid EPUB/);
    expect((error as ApiError).body?.code).toBe("invalid-epub");
  });

  it("rejects a broken PDF with the invalid-copy 400", async () => {
    await startStack();
    const error = await uploadRejection(
      "broken.pdf",
      Buffer.from("this is not a pdf")
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect(String((error as ApiError).body?.error)).toMatch(/^invalid PDF/);
    expect((error as ApiError).body?.code).toBe("invalid-pdf");
  });

  it("rejects an over-limit upload with the file-too-large code", async () => {
    await startStack();
    // One byte past the server's 20MB multer limit — the content itself is
    // never parsed.
    const error = await uploadRejection(
      "big.pdf",
      Buffer.alloc(21 * 1024 * 1024)
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).body).toEqual({
      code: "file-too-large",
      error: "uploaded file exceeds the 20 MB limit",
    });
  });

  it("echoes an uncoded multer reject as the bare 400 body", async () => {
    await startStack();
    const form = new FormData();
    // A wrong multipart field name is multer's LIMIT_UNEXPECTED_FILE — the
    // one reachable path into the uncoded else-branch. Pinned, not
    // endorsed: this is the test that flips when the echo gains a wire
    // code.
    form.append("document", new File([Buffer.from("bytes")], "book.md"));
    const error = await fetchJson("/api/books", {
      method: "POST",
      body: form,
    }).then(
      () => null,
      (caught) => caught
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({
      error: "LIMIT_UNEXPECTED_FILE",
    });
  });
});

describe("the shelf labels every stage the wire can carry (importCopy.ts)", () => {
  it("carries each store-written stage through the shelf with a non-empty label", async () => {
    const { database } = await startStack();
    // The store is the authority for what the wire can carry: write every
    // stage through it, then read the shelf back through the same client
    // path the component polls. The literals below are checked against the
    // shared union by setImportProgress's parameter type; the exhaustive
    // Record<ImportStage, string> in importCopy.ts is the compile half of
    // this pin.
    const bookId = createImportingBook(
      database,
      "Stage Label Pin",
      "markdown",
      null
    );
    for (const stage of ["annotating", "translating", "saving"] as const) {
      setImportProgress(database, bookId, stage, null);
      const shelf = await fetchJson<{
        books: Array<{ id: number; importStage: string | null }>;
      }>("/api/books");
      const row = shelf.books.find((book) => book.id === bookId);
      expect(row, `stage ${stage} missing from the shelf`).toBeDefined();
      expect(row!.importStage).toBe(stage);
      expect(Object.keys(IMPORT_STAGE_LABELS)).toContain(stage);
      expect(IMPORT_STAGE_LABELS[stage]).not.toBe("");
    }
  });
});
