import { describe, expect, it } from "vitest";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { eligiblePdfLines, markParagraphBreaks } from "../src/reader/pdf-lines";

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

  it("recovers a dropped space at a wide letter-to-letter gap", () => {
    // Camille: "Chapter"+"I" rides a bare 0.18-fontPx gap — the
    // generator dropped the space glyph; the gap is the only trace.
    const chapter = item("Chapter", 40, 300, 42); // ends at x=82
    const roman = item("I", 84.16, 300, 6); // gap 2.16 = 0.18 × fontPx 12
    const lines = eligiblePdfLines([chapter, roman]);
    expect(lines[0]!.lineText).toBe("Chapter I");
    expect(lines[0]!.matches.map((m) => m[0])).toEqual(["Chapter", "I"]);
  });

  it("keeps tracking-distance joints fused and non-letter boundaries untouched", () => {
    const fused = eligiblePdfLines([
      item("poss", 40, 300, 24), // ends at x=64
      item("ible", 64.72, 300, 24), // gap 0.72 = 0.06 × 12 — tracking
    ]);
    expect(fused[0]!.lineText).toBe("possible");
    const punctuated = eligiblePdfLines([
      item("word", 40, 300, 24),
      item("[La", 66.16, 300, 12), // wide gap, but "[" is no letter
    ]);
    expect(punctuated[0]!.lineText).toBe("word[La");
  });
});

// Paragraph grouping (round 16): the multi-signal rule — clustered
// leading (mode, not min), short lines, indents.

const para = (baseline: number, left: number, right: number, fontPx = 12) => ({
  baseline,
  left,
  right,
  fontPx,
  paraEnd: false,
});

describe("markParagraphBreaks", () => {
  it("keeps body lines coherent when a tighter-set block drags the min down", () => {
    // The min-based defect: a footnote pair at leading 12 under body
    // leading 30 made every body joint fire. The clustered mode reads 30.
    const lines = [
      para(300, 40, 260),
      para(270, 40, 260),
      para(240, 40, 260),
      para(210, 40, 260),
      para(180, 40, 260),
      para(96, 40, 260, 8),
      para(84, 40, 260, 8),
    ];
    markParagraphBreaks(lines);
    expect(lines.slice(0, 5).map((l) => l.paraEnd)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(lines[5]!.paraEnd).toBe(false);
    expect(lines[6]!.paraEnd).toBe(true);
  });

  it("breaks on a raised gap when the line ends short (dialogue page)", () => {
    const lines = [para(300, 40, 260), para(270, 40, 150), para(234, 40, 260)];
    markParagraphBreaks(lines);
    expect(lines[0]!.paraEnd).toBe(false);
    expect(lines[1]!.paraEnd).toBe(true);
    expect(lines[2]!.paraEnd).toBe(true);
  });

  it("breaks on a raised gap when the next line is indented", () => {
    const lines = [para(300, 40, 260), para(270, 40, 150), para(234, 52, 260)];
    markParagraphBreaks(lines);
    expect(lines[1]!.paraEnd).toBe(true);
    expect(lines[2]!.paraEnd).toBe(true);
  });

  it("uniform leading without signals keeps the whole run one paragraph", () => {
    const lines = [para(300, 40, 260), para(270, 40, 260), para(240, 40, 260)];
    markParagraphBreaks(lines);
    expect(lines.map((l) => l.paraEnd)).toEqual([false, false, true]);
  });
});
