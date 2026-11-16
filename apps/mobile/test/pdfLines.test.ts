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

const para = (
  baseline: number,
  left: number,
  right: number,
  text: string,
  fontPx = 12
) => ({
  baseline,
  left,
  right,
  fontPx,
  text,
  paraEnd: false,
});

describe("markParagraphBreaks", () => {
  it("keeps body lines coherent when a tighter-set block drags the min down", () => {
    // The min-based defect: a footnote pair at leading 12 under body
    // leading 30 made every body joint fire. The clustered mode reads 30;
    // no body line ends a sentence, so nothing fires but the real ends.
    const lines = [
      para(300, 40, 260, "body line one of the"),
      para(270, 40, 260, "body line two of the"),
      para(240, 40, 260, "body line three of"),
      para(210, 40, 260, "body line four of the"),
      para(180, 40, 260, "body line five ends here."),
      para(96, 40, 260, "footnote line one of", 8),
      para(84, 40, 260, "footnote line two.", 8),
    ];
    markParagraphBreaks(lines);
    expect(lines.slice(0, 4).map((l) => l.paraEnd)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Body-final ends a sentence (and the footnote's own end does too).
    expect(lines[4]!.paraEnd).toBe(true);
    expect(lines[6]!.paraEnd).toBe(true);
  });

  it("a turn-end (short + sentence-final) closes its dialogue paragraph", () => {
    // The Camille-class convention: dialogue turns start on new print
    // lines and end short of the right margin with sentence punctuation
    // — no spacing, no indent. With the round-18 flow rendering this
    // fires as a paragraph gap, never as a hard chop.
    const lines = [
      para(300, 40, 260, "body line running to the margin,"),
      para(270, 40, 150, '"Yes."'),
      para(234, 40, 260, "the next paragraph starts here,"),
    ];
    markParagraphBreaks(lines);
    expect(lines[0]!.paraEnd).toBe(false);
    expect(lines[1]!.paraEnd).toBe(true);
    expect(lines[2]!.paraEnd).toBe(true);
  });

  it("a lone closing quote is not a sentence end — only a closer after one is", () => {
    // The v5 contract (短行∧句末标点): `words "Well,"` ends on a quote
    // riding a COMMA — the quote is not sentence-final punctuation, the
    // short line stays mid-paragraph (the old class let the bare quote
    // fire the turn end). The closer-after-punct forms still fire.
    const lines = [
      para(300, 40, 260, "body line running to the margin,"),
      para(270, 40, 130, 'words "Well,"'),
      para(244, 40, 260, "and the sentence runs on,"),
      para(214, 40, 120, 'then closed the thought."'),
      para(184, 40, 260, "a fresh paragraph starts here,"),
    ];
    markParagraphBreaks(lines);
    expect(lines[0]!.paraEnd).toBe(false);
    // Quote-after-comma: no break.
    expect(lines[1]!.paraEnd).toBe(false);
    expect(lines[2]!.paraEnd).toBe(false);
    // A closer AFTER sentence punctuation still ends the turn.
    expect(lines[3]!.paraEnd).toBe(true);
  });

  it("breaks where the next line is indented with a raised gap", () => {
    const lines = [
      para(300, 40, 260, "body line running to the margin,"),
      para(270, 40, 150, "a body line ends here"),
      para(234, 52, 260, "an indented new paragraph,"),
    ];
    markParagraphBreaks(lines);
    expect(lines[1]!.paraEnd).toBe(true);
    expect(lines[2]!.paraEnd).toBe(true);
  });

  it("baseline jitter alone never fires (the Camille page)", () => {
    // Camille p21's real steps: 14.9-19.7 around leading ~16.6 — the old
    // fixed thresholds fired every third joint on these.
    const baselines = [739.0, 722.4, 707.5, 692.4, 675.8, 657.8, 639.1, 619.7];
    const rights = [537.3, 524.0, 522.8, 509.9, 178.4, 495.0, 317.1, 366.3];
    const texts = [
      '"Have no fear; I shall be',
      "to carry out a resolution",
      "myself again until I have",
      "dream, a moment's delirium",
      'having seen, I will see."',
      '"I understand," I said to',
      '"Yes, I saw her the day',
      '"Did she give you the pap',
    ];
    const lines = baselines.map((baseline, i) =>
      para(baseline, 63.4, rights[i]!, texts[i]!)
    );
    markParagraphBreaks(lines);
    // The Camille page: jitter 14.9-19.7 alone never fires (the old
    // fixed thresholds fired on its peaks every third joint); only the
    // turn-end (short + sentence-final "having seen, I will see.\"")
    // and the page's last line close paragraphs.
    expect(lines.map((l) => l.paraEnd)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });
});

// The thresholds' boundary catchers (evidence gap ⑨): the four fixtures
// above sit far from 1.45/1.05, so 1.45→1.4 (tighter, fires MORE) and
// 1.05→1.12 (looser, fires LESS) both left every assertion unchanged.
// These sit exactly between the mutant and the contract.
describe("markParagraphBreaks — threshold boundaries", () => {
  it("a raised gap just under 1.45×leading stays mid-paragraph (a 1.4 mutant fires it)", () => {
    // Body leading 30; L2→L3 gap 42.3 sits between 1.40×30=42 and
    // 1.45×30=42.5: the contract says NO break.
    const lines = [
      para(300, 40, 260, "body line one runs on,"),
      para(270, 40, 260, "body line two runs on,"),
      para(240, 40, 260, "body line three runs on,"),
      para(197.7, 40, 260, "still the same paragraph,"),
      para(167.7, 40, 260, "and it closes here, properly."),
    ];
    markParagraphBreaks(lines);
    expect(lines[2]!.paraEnd).toBe(false);
    // Sanity both sides of the line: 1.48×30=44.4 DOES fire (same body
    // leading around it — a two-line fixture's cluster would be the gap
    // itself).
    const over = [
      para(300, 40, 260, "body line one runs on,"),
      para(270, 40, 260, "body line two runs on,"),
      para(240, 40, 260, "body line three runs on,"),
      para(195.6, 40, 260, "a fresh paragraph starts."),
      para(165.6, 40, 260, "and keeps running here."),
    ];
    markParagraphBreaks(over);
    expect(over[2]!.paraEnd).toBe(true);
  });

  it("an indent pair just over 1.05×leading breaks (a 1.12 mutant misses it)", () => {
    // Indented next line with gap 32.4 sits between 1.05×30=31.5 and
    // 1.12×30=33.6: the contract says BREAK.
    const lines = [
      para(300, 40, 260, "body line one runs on,"),
      para(270, 40, 260, "body line two runs on,"),
      para(240, 40, 260, "body line three runs on,"),
      para(207.6, 50, 260, "indented continuation."),
    ];
    markParagraphBreaks(lines);
    expect(lines[2]!.paraEnd).toBe(true);
  });
});
