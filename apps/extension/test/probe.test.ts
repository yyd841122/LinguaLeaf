import { describe, expect, it } from "vitest";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { importBook } from "../src/reader/import-book";

const TOC_EPUB = () =>
  buildEpub({
    title: "Journey Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>North</h1><p>First chapter words.</p>",
      },
      {
        href: "text/two.xhtml",
        body: "<h2>South</h2><p>Second chapter words.</p>",
      },
    ],
  });

describe("probe", () => {
  it("imports TOC_EPUB", async () => {
    const bytes = await TOC_EPUB();
    const book = await importBook(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
      "book.epub",
      () => null
    );
    console.log("title:", book.title, "chapters:", book.chapters.length);
    expect(book.chapters).toHaveLength(2);
  });
});
