import { describe, expect, it } from "vitest";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { eligiblePdfLines } from "../src/reader/pdf-lines";

// The visual-line contract (mobile-app ticket 03): items sharing a
// baseline merge into one line — glyph-per-item streams (Camille: 922
// items, 16 baselines, page 1) must not become one pen/word-span per
// glyph. Whitespace items carry the spaces; the join is verbatim.

const item = (str: string, x = 40, y = 80, width = 100): TextItem => ({
  str,
  dir: "ltr",
  transform: [12, 0, 0, 12, x, y],
  width,
  height: 12,
  fontName: "font",
  hasEOL: true,
});

// Spreads a word into per-glyph items the way embedding-heavy PDFs do,
// advancing x per glyph (spaces ride narrower advances).
const glyphStream = (text: string, startX: number, y: number): TextItem[] => {
  let x = startX;
  return [...text].map((ch) => {
    const glyph = item(ch, x, y, 6);
    x += ch === " " ? 3.5 : 6;
    return glyph;
  });
};

describe("canonical PDF visual lines", () => {
  it("merges a glyph-per-item stream into one line with verbatim text", () => {
    const glyphs = [
      ...glyphStream("Camille", 40, 300),
      item(" ", 82, 300, 4),
      ...glyphStream("by", 86, 300),
      item("  ", 98, 300, 8),
      ...glyphStream("Dumas", 106, 300),
    ];
    const lines = eligiblePdfLines(glyphs);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.lineText).toBe("Camille by  Dumas");
    expect(lines[0]!.matches.map((m) => m[0])).toEqual([
      "Camille",
      "by",
      "Dumas",
    ]);
    // Geometry references survive: the render loop reads each item's
    // transform/width to place the merged line.
    expect(lines[0]!.items[0]).toBe(glyphs[0]);
    expect(lines[0]!.items).toHaveLength(glyphs.length);
  });

  it("normalizes per item (NFC, newlines) and skips non-word clusters", () => {
    const first = item("Café—words\r\n", 40, 300);
    const second = item("  Hello, world!  ", 40, 260);
    const lines = eligiblePdfLines([
      item("  ", 0, 340),
      { type: "beginMarkedContent", id: "mark" },
      item("...123", 0, 320),
      first,
      item("", 0, 280),
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
    expect(lines[0]!.items[0]).toBe(first);
    expect(lines[1]!.items[0]).toBe(second);
  });

  it("splits items whose baselines sit beyond the font-relative tolerance", () => {
    const lines = eligiblePdfLines([
      item("Alpha", 40, 300),
      item("Beta", 40, 302.5), // within the 3pt tolerance — same line
      item("Gamma", 40, 306), // beyond it — own line
    ]);
    expect(lines.map((line) => line.lineText)).toEqual(["Gamma", "AlphaBeta"]);
  });

  it("orders lines top-down by baseline regardless of stream order", () => {
    const lines = eligiblePdfLines([
      item("Second line", 40, 260),
      item("First line", 40, 300),
    ]);
    expect(lines.map((line) => line.lineText)).toEqual([
      "First line",
      "Second line",
    ]);
    expect(lines.map((line) => line.lineIndex)).toEqual([0, 1]);
  });
});
