import { describe, expect, it } from "vitest";
import { walkChapterBlocks } from "../src/blocks.js";
import type { IpaLookup } from "../src/ipa-line.js";
import {
  isMarkdownFilename,
  MARKDOWN_EXTENSION,
  readMarkdownBook,
} from "../src/markdown.js";

// mobile-md-import 01: the Markdown reader sank here from the server, and
// this file pins the element semantics the mobile face inherits verbatim
// (spec decision 5: whatever html:false + the shared extraction do today —
// no second semantics for the phone). Every expected value below was taken
// from a live run of markdown-it 15 + extractChaptersFromHtml, not
// transcribed: list items merge into one paragraph run per list, link
// paragraphs keep the link text and drop the href, inert HTML survives as
// literal text (escaped at render time, never parsed back into elements).

describe("MARKDOWN_EXTENSION / isMarkdownFilename", () => {
  it("claims .md and .markdown case-insensitively and nothing else", () => {
    expect(MARKDOWN_EXTENSION).toEqual(/\.(md|markdown)$/i);
    expect(isMarkdownFilename("book.md")).toBe(true);
    expect(isMarkdownFilename("book.markdown")).toBe(true);
    expect(isMarkdownFilename("BOOK.MD")).toBe(true);
    expect(isMarkdownFilename("notes.mdown")).toBe(false);
    expect(isMarkdownFilename("notes.txt")).toBe(false);
    expect(isMarkdownFilename("book.epub")).toBe(false);
  });
});

describe("readMarkdownBook — element semantics (spec decision 5)", () => {
  it("opens a chapter per heading; heading text never enters the block stream", () => {
    const book = readMarkdownBook(
      "book.md",
      [
        "# One",
        "",
        "First paragraph. Second sentence here.",
        "",
        "## Two",
        "",
        "Another paragraph.",
        "",
      ].join("\n")
    );
    expect(book.format).toBe("markdown");
    expect(book.chapters).toEqual([
      {
        title: "One",
        level: 1,
        items: [
          { kind: "paragraph", text: "First paragraph. Second sentence here." },
        ],
      },
      {
        title: "Two",
        level: 2,
        items: [{ kind: "paragraph", text: "Another paragraph." }],
      },
    ]);
  });

  it("turns lists into paragraph runs — one run per list, annotatable downstream", () => {
    const book = readMarkdownBook(
      "book.md",
      ["# T", "", "- item one", "- item two", "", "1. ordered a", ""].join("\n")
    );
    expect(book.chapters[0]?.items).toEqual([
      { kind: "paragraph", text: "item one item two" },
      { kind: "paragraph", text: "ordered a" },
    ]);
  });

  it("keeps fenced code verbatim as a code item — interior indent in, fence edges gone", () => {
    const book = readMarkdownBook(
      "book.md",
      [
        "# T",
        "",
        "```js",
        "const x = 1;",
        "   indented kept",
        "```",
        "",
        "After.",
      ].join("\n")
    );
    expect(book.chapters[0]?.items).toEqual([
      { kind: "code", text: "const x = 1;\n   indented kept" },
      { kind: "paragraph", text: "After." },
    ]);
  });

  it("keeps an image as a placeholder item in reading position, alt as its text", () => {
    const book = readMarkdownBook(
      "book.md",
      ["# T", "", "![cover alt](cover.png)", "", "Text after image."].join("\n")
    );
    expect(book.chapters[0]?.items).toEqual([
      { kind: "image", text: "cover alt" },
      { kind: "paragraph", text: "Text after image." },
    ]);
  });

  it("sends a link-bearing paragraph to raw and a plain one to paragraph", () => {
    const book = readMarkdownBook(
      "book.md",
      [
        "# T",
        "",
        "See [the docs](https://example.com) for more.",
        "",
        "No link here.",
        "",
      ].join("\n")
    );
    expect(book.chapters[0]?.items).toEqual([
      // The href is dropped; the link text stays in the reading flow.
      { kind: "raw", text: "See the docs for more." },
      { kind: "paragraph", text: "No link here." },
    ]);
  });

  it("plain-texts inline markdown into the sentence flow", () => {
    const book = readMarkdownBook(
      "book.md",
      "# T\n\nShe said **bold** and *italic* and `code` bits.\n"
    );
    expect(book.chapters[0]?.items).toEqual([
      { kind: "paragraph", text: "She said bold and italic and code bits." },
    ]);
  });

  it("keeps embedded raw HTML inert: literal text, never parsed back into elements", () => {
    const book = readMarkdownBook(
      "book.md",
      [
        "# T",
        "",
        "Hello <script>alert(1)</script> world",
        "",
        "<div>block html</div>",
        "",
      ].join("\n")
    );
    // html:false escapes at render time, so extraction sees text nodes —
    // the tags ride as characters inside paragraph items (no code/raw
    // shape change, nothing to execute).
    expect(book.chapters[0]?.items).toEqual([
      { kind: "paragraph", text: "Hello <script>alert(1)</script> world" },
      { kind: "paragraph", text: "<div>block html</div>" },
    ]);
  });

  it("rides the shared annotation dispatch: paragraphs become sentence blocks with slots", () => {
    // The one chain, two hosts claim, pinned on the md path: the reader's
    // paragraph items feed the same walkChapterBlocks the EPUB face uses,
    // so 注音 lands without any markdown-specific dispatch.
    const everyToken: IpaLookup = () => "X";
    const book = readMarkdownBook(
      "book.md",
      "# T\n\nFirst paragraph. Second sentence here.\n"
    );
    const blocks = walkChapterBlocks(book.chapters[0]!.items, everyToken, {
      sentence: (text, ipaSlots) => ({
        kind: "sentence" as const,
        text,
        ipaSlots,
      }),
      plain: (kind, text) => ({ kind, text }),
    });
    expect(blocks).toEqual([
      {
        kind: "sentence",
        text: "First paragraph.",
        ipaSlots: ["X", "X"],
      },
      {
        kind: "sentence",
        text: "Second sentence here.",
        ipaSlots: ["X", "X", "X"],
      },
    ]);
  });

  it("names the book its first heading, falling back to the file name", () => {
    const headed = readMarkdownBook("book.md", "# Deep Waters\n\nProse.\n");
    expect(headed.title).toBe("Deep Waters");

    // No headings: the untitled lead-in holds everything; the extension
    // comes off the file name (spec: 书名退文件名).
    const bare = readMarkdownBook("My Great Story.md", "Just prose.\n");
    expect(bare.title).toBe("My Great Story");
    expect(bare.chapters).toEqual([
      {
        title: "",
        level: null,
        items: [{ kind: "paragraph", text: "Just prose." }],
      },
    ]);
  });
});
