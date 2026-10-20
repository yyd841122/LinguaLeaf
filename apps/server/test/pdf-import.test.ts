import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";
import { createFakeTranslator } from "./fixtures/translator.js";
import { waitForShelfBook } from "./fixtures/async-import.js";
import {
  chapterTextPages,
  createBookmarkedPdf,
  createEncryptedPdf,
  createLigaturePdf,
  createOversizedPdf,
  createSamplePdf,
  createScannedPdf,
  defaultThreeTextPages,
} from "./fixtures/pdf.js";

describe("PDF import through the HTTP API seam", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof createFixtureDictionary>;
  let app: Express;
  let translator: ReturnType<typeof createFakeTranslator>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
    translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );
    app = createApp(database, dictionary, translator);
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  // Happy-path helper: upload a PDF buffer and wait for the shelf to
  // settle ready, mirroring what a reader's browser does.
  async function importPdf(buffer: Buffer, filename: string): Promise<number> {
    const created = await request(app)
      .post("/api/books")
      .attach("file", buffer, { filename, contentType: "application/pdf" });
    expect(created.status).toBe(202);
    await waitForShelfBook(app, created.body.id, "ready");
    return created.body.id as number;
  }

  async function expectChapterPages(
    bookId: number,
    position: number,
    pages: string[]
  ): Promise<void> {
    const chapter = await request(app).get(
      `/api/books/${bookId}/chapters/${position}`
    );
    expect(chapter.status).toBe(200);
    expect(
      chapter.body.blocks.map(
        (block: {
          kind: string;
          originalText: string;
          translationText: string;
        }) => ({
          kind: block.kind,
          originalText: block.originalText,
          translationText: block.translationText,
        })
      )
    ).toEqual(
      pages.flatMap((page) =>
        page.split("\n").map((sentence) => ({
          kind: "sentence",
          originalText: sentence,
          translationText: `译:${sentence}`,
        }))
      )
    );
  }

  it("chapters by bookmark pages, including nested and named destinations through the final page", async () => {
    const bookId = await importPdf(
      await createBookmarkedPdf(),
      "different-file-name.pdf"
    );
    const toc = await request(app).get(`/api/books/${bookId}`);
    expect(toc.status).toBe(200);
    expect(toc.body.title).toBe("Bookmarked PDF Book");
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "Opening", level: null },
      { position: 2, title: "A Turning Point", level: null },
      { position: 3, title: "Finale — 最后一章", level: null },
    ]);
    const pages = chapterTextPages(6);
    await expectChapterPages(bookId, 1, pages.slice(0, 2));
    await expectChapterPages(bookId, 2, pages.slice(2, 4));
    await expectChapterPages(bookId, 3, pages.slice(4, 6));
    expect(translator.calls.length).toBeGreaterThan(0);
  });

  it.each([
    {
      pageCount: 10,
      ranges: [{ title: "第 1–10 页", start: 0, end: 10 }],
    },
    {
      pageCount: 11,
      ranges: [
        { title: "第 1–10 页", start: 0, end: 10 },
        { title: "第 11–11 页", start: 10, end: 11 },
      ],
    },
    {
      pageCount: 23,
      ranges: [
        { title: "第 1–10 页", start: 0, end: 10 },
        { title: "第 11–20 页", start: 10, end: 20 },
        { title: "第 21–23 页", start: 20, end: 23 },
      ],
    },
  ])(
    "splits $pageCount unbookmarked pages into ten-page chapters",
    async ({ pageCount, ranges }) => {
      const pages = chapterTextPages(pageCount);
      const bookId = await importPdf(
        await createSamplePdf({ pages }),
        "unbookmarked.pdf"
      );
      const toc = await request(app).get(`/api/books/${bookId}`);
      expect(toc.status).toBe(200);
      expect(toc.body.chapters).toEqual(
        ranges.map((range, index) => ({
          position: index + 1,
          title: range.title,
          level: null,
        }))
      );
      for (const [index, range] of ranges.entries()) {
        await expectChapterPages(
          bookId,
          index + 1,
          pages.slice(range.start, range.end)
        );
      }
    }
  );

  it("carries the PDF page count on the upload and shelf seams for the long-book hint", async () => {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await createBookmarkedPdf(), {
        filename: "paged.pdf",
        contentType: "application/pdf",
      });
    expect(created.status).toBe(202);
    // The progress panel reads this off the shelf to decide the
    // 预计耗时较长 hint, so the count must be there while importing.
    expect(created.body).toMatchObject({ pageCount: 6 });

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books[0]).toMatchObject({ pageCount: 6 });

    // A fact about the file: it survives the import settling.
    await waitForShelfBook(app, created.body.id, "ready");
    const settled = await request(app).get("/api/books");
    expect(settled.body.books[0]).toMatchObject({ pageCount: 6 });
  });

  it("keeps pages before the first bookmark and every same-page bookmark without duplicating text", async () => {
    const pages = chapterTextPages(6);
    const bookId = await importPdf(
      await createBookmarkedPdf({
        pages,
        bookmarks: [
          { title: "Ending", page: 5 },
          {
            title: "A destinationless grouping node",
            page: null,
            children: [
              { title: "Part One", page: 3 },
              { title: "First Section", page: 3 },
            ],
          },
        ],
      }),
      "messy-outline.pdf"
    );
    const toc = await request(app).get(`/api/books/${bookId}`);
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "第 1–2 页", level: null },
      { position: 2, title: "Part One", level: null },
      { position: 3, title: "First Section", level: null },
      { position: 4, title: "Ending", level: null },
    ]);
    await expectChapterPages(bookId, 1, pages.slice(0, 2));
    await expectChapterPages(bookId, 2, []);
    await expectChapterPages(bookId, 3, pages.slice(2, 4));
    await expectChapterPages(bookId, 4, pages.slice(4, 6));
  });

  it("uses page ranges when the outline has no local page destinations", async () => {
    const pages = chapterTextPages(11);
    const bookId = await importPdf(
      await createBookmarkedPdf({
        pages,
        bookmarks: [{ title: "No destination", page: null }],
      }),
      "no-local-targets.pdf"
    );
    const toc = await request(app).get(`/api/books/${bookId}`);
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "第 1–10 页", level: null },
      { position: 2, title: "第 11–11 页", level: null },
    ]);
    await expectChapterPages(bookId, 1, pages.slice(0, 10));
    await expectChapterPages(bookId, 2, pages.slice(10));
  });

  it("rejects bytes that are not a PDF with 400 and no book row", async () => {
    const created = await request(app)
      .post("/api/books")
      .attach("file", Buffer.from("this is not a pdf at all"), {
        filename: "broken.pdf",
        contentType: "application/pdf",
      });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/invalid PDF/i);

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books).toEqual([]);
  });

  it("fuses a word split by a typeset hyphen at the line end", async () => {
    const bookId = await importPdf(
      await createSamplePdf({
        pages: [
          [
            "The hyphenated word below is split by the typesetter at a",
            "margin, exactly like this: exam-",
            "ple of the merge across a printed break stands alone.",
          ].join("\n"),
        ],
      }),
      "hyphen.pdf"
    );
    const chapter = await request(app).get(`/api/books/${bookId}/chapters/1`);
    const texts = chapter.body.blocks.map(
      (b: { originalText: string }) => b.originalText
    );
    expect(texts.join("\n")).toContain(
      "this: example of the merge across a printed break"
    );
    expect(texts.join("\n")).not.toContain("exam- ple");
  });

  it("reads a ToUnicode-\uFB01 ligature as plain fi in the imported blocks", async () => {
    const bookId = await importPdf(await createLigaturePdf(), "ligature.pdf");
    const chapter = await request(app).get(`/api/books/${bookId}/chapters/1`);
    const texts = chapter.body.blocks.map(
      (b: { originalText: string }) => b.originalText
    );
    expect(texts.join("\n")).toContain(
      "fine tuning of the ligatures keeps every original glyph reading"
    );
    expect(texts.join("\n")).not.toContain("\uFB01");
  });

  it("drops repeated header and page-number lines but keeps a repeated body line", async () => {
    const pageLines = (pageNo: number, left: string, right: string): string =>
      [
        "A Repeated Chapter Header",
        left,
        "The refrain sits deep in the body text.",
        right,
        `Extra prose on page ${pageNo} keeps the candidate margins honest.`,
        String(11 + pageNo),
      ].join("\n");
    const bookId = await importPdf(
      await createSamplePdf({
        title: "Repeated Lines Book",
        pages: [
          pageLines(
            1,
            "First page prose about reading in the original.",
            "More first page prose fills out the middle of the page."
          ),
          pageLines(
            2,
            "Second page prose about reading in the original.",
            "More second page prose fills out the middle of the page."
          ),
          pageLines(
            3,
            "Third page prose about reading in the original.",
            "More third page prose fills out the middle of the page."
          ),
        ],
      }),
      "repeated-lines.pdf"
    );
    const chapter = await request(app).get(`/api/books/${bookId}/chapters/1`);
    const texts = chapter.body.blocks.map(
      (b: { originalText: string }) => b.originalText
    );
    const joined = texts.join("\n");
    // The three-page-repeated header and the pure page-number lines are
    // running heads, not content.
    expect(joined).not.toContain("A Repeated Chapter Header");
    expect(joined).not.toMatch(/\b1[234]\b/);
    // A short line repeated mid-page on every page is real content (a
    // refrain) and must survive the heuristic.
    expect(
      joined.split("The refrain sits deep in the body text.").length - 1
    ).toBe(3);
  });

  it("rejects an image-only PDF with 422, creating no book and no translation work", async () => {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await createScannedPdf({ pages: 4 }), {
        filename: "scan.pdf",
        contentType: "application/pdf",
      });
    expect(created.status).toBe(422);
    expect(created.body.error).toBe("扫描件/图片型 PDF 暂不支持");

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books).toEqual([]);
    expect(translator.calls).toEqual([]);
  });

  it("treats a median page of exactly the threshold as text and one below as scanned", async () => {
    // Two lines fold to exactly 100 characters (50 + joiner + 49); the
    // documented boundary is inclusive (exactly-at-threshold passes).
    const atThreshold = await request(app)
      .post("/api/books")
      .attach(
        "file",
        await createSamplePdf({
          title: "Boundary Book",
          pages: [["x".repeat(49) + ".", "y".repeat(48) + "."].join("\n")],
        }),
        { filename: "boundary-100.pdf", contentType: "application/pdf" }
      );
    expect(atThreshold.status).toBe(202);
    await waitForShelfBook(app, atThreshold.body.id, "ready");

    const belowThreshold = await request(app)
      .post("/api/books")
      .attach(
        "file",
        await createSamplePdf({
          title: "Boundary Book",
          pages: [["x".repeat(49) + ".", "y".repeat(47) + "."].join("\n")],
        }),
        { filename: "boundary-99.pdf", contentType: "application/pdf" }
      );
    expect(belowThreshold.status).toBe(422);
  });

  it("imports a text PDF that carries blank cover pages without false rejection", async () => {
    // Median page length rides on the text pages, so a blank cover and a
    // blank plate must not tip the book into the scan gate.
    const bookId = await importPdf(
      await createSamplePdf({ pages: ["", ...defaultThreeTextPages()] }),
      "with-blank-cover.pdf"
    );
    const shelf = await request(app).get("/api/books");
    expect(
      shelf.body.books.find((b: { id: number }) => b.id === bookId).status
    ).toBe("ready");
  });

  it.each([
    { label: "without bookmarks", create: createSamplePdf },
    { label: "with bookmarks", create: createBookmarkedPdf },
  ])(
    "falls back to the file name without extension when metadata has no title ($label)",
    async ({ create }) => {
      const bookId = await importPdf(
        await create({ title: null }),
        "My Great Book.PDF"
      );
      const toc = await request(app).get(`/api/books/${bookId}`);
      expect(toc.body.title).toBe("My Great Book");
    }
  );

  it("generates byte-identical fixture PDFs across runs", async () => {
    expect(
      (await createBookmarkedPdf()).equals(await createBookmarkedPdf())
    ).toBe(true);
    expect((await createSamplePdf()).equals(await createSamplePdf())).toBe(
      true
    );
    expect(
      (await createScannedPdf({ pages: 4 })).equals(
        await createScannedPdf({ pages: 4 })
      )
    ).toBe(true);
    expect((await createLigaturePdf()).equals(await createLigaturePdf())).toBe(
      true
    );
    expect(
      (await createEncryptedPdf()).equals(await createEncryptedPdf())
    ).toBe(true);
    expect(
      (await createOversizedPdf(2001)).equals(await createOversizedPdf(2001))
    ).toBe(true);
  });

  it("rejects a password-protected PDF with 400 and the 加密 文案", async () => {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await createEncryptedPdf(), {
        filename: "encrypted.pdf",
        contentType: "application/pdf",
      });
    expect(created.status).toBe(400);
    // The spec's 文案, verbatim in the body (spec.md Revisions: 加密文案).
    expect(created.body.error).toBe("加密 PDF 暂不支持");

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books).toEqual([]);
  });

  it("rejects PDFs beyond the page cap with 400", async () => {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await createOversizedPdf(2001), {
        filename: "oversized.pdf",
        contentType: "application/pdf",
      });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/invalid PDF/i);

    const shelf = await request(app).get("/api/books");
    expect(shelf.body.books).toEqual([]);
  });

  it("imports a text-layer PDF into a ready book with merged sentences and translations", async () => {
    const created = await request(app)
      .post("/api/books")
      .attach("file", await createSamplePdf(), {
        filename: "sample-book.pdf",
        contentType: "application/pdf",
      });
    expect(created.status).toBe(202);
    await waitForShelfBook(app, created.body.id, "ready");

    const toc = await request(app).get(`/api/books/${created.body.id}`);
    expect(toc.status).toBe(200);
    // Metadata names the book; the short unbookmarked PDF uses a page range
    // for its chapter title rather than reusing the book title.
    expect(toc.body).toMatchObject({
      id: created.body.id,
      title: "Sample PDF Book",
      format: "pdf",
    });
    expect(toc.body.chapters).toEqual([
      { position: 1, title: "第 1–3 页", level: null },
    ]);

    const chapter = await request(app).get(
      `/api/books/${created.body.id}/chapters/1`
    );
    expect(chapter.status).toBe(200);
    // Printed line breaks and the page boundary are invisible to the
    // sentence blocks: every expected sentence is exactly one block.
    expect(
      chapter.body.blocks.map((b: { originalText: string }) => b.originalText)
    ).toEqual([
      "The first page opens the sample book with a steady voice.",
      "A wrapped sentence breaks across two printed lines, and the reader never notices the seams.",
      "A sentence runs off the bottom of this page and finishes on the next one without losing a word.",
      "The second page keeps the story moving through quiet prose.",
      "Nothing here repeats a short line, so the cleanup pass must leave every sentence exactly where it stands.",
      "The third page closes the sample with a final calm remark.",
      "The book ends the way it began, in plain and legible English sentences ready for annotation.",
    ]);
    // The shared annotation pipeline ran: the fake translator rode along.
    expect(chapter.body.blocks[0].translationText).toBe(
      "译:The first page opens the sample book with a steady voice."
    );
    expect(chapter.body.blocks[0].kind).toBe("sentence");
  });
});
