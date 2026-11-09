import { describe, expect, it } from "vitest";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { eligiblePdfLines } from "../src/reader/pdf-lines";

const item = (str: string): TextItem => ({
  str,
  dir: "ltr",
  transform: [12, 0, 0, 12, 40, 80],
  width: 100,
  height: 12,
  fontName: "font",
  hasEOL: true,
});
describe("canonical PDF lines", () => {
  it("indexes only nonempty word-bearing TextItems and preserves item geometry references", () => {
    const first = item("Cafe\u0301—words\r\n");
    const second = item("  Hello, world!  ");
    const lines = eligiblePdfLines([
      item("  "),
      { type: "beginMarkedContent", id: "mark" },
      item("...123"),
      first,
      item(""),
      second,
    ]);
    expect(
      lines.map(({ lineIndex, lineText, matches }) => ({
        lineIndex,
        lineText,
        words: matches.map((m) => m[0]),
      }))
    ).toEqual([
      { lineIndex: 0, lineText: "Café—words\n", words: ["Café", "words"] },
      {
        lineIndex: 1,
        lineText: "  Hello, world!  ",
        words: ["Hello", "world"],
      },
    ]);
    expect(lines[0]?.item).toBe(first);
    expect(lines[1]?.item).toBe(second);
  });
});
