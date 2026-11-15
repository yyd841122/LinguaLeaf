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

// Paragraph grouping (mobile-app ticket 03, rounds 16-18): where does
// one paragraph end? After live book forensics (Camille: ragged right,
// no paragraph spacing, no indent — baselines jitter 14.9-19.7 with NO
// paragraph gaps, the print itself is continuous), the honest rule is
// minimal-harm: break ONLY on unambiguous geometric evidence.
//   1. RAISED GAP: a baseline step past 1.45× the body leading — the
//      body leading being the MODE of the page's baseline steps
//      (clustered; a tightly-set footnote block must not drag the
//      estimate down and chop every body line).
//   2. INDENT: the next line starts clearly right of the column's left
//      margin with even a slightly-raised step — indent-marked books.
// Everything else reads continuous — exactly like the book's own print.
// Sentence-final short lines are NOT a signal: multi-sentence paragraphs
// carry sentence ends mid-paragraph (round 17's SHORT+SENT chopped
// Camille every three lines on them).

export type ParagraphLine = {
  baseline: number;
  left: number;
  right: number;
  fontPx: number;
  paraEnd: boolean;
};

const clusterValue = (sorted: number[], tolerance: number): number => {
  // The dominant cluster's center: walk the sorted values, extend the
  // current cluster while members sit within tolerance of its head, and
  // keep the head of the largest cluster.
  let bestHead = sorted[0]!;
  let bestCount = 1;
  let head = sorted[0]!;
  let count = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - head <= tolerance) {
      count++;
      if (count > bestCount) {
        bestCount = count;
        bestHead = head;
      }
    } else {
      head = sorted[i]!;
      count = 1;
    }
  }
  return bestHead;
};

export function markParagraphBreaks(lines: ParagraphLine[]): void {
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1]!.baseline - lines[i]!.baseline;
    if (d > 0) deltas.push(d);
  }
  const leading = clusterValue(
    [...deltas].sort((a, b) => a - b),
    deltas.length ? deltas[0]! * 0.12 + Number.EPSILON : 0
  );
  // The column's left margin is the EXTREME, not a mode — a ragged-left
  // page would collapse a mode onto an indented line and blind the
  // indent signal.
  const columnLeft = lines.length
    ? Math.min(...lines.map((line) => line.left))
    : 0;
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (!next) {
      lines[i]!.paraEnd = true;
      continue;
    }
    const d = lines[i]!.baseline - next.baseline;
    if (!(d > 0)) {
      lines[i]!.paraEnd = false;
      continue;
    }
    const indented = next.left > columnLeft + next.fontPx * 0.6;
    lines[i]!.paraEnd = d > leading * 1.45 || (indented && d > leading * 1.05);
  }
}
