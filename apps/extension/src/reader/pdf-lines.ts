import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { WORD_PATTERN } from "@lingualeaf/reading-model";

// The sole eligibility/indexing/normalization rule for rendering and anchors.
// Empty items, marked-content entries and punctuation-only items consume no index.
export function eligiblePdfLines(items: TextContent["items"]): {
  item: TextItem;
  lineIndex: number;
  lineText: string;
  matches: RegExpMatchArray[];
}[] {
  const lines = [];
  for (const item of items) {
    if (!("str" in item)) continue;
    const lineText = item.str.normalize("NFC").replace(/\r\n?/g, "\n");
    if (!lineText.trim()) continue;
    const matches = [...lineText.matchAll(WORD_PATTERN)];
    if (!matches.length) continue;
    lines.push({ item, lineIndex: lines.length, lineText, matches });
  }
  return lines;
}
