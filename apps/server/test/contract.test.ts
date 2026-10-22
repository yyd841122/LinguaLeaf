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
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { createFakeTranslator } from "./fixtures/translator.js";
import { waitForShelfBook } from "./fixtures/async-import.js";
import { createEncryptedPdf, createScannedPdf } from "./fixtures/pdf.js";
import { ApiError, fetchJson } from "../../../apps/web/src/api";
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
async function uploadBook(path: string): Promise<{ id: number }> {
  const bytes = await readFile(path);
  const form = new FormData();
  form.append(
    "file",
    new File([bytes], basename(path), { type: "text/markdown" })
  );
  return fetchJson<{ id: number }>("/api/books", {
    method: "POST",
    body: form,
  });
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
    await saveReadingProgress(id, { chapter: 2, block: 5 });
    const progress = await fetchReadingProgress(id);
    expect(progress).toEqual({ chapter: 2, block: 5 });
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
    releaseGate();
    await waitForShelfBook(app, created.id, "ready");
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
  it("rejects an unknown extension with the 415 copy", async () => {
    await startStack();
    const error = await uploadRejection(
      "notes.txt",
      Buffer.from("just some notes")
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(415);
    expect((error as ApiError).body).toEqual({
      error: "only .epub, .md, .markdown or .pdf files are accepted",
    });
  });

  it("rejects a scanned PDF with the 422 copy", async () => {
    await startStack();
    const error = await uploadRejection(
      "scanned.pdf",
      await createScannedPdf()
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).body).toEqual({
      error: "扫描件/图片型 PDF 暂不支持",
    });
  });

  it("rejects an encrypted PDF with the body the shelf machine-reads", async () => {
    await startStack();
    const error = await uploadRejection(
      "encrypted.pdf",
      await createEncryptedPdf()
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual({ error: "加密 PDF 暂不支持" });
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
  });

  it("rejects an over-limit upload with the 413 body", async () => {
    await startStack();
    // One byte past the server's 20MB multer limit — the content itself is
    // never parsed.
    const error = await uploadRejection(
      "big.pdf",
      Buffer.alloc(21 * 1024 * 1024)
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).body).toEqual({ error: "LIMIT_FILE_SIZE" });
  });
});
