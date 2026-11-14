import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { WORD_PATTERN } from "@lingualeaf/reading-model";

// The sole eligibility/indexing/normalization rule for rendering and anchors.
//
// A unit is a VISUAL LINE, not a TextItem (mobile-app ticket 03): real
// books arrive as glyph-per-item streams — Camille measured 922 items on
// page 1 across 16 baselines (83 on one line), which turned the old
// one-pen-per-item rule into a page of pens and shattered word spans.
// Items sharing a baseline (within a font-relative tolerance) merge into
// one line, x-ordered. Spaces come from two sources: whitespace
// TextItems join verbatim, and — because some generators drop the space
// glyph entirely — letter-to-letter joints whose x-gap reaches 0.15 of
// the font size gain a synthesized space (Camille, 20 pages measured:
// kerning tops out ≤0.14 with the mass at ≤0.08; dropped spaces sit at
// 0.16–0.18, a clean valley between). The extension copy keeps the
// per-item rule (D12: 扩展本体不动).
//
// Empty items and marked-content entries participate in nothing;
// punctuation-only lines consume no index.

export type PdfLine = {
  // The line's member items, x-ordered — the render loop reads each
  // item's geometry (transform/width) to place the merged line.
  items: TextItem[];
  lineIndex: number;
  lineText: string;
  matches: RegExpMatchArray[];
};

// The gap, in font-size units, past which two letter-boundary items are
// read as a dropped space rather than tracking (measured, see above).
const MISSING_SPACE_GAP = 0.15;

const fontPxOf = (item: TextItem): number =>
  Math.hypot(item.transform[2], item.transform[3]);

const normalizeItemText = (str: string): string =>
  str.normalize("NFC").replace(/\r\n?/g, "\n");

const isLetter = (ch: string | undefined): boolean =>
  ch !== undefined && /\p{L}/u.test(ch);

type Cluster = { baseline: number; fontPx: number; items: TextItem[] };

function clusterIntoVisualLines(items: TextContent["items"]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const raw of items) {
    if (!("str" in raw) || raw.str === "") continue;
    const fontPx = fontPxOf(raw);
    const baseline = raw.transform[5];
    const cluster = clusters.find(
      (candidate) =>
        Math.abs(candidate.baseline - baseline) <=
        Math.max(candidate.fontPx, fontPx) * 0.25 + Number.EPSILON
    );
    if (cluster) {
      cluster.items.push(raw);
      if (fontPx > cluster.fontPx) cluster.fontPx = fontPx;
    } else {
      clusters.push({ baseline, fontPx, items: [raw] });
    }
  }
  // Reading order for standard pages: higher text-space baseline first
  // (y grows upward), ties by the first item's x.
  return clusters.sort(
    (a, b) =>
      b.baseline - a.baseline ||
      a.items[0]!.transform[4] - b.items[0]!.transform[4]
  );
}

export function eligiblePdfLines(items: TextContent["items"]): PdfLine[] {
  const lines: PdfLine[] = [];
  for (const cluster of clusterIntoVisualLines(items)) {
    const ordered = [...cluster.items].sort(
      (a, b) => a.transform[4] - b.transform[4]
    );
    // The join: verbatim per item, plus the gap-recovered space at
    // letter-to-letter joints (whitespace items need no heuristic).
    let lineText = "";
    let previous: TextItem | undefined;
    for (const item of ordered) {
      const piece = normalizeItemText(item.str);
      if (
        previous !== undefined &&
        isLetter(lineText.slice(-1)) &&
        isLetter(piece[0]) &&
        (item.transform[4] - (previous.transform[4] + previous.width)) /
          cluster.fontPx >=
          MISSING_SPACE_GAP
      ) {
        lineText += " ";
      }
      lineText += piece;
      previous = item;
    }
    const matches = [...lineText.matchAll(WORD_PATTERN)];
    if (!matches.length) continue;
    lines.push({
      items: ordered,
      lineIndex: lines.length,
      lineText,
      matches,
    });
  }
  return lines;
}
