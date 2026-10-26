import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { JSDOM } from "jsdom";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { normalizeLookupToken } from "../src/dict/dictionary.js";
import {
  createImportingBook,
  findChapterRow,
  listChapters,
  listSentenceBlocks,
  persistBook,
  saveSentenceTranslations,
  settleImport,
} from "../src/book-store.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { waitForShelfBook } from "./fixtures/async-import.js";

const sampleBookPath = fileURLToPath(
  new URL("./fixtures/sample-book.md", import.meta.url)
);

const lookupBookPath = fileURLToPath(
  new URL("./fixtures/lookup-book.md", import.meta.url)
);

// Find a rendered word by getAttribute and click it. Selection must read
// the attribute, not use an attribute selector: jsdom's selector engine
// folds attribute-value case, so [data-word="Books"] can return the
// "books" span — the runtime itself reads data-word case-sensitively.
function clickWord(document: Document, word: string): void {
  const target = [...document.querySelectorAll("[data-word]")].find(
    (element) => element.getAttribute("data-word") === word
  ) as HTMLElement | undefined;
  expect(target, `no rendered word: ${word}`).not.toBeUndefined();
  target?.click();
}

// Shared by every export describe: a book on the shelf through the real
// upload seam. Translations are no longer an import concern (ticket 02) —
// tests that need lines write them through the store, the same seam the
// chapter translation task uses (writeTranslations below).
// Every dictionary createExportApp opens, closed in each describe's
// afterEach — discarded handles leaked WAL files past the test run (audit
// 2026-10-23).
const openDictionaries: ReturnType<typeof createFixtureDictionary>[] = [];

function createExportApp(
  database: Database.Database,
  prepareDictionary?: (
    dictionary: ReturnType<typeof createFixtureDictionary>
  ) => void
) {
  const dictionary = createFixtureDictionary();
  openDictionaries.push(dictionary);
  prepareDictionary?.(dictionary);
  return createApp(database, dictionary);
}

// Lands translation rows through the chapter task's own write path: every
// sentence the map translates (null otherwise) gets its row, so export
// tests shape exactly which lines exist without dragging the import
// pipeline back into the translation business.
function writeTranslations(
  database: Database.Database,
  bookId: number,
  translate: (sentence: string) => string | null
): void {
  for (const head of listChapters(database, bookId)) {
    const chapter = findChapterRow(database, bookId, head.position);
    if (!chapter) continue;
    saveSentenceTranslations(
      database,
      listSentenceBlocks(database, chapter.id).map((block) => ({
        id: block.id,
        translation: translate(block.text),
      }))
    );
  }
}

async function importSampleBookReady(
  app: Express,
  path: string = sampleBookPath
): Promise<number> {
  const created = await request(app).post("/api/books").attach("file", path);
  expect(created.status).toBe(202);
  await waitForShelfBook(app, created.body.id, "ready");
  return created.body.id as number;
}

// A reader's text flow: the exported document's body text with the IPA
// annotation layer stripped (transcriptions ride inside the word units, so
// raw textContent interleaves them with the words). Shared by every test
// that asserts on prose; the caller owns closing the returned DOM.
function textFlow(html: string): { dom: JSDOM; flow: string } {
  const dom = new JSDOM(html);
  dom.window.document
    .querySelectorAll(".ipa-word-ipa")
    .forEach((ipa) => ipa.remove());
  return { dom, flow: dom.window.document.body.textContent ?? "" };
}

describe("GET /api/books/:id/export", () => {
  let database: Database.Database;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    app = createExportApp(database);
  });
  afterEach(() => {
    database.close();
    for (const dictionary of openDictionaries.splice(0)) dictionary.close();
  });

  it("returns the annotated book as a downloadable HTML attachment", async () => {
    const bookId = await importSampleBookReady(app);

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-disposition"]).toContain("attachment");
    // An ASCII title rides in the plain quoted form.
    expect(response.headers["content-disposition"]).toContain(
      'filename="The Way of the Test.html"'
    );
    expect(response.text).toContain("The Way of the Test");
  });

  it("pairs each word with its IPA slot and omits translation lines for untranslated sentences", async () => {
    const translated = new Map([
      ["He wrote a failing test first.", "他先写了失败的测试。"],
    ]);
    const bookId = await importSampleBookReady(app);
    writeTranslations(
      database,
      bookId,
      (sentence) => translated.get(sentence) ?? null
    );

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    const html = response.text;

    // Word-paired form: the surface form rides on data-word, word and IPA
    // stacked inside the unit (mirrors the app's .ipa-word structure).
    expect(html).toContain('<span class="ipa-word" data-word="wrote">');
    expect(html).toContain('<span class="ipa-word-text">wrote</span>');
    // The transcription is a data attribute (selection/copy proof via
    // ::before), not a text child.
    expect(html).toContain(
      '<span class="ipa-word-ipa" data-ipa="roʊt"></span>'
    );
    // Words the dictionary does not know stay plain text inside the line.
    expect(html).toContain(
      '<span class="lookup-word" data-word="Gupta">Gupta</span>'
    );

    // Exactly the translated sentence carries a translation line; the
    // rest are omitted rather than rendered empty (spec: 译文缺失省略译文行).
    expect(html).toContain("他先写了失败的测试。");
    expect(html.match(/class="translation-line"/g)).toHaveLength(1);

    // A heading-only chapter still renders its section, with no blocks
    // under it (the LEFT JOIN's null-block rows are skipped).
    expect(html).toContain(
      '<h2 class="chapter-title">Chapter Two: Green</h2><div class="blocks"></div>'
    );
  });

  it("omits every translation line when the book is entirely untranslated", async () => {
    // The whole-chapter-zero case (on-demand-translation ticket 03): since
    // ticket 02 a fresh import rests at untranslated, so the book exports
    // exactly as imported — no writeTranslations call, not one
    // translation-line element anywhere, every sentence block still
    // rendered. Pinned status quo (ADR-0004: no "translate before export"
    // gate); the test that flips is the one that deliberately adds such a
    // line to the untranslated export.
    const bookId = await importSampleBookReady(app);

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    expect(response.text.match(/class="translation-line"/g)).toBeNull();
    // The blocks themselves are all there (sentence blocks render their
    // word units as always), and the file's 译文行 toggle ships untouched —
    // the omission is per-missing-line, not a hidden control.
    expect(response.text).toContain(
      '<span class="lookup-word" data-word="Gupta">'
    );
    expect(response.text).toContain('data-annotation="translation"');
  });

  it("embeds the book's sentence-block vocabulary, folded and deduplicated, with lookup results or null", async () => {
    const bookId = await importSampleBookReady(app);

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    const dom = new JSDOM(response.text);
    const document = dom.window.document;
    const vocabTag = document.getElementById("annotated-vocab");
    expect(vocabTag?.getAttribute("type")).toBe("application/json");
    const vocab = JSON.parse(vocabTag?.textContent ?? "null") as Record<
      string,
      unknown
    >;

    // The key set is exactly the book's sentence-block vocabulary under the
    // lookup-time fold: every rendered word token is covered once, nothing
    // else rides along — the fixture dictionary's zebra/go are not in this
    // book and must not leak in (spec: 只嵌本书词汇，不整库内嵌).
    const rendered = new Set(
      [...document.querySelectorAll("[data-word]")].map((word) =>
        normalizeLookupToken(word.getAttribute("data-word") ?? "")
      )
    );
    expect([...rendered]).not.toContain("");
    expect(Object.keys(vocab).sort()).toEqual([...rendered].sort());
    expect(Object.keys(vocab)).toContain("the"); // "The" and "the" fold to one key
    expect(Object.keys(vocab)).not.toContain("zebra");
    expect(Object.keys(vocab)).not.toContain("go");

    // Values ride the server's own lookup contract: a hit carries the
    // lemma's senses with the surface form's own IPA; a miss embeds null
    // so the popup can say "not found" explicitly (spec: 查不到的词也内嵌 null).
    expect(vocab.wrote).toEqual({
      word: "wrote",
      lemma: "write",
      ipa: "roʊt",
      pos: "v.",
      translation: "v. 写, 作曲, 写信",
    });
    expect(vocab.gupta).toBeNull();
    expect(vocab.the).toBeNull();
    dom.window.close();
  });

  it("answers 404 for books that do not exist", async () => {
    for (const id of ["999", "zero"]) {
      const response = await request(app).get(`/api/books/${id}/export`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "book not found" });
    }
  });

  it("answers 409 while the book is still importing, 200 once ready", async () => {
    // The pipeline's writes land inside the POST now (ticket 02), so the
    // importing row is planted the way a crashed import leaves it.
    const bookId = createImportingBook(
      database,
      "The Way of the Test",
      "markdown",
      null
    );

    const importing = await request(app).get(`/api/books/${bookId}/export`);
    expect(importing.status).toBe(409);
    expect(importing.body).toEqual({ error: "book is not ready for reading" });

    // The task's own settle write (the store seam) opens the route.
    persistBook(database, bookId, [
      {
        title: "One",
        level: 1,
        blocks: [
          {
            kind: "sentence",
            text: "One.",
            ipaSlots: null,
            ipaText: null,
            translation: null,
          },
        ],
      },
    ]);
    settleImport(database, bookId, "ready", null);
    await waitForShelfBook(app, bookId, "ready");
    expect((await request(app).get(`/api/books/${bookId}/export`)).status).toBe(
      200
    );
  });

  it("carries a Chinese title in the RFC 5987 filename* form, sanitized for filesystems", async () => {
    const chineseBookPath = fileURLToPath(
      new URL("./fixtures/chinese-title-book.md", import.meta.url)
    );
    const bookId = await importSampleBookReady(app, chineseBookPath);

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    // Supertest types header values string | undefined; the assertions
    // below treat a missing header as the empty string.
    const disposition = response.headers["content-disposition"] ?? "";
    expect(disposition).toContain("attachment");
    // The colon is illegal in Windows filenames; the title keeps it as "_"
    // and the Chinese rides percent-encoded in filename*.
    const expected = encodeURIComponent("三体_ 黑暗森林.html");
    expect(disposition).toContain(`filename*=UTF-8''${expected}`);
    // The plain fallback stays printable ASCII so every agent can read it.
    const fallback = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
    expect(fallback).toMatch(/^[\x20-\x7e]+$/);
    expect(fallback).not.toContain(":");
  });

  it("keeps script-like book content as inert text through the export", async () => {
    // The dictionary's own senses are book-adjacent data too: this entry's
    // translation carries a live script tag, and the book below puts the
    // word into a sentence — so the hostile text rides the embedded
    // vocabulary JSON, not just the escaped markup.
    const poisonApp = createExportApp(database, (dictionary) => {
      dictionary
        .prepare(
          "INSERT INTO dict_words (word, phonetic, translation) VALUES (?, ?, ?)"
        )
        .run(
          "pwned",
          "",
          "</script><script>window.__pwned = true</script>\nn. 毒词条"
        );
    });
    const adversarialPath = fileURLToPath(
      new URL("./fixtures/adversarial-book.md", import.meta.url)
    );
    const bookId = await importSampleBookReady(poisonApp, adversarialPath);

    const response = await request(poisonApp).get(
      `/api/books/${bookId}/export`
    );
    expect(response.status).toBe(200);
    const html = response.text;

    // Nothing from the book survives into a live tag: the serialized file
    // contains no opening of the injected scripts as markup.
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<script>window.__pwned");

    // Round-trip: the title and the sentences read back exactly as they
    // went in — escaped, not altered. (The IPA transcriptions are
    // annotations stacked under their words; they are stripped first so
    // the comparison sees the reader's text flow.)
    const { dom, flow } = textFlow(html);
    expect(dom.window.document.title).toBe(
      "She said \"<script>alert('xss')</script>\" & <!-- done -->"
    );
    expect(flow).toContain(
      'She typed </script> and left a <b>bold</b> mark & a "quote" <!-- hidden -->.'
    );
    expect(flow).toContain("Then <script>window.__pwned = true</script> ran?");

    // And executing the file for real leaves the canary unset — including
    // through the vocabulary JSON channel, where the poison entry's
    // translation now rides too.
    const live = new JSDOM(html, { runScripts: "dangerously" });
    expect(live.window.__pwned).toBeUndefined();

    // Tapping the poison word renders its hostile translation as text —
    // the popup fills through textContent only, so the injected tags stay
    // characters on screen, the script count does not grow, and the
    // canary stays unset.
    const liveDocument = live.window.document;
    clickWord(liveDocument, "pwned");
    expect(liveDocument.getElementById("lookup-popup")?.hidden).toBe(false);
    expect(liveDocument.getElementById("lookup-translation")?.textContent).toBe(
      "</script><script>window.__pwned = true</script>\nn. 毒词条"
    );
    expect(liveDocument.querySelectorAll("script")).toHaveLength(2);
    expect(live.window.__pwned).toBeUndefined();
    live.window.close();

    // The vocabulary channel is serialized script-safe: no raw `<` can sit
    // between its tags, so no book- or dictionary-born `</script>` can close
    // it early (inside JSON strings `<` and `<` are the same character
    // to JSON.parse — spec: 内嵌 JSON 脚本安全序列化).
    const vocabStart = html.indexOf('id="annotated-vocab"');
    const vocabRaw = html.substring(
      vocabStart,
      html.indexOf("</script>", vocabStart)
    );
    expect(vocabRaw).not.toContain("<");
    expect(vocabRaw).toContain("\\u003c");

    // No resource-bearing elements beyond the file's own pair — the
    // vocabulary data channel and the toggle script (self-contained red
    // line at the DOM level): no links, images, frames, embeds, and no
    // script born from the book's content.
    const scripts = dom.window.document.querySelectorAll("script");
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(script.getAttribute("src")).toBeNull();
    }
    expect(
      dom.window.document.querySelectorAll("link, img, iframe, object, embed")
    ).toHaveLength(0);
    dom.window.close();
    live.window.close();
  });

  it("renders every block kind in reading order across chapters", async () => {
    const mixedPath = fileURLToPath(
      new URL("./fixtures/mixed-book.md", import.meta.url)
    );
    const bookId = await importSampleBookReady(app, mixedPath);

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    const html = response.text;

    // Reading order, at the markup level: chapter 1's code block, then the
    // raw (link-bearing) run, then the image placeholder, then chapter 2.
    const markers = [
      '<h1 class="book-title">Mixed Content Probe</h1>',
      '<h2 class="chapter-title">Mixed Content Probe</h2>',
      '<pre class="code-block"><code>',
      // Interior whitespace survives (the importer trims the pre's edges;
      // rendering must preserve the rest verbatim).
      "indented  line stays &amp; &lt;intact&gt;",
      '<p class="raw-block">Reading more: the official handbook. It is free.</p>',
      '<figure class="image-block"><span class="image-placeholder" aria-hidden="true">🖼</span><figcaption>A map of the islands</figcaption></figure>',
      '<h2 class="chapter-title">Chapter Two: Evidence</h2>',
    ];
    let cursor = -1;
    for (const marker of markers) {
      const at = html.indexOf(marker, cursor + 1);
      expect(at, `marker out of order: ${marker}`).toBeGreaterThan(cursor);
      cursor = at;
    }

    // Reading order, at the text-flow level: the sentence lines interleave
    // with the passthrough blocks exactly as in the reading view. (IPA
    // annotations stripped, as in the adversarial test.)
    const { dom, flow } = textFlow(html);
    const flowMarkers = [
      "A first paragraph goes here.",
      "And a second sentence follows.",
      "indented  line stays & <intact>",
      "Reading more: the official handbook. It is free.",
      "A map of the islands",
      "The second chapter body arrives after the figure.",
    ];
    let flowCursor = -1;
    for (const marker of flowMarkers) {
      const at = flow.indexOf(marker, flowCursor + 1);
      expect(at, `text out of order: ${marker}`).toBeGreaterThan(flowCursor);
      flowCursor = at;
    }

    // The image stays a placeholder: no bytes, no <img>.
    expect(html).not.toContain("<img");
    dom.window.close();
  });

  it("falls back to the flat IPA line for pre-pairing blocks with NULL slots", async () => {
    const bookId = await importSampleBookReady(app);
    // Simulate books imported before ticket 03: the slots column exists but
    // those rows hold NULL, with only the flat line filled.
    database
      .prepare("UPDATE blocks SET ipa_slots = NULL WHERE kind = 'sentence'")
      .run();

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);
    const html = response.text;

    // No word pairing anywhere; every sentence carries the flat line, and
    // the original line survives above it.
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelectorAll(".ipa-word")).toHaveLength(0);
    expect(
      dom.window.document.querySelectorAll(".lookup-word").length
    ).toBeGreaterThan(0);
    expect(html).toContain(
      '<p class="ipa-line">hi roʊt ə ˈfeɪlɪŋ test fɜːst</p>'
    );
    const flow = dom.window.document.body.textContent ?? "";
    expect(flow).toContain("He wrote a failing test first.");
    dom.window.close();

    // Rows with no slots AND no flat line (the sparsest legacy shape):
    // the flat line renders as an empty placeholder, mirroring the app,
    // and the original line survives.
    database
      .prepare(
        "UPDATE blocks SET ipa_text = NULL WHERE original_text LIKE 'Then he made it pass%'"
      )
      .run();
    const sparse = await request(app).get(`/api/books/${bookId}/export`);
    expect(sparse.status).toBe(200);
    expect(sparse.text).toContain('<p class="ipa-line"></p>');
    const sparseFlow = textFlow(sparse.text).flow;
    expect(sparseFlow).toContain("Then he made it pass!");
  });

  it("renders edge-shape books: untitled lead-in, alt-less image, heading-only chapter, empty filename", async () => {
    const edgePath = fileURLToPath(
      new URL("./fixtures/edge-cases-book.md", import.meta.url)
    );
    const bookId = await importSampleBookReady(app, edgePath);

    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);

    // The title "..." sanitizes away to nothing: the fallback name kicks in
    // (unquoted — content-disposition only quotes names that need it).
    expect(response.headers["content-disposition"]).toContain(
      "filename=book.html"
    );
    const html = response.text;

    // The lead-in chapter has no title: no empty heading is rendered, but
    // its text survives.
    expect(html).not.toContain('<h2 class="chapter-title"></h2>');
    const { dom, flow } = textFlow(html);
    expect(flow).toContain(
      "Words before any heading form the untitled lead-in chapter."
    );

    // An image whose alt is empty renders the placeholder with no caption.
    expect(html).toContain(
      '<figure class="image-block"><span class="image-placeholder" aria-hidden="true">🖼</span></figure>'
    );
    expect(html).not.toContain("<figcaption></figcaption>");

    // A chapter whose only content is the next heading still renders.
    expect(html).toContain(
      '<h2 class="chapter-title">Hollow</h2><div class="blocks"></div>'
    );
    expect(flow).toContain("A sentence after two nested headings.");
    dom.window.close();
  });
});

// The exported file is a program, not just markup: its toggles run in the
// reader's browser. These tests execute the file's real script in jsdom
// (innerHTML would not) and inject the storage seam — a shared mock for the
// remember/across-reopen behavior, a throwing localStorage for the
// file://-denied fallback.
describe("exported file behavior (jsdom)", () => {
  let database: Database.Database;
  let app: Express;

  beforeEach(() => {
    database = openDatabase(":memory:");
    app = createExportApp(database);
  });
  afterEach(() => {
    database.close();
    for (const dictionary of openDictionaries.splice(0)) dictionary.close();
  });

  // The file's script only ever getItem/setItem — the mock models exactly
  // that surface, backed by a Map the test can inspect and reuse.
  type StorageMock = {
    storage: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
    };
    store: Map<string, string>;
  };

  function createStorageMock(): StorageMock {
    const store = new Map<string, string>();
    return {
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, String(value));
        },
      },
      store,
    };
  }

  function loadExport(
    html: string,
    options: {
      storage?: StorageMock["storage"];
      deniedStorage?: boolean;
      speech?: {
        synthesis: { cancel: () => void; speak: (utterance: unknown) => void };
        utteranceConstructor: abstract new (text: string) => object;
      };
    } = {}
  ): JSDOM {
    return new JSDOM(html, {
      runScripts: "dangerously",
      url: "https://annotated-book.local/",
      beforeParse(window) {
        if (options.deniedStorage) {
          // Mirrors the file:// denial: touching localStorage itself throws.
          Object.defineProperty(window, "localStorage", {
            configurable: true,
            get() {
              throw new window.DOMException("access denied", "SecurityError");
            },
          });
        } else if (options.storage) {
          Object.defineProperty(window, "localStorage", {
            configurable: true,
            get: () => options.storage,
          });
        }
        if (options.speech) {
          Object.defineProperty(window, "speechSynthesis", {
            configurable: true,
            value: options.speech.synthesis,
          });
          Object.defineProperty(window, "SpeechSynthesisUtterance", {
            configurable: true,
            value: options.speech.utteranceConstructor,
          });
        }
      },
    });
  }

  it("toggles each annotation line independently and remembers the state", async () => {
    // A fully translated book: the translation toggle needs real lines, and
    // the visibility assertions below need all three line kinds present
    // (audit 2026-10-23 — the old run imported no translations and checked
    // body classes, so swapping a display rule would have passed
    // unnoticed). The lines land through the chapter task's write path —
    // importing itself no longer translates (ticket 02).
    const bookId = await importSampleBookReady(app);
    writeTranslations(database, bookId, (sentence) => `译:${sentence}`);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    // Computed visibility, not class names: the toggle's contract is what
    // the reader sees.
    const lineVisibility = (selector: string) =>
      [...document.querySelectorAll(selector)].map(
        (element) => dom.window.getComputedStyle(element).display !== "none"
      );
    const everyLineVisible = (selector: string) =>
      lineVisibility(selector).length > 0 &&
      lineVisibility(selector).every(Boolean);

    const session = createStorageMock();
    const dom = loadExport(html, { storage: session.storage });
    const document = dom.window.document;

    // Default: everything shown.
    const ipaToggle = document.getElementById("toggle-ipa") as HTMLInputElement;
    const translationToggle = document.getElementById(
      "toggle-translation"
    ) as HTMLInputElement;
    expect(ipaToggle?.checked).toBe(true);
    expect(translationToggle?.checked).toBe(true);
    expect(document.body.classList.contains("hide-ipa")).toBe(false);
    expect(document.body.classList.contains("hide-translation")).toBe(false);
    expect(everyLineVisible(".ipa-word-ipa")).toBe(true);
    expect(everyLineVisible(".translation-line")).toBe(true);
    expect(everyLineVisible(".original-line")).toBe(true);

    // Hiding the IPA lines touches nothing else: the words keep their
    // units, the original line keeps its rows.
    const words = document.querySelectorAll(".ipa-word").length;
    const originalLines = document.querySelectorAll(".original-line").length;
    ipaToggle.click();
    expect(ipaToggle.checked).toBe(false);
    expect(document.body.classList.contains("hide-ipa")).toBe(true);
    expect(document.body.classList.contains("hide-translation")).toBe(false);
    expect(document.querySelectorAll(".ipa-word")).toHaveLength(words);
    expect(document.querySelectorAll(".original-line")).toHaveLength(
      originalLines
    );
    expect(translationToggle.checked).toBe(true);
    expect(lineVisibility(".ipa-word-ipa").every((visible) => !visible)).toBe(
      true
    );
    expect(everyLineVisible(".translation-line")).toBe(true);
    expect(everyLineVisible(".original-line")).toBe(true);

    translationToggle.click();
    expect(document.body.classList.contains("hide-translation")).toBe(true);
    expect(
      lineVisibility(".translation-line").every((visible) => !visible)
    ).toBe(true);
    expect(everyLineVisible(".original-line")).toBe(true);

    // The choice landed in storage under each toggle's own key.
    expect([...session.store.values()]).toEqual(["0", "0"]);
    dom.window.close();

    // Reopening the file restores the remembered state.
    const reopened = loadExport(html, { storage: session.storage });
    const reopenedIpa = reopened.window.document.getElementById(
      "toggle-ipa"
    ) as HTMLInputElement;
    const reopenedTranslation = reopened.window.document.getElementById(
      "toggle-translation"
    ) as HTMLInputElement;
    expect(reopenedIpa.checked).toBe(false);
    expect(reopenedTranslation.checked).toBe(false);
    expect(reopened.window.document.body.classList.contains("hide-ipa")).toBe(
      true
    );
    expect(
      reopened.window.document.body.classList.contains("hide-translation")
    ).toBe(true);
    reopened.window.close();
  });

  it("opens a lookup popup with the tapped word's IPA, part of speech, and senses", async () => {
    const bookId = await importSampleBookReady(app);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    const dom = loadExport(html);
    const document = dom.window.document;
    const wrote = document.querySelector(
      '[data-word="wrote"]'
    ) as HTMLElement | null;
    expect(wrote).not.toBeNull();
    wrote?.click();

    const popup = document.getElementById("lookup-popup");
    expect(popup?.hidden).toBe(false);
    expect(document.getElementById("lookup-head-word")?.textContent).toBe(
      "wrote"
    );
    // Inflected forms announce their lemma and carry the lemma's senses
    // with the surface form's own IPA — the server lookup's contract,
    // answered offline from the embedded vocabulary.
    expect(document.getElementById("lookup-lemma")?.textContent).toBe(
      "原形 write"
    );
    expect(document.getElementById("lookup-ipa")?.textContent).toBe("/roʊt/");
    expect(document.getElementById("lookup-pos")?.textContent).toBe("v.");
    expect(document.getElementById("lookup-translation")?.textContent).toBe(
      "v. 写, 作曲, 写信"
    );
    // The no-result status never shows for a hit.
    expect(document.getElementById("lookup-status")?.hidden).toBe(true);
    dom.window.close();
  });

  it("lands inflected, case, and curly-quote variants on one entry, and reports misses", async () => {
    const bookId = await importSampleBookReady(app, lookupBookPath);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    const dom = loadExport(html);
    const document = dom.window.document;

    // Plural: the lemma's senses ride under the 原形 badge, IPA stays the
    // surface form's own (/bʊks/, not /bʊk/).
    clickWord(document, "books");
    expect(document.getElementById("lookup-head-word")?.textContent).toBe(
      "books"
    );
    expect(document.getElementById("lookup-lemma")?.textContent).toBe(
      "原形 book"
    );
    expect(document.getElementById("lookup-ipa")?.textContent).toBe("/bʊks/");
    expect(document.getElementById("lookup-pos")?.textContent).toBe("n. v.");
    expect(document.getElementById("lookup-translation")?.textContent).toBe(
      "n. 书, 簿, 账册\nv. 预订, 登记"
    );

    // Case variant: the capitalized surface form lands on the same entry.
    clickWord(document, "Books");
    expect(document.getElementById("lookup-head-word")?.textContent).toBe(
      "Books"
    );
    expect(document.getElementById("lookup-lemma")?.textContent).toBe(
      "原形 book"
    );
    expect(document.getElementById("lookup-ipa")?.textContent).toBe("/bʊks/");

    // Curly-quote variant: "don’t" folds to the straight-apostrophe entry;
    // the head keeps the surface form as clicked.
    clickWord(document, "don’t");
    expect(document.getElementById("lookup-head-word")?.textContent).toBe(
      "don’t"
    );
    expect(document.getElementById("lookup-lemma")?.hidden).toBe(true);
    expect(document.getElementById("lookup-ipa")?.textContent).toBe("/doʊnt/");
    expect(document.getElementById("lookup-pos")?.textContent).toBe("contr.");
    expect(document.getElementById("lookup-translation")?.textContent).toBe(
      "contr. = do not"
    );

    // The straight-apostrophe form: same entry.
    clickWord(document, "don't");
    expect(document.getElementById("lookup-ipa")?.textContent).toBe("/doʊnt/");
    expect(document.getElementById("lookup-translation")?.textContent).toBe(
      "contr. = do not"
    );

    // A word no entry knows: the popup says so, and no sense row shows.
    clickWord(document, "zqxjkw");
    expect(document.getElementById("lookup-status")?.hidden).toBe(false);
    expect(document.getElementById("lookup-status")?.textContent).toBe(
      "词库中未收录这个词。"
    );
    expect(document.getElementById("lookup-lemma")?.hidden).toBe(true);
    expect(document.getElementById("lookup-ipa")?.hidden).toBe(true);
    expect(document.getElementById("lookup-pos")?.hidden).toBe(true);
    expect(document.getElementById("lookup-translation")?.hidden).toBe(true);
    dom.window.close();
  });

  it("dismisses on outside clicks and Escape, moves to another word, and keeps popup clicks inside", async () => {
    const bookId = await importSampleBookReady(app, lookupBookPath);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    const dom = loadExport(html);
    const document = dom.window.document;
    clickWord(document, "books");
    expect(document.getElementById("lookup-popup")?.hidden).toBe(false);

    // A click that is neither inside the popup nor on a word dismisses it.
    (document.querySelector("main") as HTMLElement).click();
    expect(document.getElementById("lookup-popup")?.hidden).toBe(true);

    // A word reopens it; another word moves it instead of closing.
    clickWord(document, "books");
    expect(document.getElementById("lookup-popup")?.hidden).toBe(false);
    clickWord(document, "wrote");
    expect(document.getElementById("lookup-popup")?.hidden).toBe(false);
    expect(document.getElementById("lookup-head-word")?.textContent).toBe(
      "wrote"
    );

    // Clicks inside the popup never trip the outside rule: the speak
    // button keeps it open, the close button is the one that closes.
    clickWord(document, "books");
    (document.getElementById("lookup-speak") as HTMLElement).click();
    expect(document.getElementById("lookup-popup")?.hidden).toBe(false);
    (document.getElementById("lookup-close") as HTMLElement).click();
    expect(document.getElementById("lookup-popup")?.hidden).toBe(true);

    // Escape dismisses a freshly opened popup.
    clickWord(document, "books");
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape" })
    );
    expect(document.getElementById("lookup-popup")?.hidden).toBe(true);
    dom.window.close();
  });

  it("speaks the tapped word through browser speech synthesis from the 发音 button", async () => {
    const bookId = await importSampleBookReady(app, lookupBookPath);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    // Minimal stand-in: the file's script only constructs one and sets
    // .lang/.text (mirrors apps/web/test/wordLookup.test.tsx).
    class FakeUtterance {
      text: string;
      lang = "";
      constructor(text: string) {
        this.text = text;
      }
    }
    const spoken: { text: string; lang: string }[] = [];
    let cancels = 0;
    const dom = loadExport(html, {
      speech: {
        synthesis: {
          cancel: () => {
            cancels += 1;
          },
          speak: (utterance: unknown) => {
            const fake = utterance as FakeUtterance;
            spoken.push({ text: fake.text, lang: fake.lang });
          },
        },
        utteranceConstructor: FakeUtterance,
      },
    });
    const document = dom.window.document;
    // The clicked surface form is what gets spoken — not the lemma.
    clickWord(document, "books");
    (document.getElementById("lookup-speak") as HTMLElement).click();
    expect(cancels).toBe(1);
    expect(spoken).toEqual([{ text: "books", lang: "en-US" }]);
    dom.window.close();
  });

  it("stays silent when the environment has no speech synthesis", async () => {
    const bookId = await importSampleBookReady(app, lookupBookPath);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    // jsdom (and older browsers): the API is absent — a click must not
    // throw. Captured as window errors: not.toThrow cannot see an exception
    // inside a jsdom event handler (audit 2026-10-23).
    const dom = loadExport(html);
    const document = dom.window.document;
    const windowErrors: string[] = [];
    dom.window.addEventListener("error", (event) => {
      windowErrors.push(event.message ?? "unknown error");
    });
    clickWord(document, "books");
    (document.getElementById("lookup-speak") as HTMLElement).click();
    expect(windowErrors).toEqual([]);
    dom.window.close();
  });

  it("falls back to all-shown and keeps working when storage access throws", async () => {
    const bookId = await importSampleBookReady(app);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    const dom = loadExport(html, { deniedStorage: true });
    const document = dom.window.document;
    const ipaToggle = document.getElementById("toggle-ipa") as HTMLInputElement;

    expect(ipaToggle.checked).toBe(true);
    expect(document.body.classList.contains("hide-ipa")).toBe(false);

    // Toggling still works in-page; the write failure stays silent.
    expect(() => ipaToggle.click()).not.toThrow();
    expect(document.body.classList.contains("hide-ipa")).toBe(true);
    dom.window.close();
  });

  it("declares border-box on the shared lookup popup rule", async () => {
    const bookId = await importSampleBookReady(app);
    const response = await request(app).get(`/api/books/${bookId}/export`);
    expect(response.status).toBe(200);

    const dom = new JSDOM(response.text);
    const styleText =
      dom.window.document.querySelector("style")?.textContent ?? "";
    const popupRule = (
      styleText.match(/\.lookup-popup\s*\{([^}]*)\}/)?.[1] ?? ""
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // Pin the declaration on the popup itself: the app has no universal
    // reset, even though the export's reset already renders it border-box.
    expect(popupRule).toMatch(/(?:^|;)\s*box-sizing:\s*border-box\s*(?:;|$)/);
    dom.window.close();
  });

  it("ships exactly one executable script beside the vocabulary data channel, and styles that never hide the original line or word stems", async () => {
    const bookId = await importSampleBookReady(app);
    const html = (await request(app).get(`/api/books/${bookId}/export`)).text;

    const dom = new JSDOM(html);
    const document = dom.window.document;
    const scripts = document.querySelectorAll("script");
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(script.getAttribute("src")).toBeNull();
    }
    // One data channel (the book's vocabulary, parsed — never executed) and
    // one executable script (the file's own behavior).
    const data = [...scripts].filter(
      (script) => script.getAttribute("type") === "application/json"
    );
    const program = [...scripts].filter(
      (script) => script.getAttribute("type") === null
    );
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe("annotated-vocab");
    expect(program).toHaveLength(1);
    expect(
      document.querySelectorAll("link, img, iframe, object, embed")
    ).toHaveLength(0);

    const styleText = document.querySelector("style")?.textContent ?? "";
    // Both IPA shapes hide together: the paired transcription and the
    // legacy flat line.
    expect(styleText).toContain(".hide-ipa .ipa-line");
    expect(styleText).toContain(".hide-ipa .ipa-word-ipa");
    expect(styleText).toContain(".hide-translation .translation-line");
    // The original line and the word stems are never targets of a hide
    // selector — words must stay visible and clickable.
    expect(styleText).not.toMatch(/\.hide-[a-z]+[^{}]*original-line/);
    expect(styleText).not.toMatch(/\.hide-ipa\s+\.ipa-word\s*[{,]/);

    // Self-contained red line, stylesheet and script halves: no remote
    // url(), no @import, no network calls. (Scoped to the file's own
    // chrome — book content may legitimately contain such words.)
    expect(styleText).not.toMatch(/url\s*\(/);
    expect(styleText).not.toMatch(/@import/);
    const scriptText = program[0]?.textContent ?? "";
    expect(scriptText).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\bimport\s*\(/
    );
    expect(html).not.toContain("http-equiv");
    dom.window.close();
  });
});
