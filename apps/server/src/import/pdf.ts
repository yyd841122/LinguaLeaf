import {
  extractTextItems,
  getDocumentProxy,
  getMeta,
  type StructuredTextItem,
} from "unpdf";
import type { PreparedBook } from "./pipeline.js";

// Single source of truth for what counts as a PDF book file.
export const PDF_EXTENSION = /\.pdf$/i;

export function isPdfFilename(filename: string): boolean {
  return PDF_EXTENSION.test(filename);
}

// A structurally broken or unsupported PDF — unparseable bytes. The router
// reports this class as 400, mirroring EpubParseError; the scan gate has its
// own class (ScannedPdfError) with its own status, and encryption its own
// subclass so the body can carry the 加密 文案 verbatim.
export class PdfParseError extends Error {}

// A password-protected PDF (spec: 加密 PDF 暂不支持). Still a 400 — the
// upload itself is fine but can never import — but its body carries the
// stable encrypted-pdf code beside the 文案, not the generic invalid-PDF
// prefix.
export class EncryptedPdfError extends PdfParseError {}

// A PDF whose text layer is too sparse to read (scan detection). The router
// reports this class as 422 with the reader-facing 文案, and no book is
// created — the rejection happens before any row exists.
export class ScannedPdfError extends Error {}

// A page whose cleaned text is shorter than this many characters counts as
// scan-shaped; the book is rejected when the median page sits below it.
// Conservative on purpose (spec: 倾向保守) — half-OCR'd books must not slip
// in as silently corrupted books. Exactly-at-threshold passes.
export const SCAN_PAGE_MEDIAN_THRESHOLD = 100;

// An uploaded file is bounded at 20MB, but that says nothing about page
// count; a pathological page-per-byte PDF could pin the event loop in
// extraction. The cap keeps the synchronous POST bounded.
export const MAX_PDF_PAGES = 2000;

const PAGES_PER_CHAPTER = 10;

// Outlines are hand-authored; a corrupt file must not recurse without end.
const MAX_OUTLINE_DEPTH = 64;

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineItem = {
  title: string;
  dest: unknown;
  items: OutlineItem[];
};
type ChapterStart = { title: string; pageIndex: number };

// Both arguments are zero-based inclusive page indices; the title prints
// the one-based range readers see in a PDF viewer.
const pageRangeTitle = (firstPage: number, lastPage: number): string =>
  `第 ${firstPage + 1}–${lastPage + 1} 页`;

// Destinations can name an entry in the document's destination tree, point
// directly to a page object, or use a zero-based page index. External links
// and broken targets cannot delimit local chapters; their children can.
async function destinationPage(
  pdf: PdfDocument,
  destination: unknown
): Promise<number | null> {
  try {
    const resolved: unknown =
      typeof destination === "string"
        ? await pdf.getDestination(destination)
        : destination;
    if (!Array.isArray(resolved)) return null;
    const target: unknown = resolved[0];
    let index;
    if (typeof target === "number") {
      index = target;
    } else if (
      target !== null &&
      typeof target === "object" &&
      "num" in target &&
      typeof target.num === "number" &&
      "gen" in target &&
      typeof target.gen === "number"
    ) {
      index = await pdf.getPageIndex({ num: target.num, gen: target.gen });
    } else {
      return null;
    }
    return Number.isInteger(index) && index >= 0 && index < pdf.numPages
      ? index
      : null;
  } catch {
    // A stale bookmark must not prevent importing the book's text layer.
    return null;
  }
}

async function chapterStarts(pdf: PdfDocument): Promise<ChapterStart[]> {
  // An unreadable outline degrades to page-range chapters — the same
  // tolerance as a single stale bookmark below; the text layer is what
  // must import.
  let outline: OutlineItem[] | null = null;
  try {
    outline = await pdf.getOutline();
  } catch {
    outline = null;
  }
  const starts: ChapterStart[] = [];
  const visit = async (items: OutlineItem[], depth: number): Promise<void> => {
    if (depth > MAX_OUTLINE_DEPTH) return;
    for (const item of items) {
      const pageIndex = await destinationPage(pdf, item.dest);
      if (pageIndex !== null) starts.push({ title: item.title, pageIndex });
      await visit(item.items, depth + 1);
    }
  };
  await visit(outline ?? [], 1);
  // Physical page order gives disjoint ranges even when the outline lists
  // targets out of order. Stable sorting preserves same-page bookmarks:
  // each still opens a chapter, with the last receiving that page's text.
  starts.sort((left, right) => left.pageIndex - right.pageIndex);
  const first = starts[0];
  if (first && first.pageIndex > 0) {
    starts.unshift({
      title: pageRangeTitle(0, first.pageIndex - 1),
      pageIndex: 0,
    });
  }
  if (starts.length === 0) {
    for (let index = 0; index < pdf.numPages; index += PAGES_PER_CHAPTER) {
      starts.push({
        title: pageRangeTitle(
          index,
          Math.min(index + PAGES_PER_CHAPTER, pdf.numPages) - 1
        ),
        pageIndex: index,
      });
    }
  }
  return starts;
}

// Ligature code points print as single glyphs but must read as their
// letter sequences in 原文行 (spec: ﬁ → fi).
const LIGATURES: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
};

const normalizeLigatures = (text: string): string =>
  text.replace(/[ﬀ-ﬄ]/g, (glyph) => LIGATURES[glyph] ?? glyph);

// A line ending in a hyphen followed by a line starting with a letter is a
// typeset break inside a word (exam-\nple → example). Genuine hyphenated
// compounds broken at the margin (well-\nknown) come out joined without
// their hyphen — a known v1 tradeoff, far rarer than typeset breaks.
const endsWithSoftBreak = (line: string): boolean => /[­-]$/.test(line);
const startsWithLetter = (line: string): boolean => /^[A-Za-z]/.test(line);

// Folds a run of lines into flowing text: soft-broken words fuse across the
// break, everything else joins with a single space, and runs of whitespace
// collapse. Page boundaries go through the same fold, so a sentence split
// across pages stays one sentence.
const foldLines = (lines: string[]): string => {
  let text = "";
  for (const line of lines) {
    if (text !== "" && endsWithSoftBreak(text) && startsWithLetter(line)) {
      text = text.slice(0, -1) + line;
    } else if (text === "") {
      text = line;
    } else {
      text += ` ${line}`;
    }
  }
  return text.replace(/\s+/g, " ").trim();
};

// Reassembles printed lines from the text items: pdf.js flags the item that
// closes a line with hasEOL (spec: 行重建 — printed breaks must never become
// sentence boundaries, sbd runs with newline_boundaries).
const linesFromItems = (items: StructuredTextItem[]): string[] => {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    current += normalizeLigatures(item.str);
    if (item.hasEOL) {
      lines.push(current);
      current = "";
    }
  }
  if (current.trim() !== "") lines.push(current);
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
};

// Running-head removal (spec: 重复页眉/页脚/页码行剔除). Only the first and
// last two lines of each page are candidates — real headers and footers sit
// at the margins, and a short line repeated mid-page is content (a refrain)
// that must survive. A candidate drops when its 归一化文本 (case-folded,
// whitespace-collapsed) repeats across ≥3 pages — headers that drift in
// punctuation across pages survive, a known v1 edge. Pure-number candidates
// (page folios, which differ per page) drop when they appear on ≥3 pages.
// Books under three pages prove nothing.
const isMarginLine = (lines: string[], index: number): boolean =>
  index <= 1 || index >= lines.length - 2;

const isFolio = (line: string): boolean => /^\d{1,4}$/.test(line);

const dropRunningHeads = (pages: string[][]): string[][] => {
  const repeatedTexts = new Map<string, Set<number>>();
  const folioPages = new Set<number>();
  pages.forEach((lines, pageIndex) => {
    lines.forEach((line, index) => {
      if (!isMarginLine(lines, index)) return;
      if (isFolio(line)) {
        folioPages.add(pageIndex);
        return;
      }
      const key = line.toLowerCase();
      const seen = repeatedTexts.get(key) ?? new Set<number>();
      seen.add(pageIndex);
      repeatedTexts.set(key, seen);
    });
  });
  const dropFolios = folioPages.size >= 3;
  const repeated = new Set(
    [...repeatedTexts]
      .filter(([, seen]) => seen.size >= 3)
      .map(([text]) => text)
  );
  if (!dropFolios && repeated.size === 0) return pages;
  return pages.map((lines) =>
    lines.filter(
      (line, index) =>
        !isMarginLine(lines, index) ||
        (isFolio(line) ? !dropFolios : !repeated.has(line.toLowerCase()))
    )
  );
};

// One mapping for every unpdf failure: password-protected documents get
// the 加密 文案, everything else (broken bytes, corrupt page tree) is a
// broken upload in the 400 family — never a server fault.
const asParseError = (error: unknown): PdfParseError =>
  (error as { name?: string } | null)?.name === "PasswordException"
    ? new EncryptedPdfError("加密 PDF 暂不支持")
    : new PdfParseError("not a valid PDF file");

// The PDF front half of the import: extract the text layer and hand the
// shared pipeline a PreparedBook shaped like the EPUB front half's, so
// everything past this point (sentences → IPA → translation → insert) is
// one code path. Bookmarks delimit chapters by physical page; books with
// no usable local bookmarks get fixed-size page ranges.
export async function readPdfBook(
  content: Buffer,
  filename: string
): Promise<PreparedBook> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(content));
  } catch (error) {
    throw asParseError(error);
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new PdfParseError(`PDF has more than ${MAX_PDF_PAGES} pages`);
    }

    let items;
    try {
      ({ items } = await extractTextItems(pdf));
    } catch (error) {
      // A document that opens but fails mid-extraction (corrupt page tree,
      // unreadable xref) is still a broken upload, not a server fault.
      throw asParseError(error);
    }
    const pageTexts = dropRunningHeads(
      items.map((pageItems) => linesFromItems(pageItems))
    ).map((lines) => foldLines(lines));

    // Scan gate on the cleaned per-page lengths: a text book with a cover
    // or blank page still passes (the median rides on the text pages), an
    // image-only PDF fails with room to spare.
    const lengths = pageTexts.map((text) => text.length);
    const sorted = [...lengths].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const upper = sorted[middle];
    // Unreachable in practice — a parsed PDF always has at least one page —
    // but keeps the median total without assertions.
    if (upper === undefined) {
      throw new PdfParseError("PDF has no readable pages");
    }
    const lower = sorted[middle - 1] ?? upper;
    const median = sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
    if (median < SCAN_PAGE_MEDIAN_THRESHOLD) {
      throw new ScannedPdfError("扫描件/图片型 PDF 暂不支持");
    }

    // Metadata title, falling back to the upload's file name — the chapter
    // heading fallback in deriveBookTitle does not apply to PDFs.
    let title = "";
    try {
      const { info } = await getMeta(pdf);
      if (typeof info.Title === "string") title = info.Title.trim();
    } catch {
      // A PDF with unreadable metadata still imports under its file name.
    }
    if (title === "") title = filename.replace(PDF_EXTENSION, "");

    const starts = await chapterStarts(pdf);
    return {
      title,
      format: "pdf",
      pageCount: pdf.numPages,
      chapters: starts.map((start, index) => {
        const end = starts[index + 1]?.pageIndex ?? pdf.numPages;
        const text = foldLines(pageTexts.slice(start.pageIndex, end));
        return {
          title: start.title,
          level: null,
          items: text === "" ? [] : [{ kind: "paragraph", text }],
        };
      }),
    };
  } finally {
    // The proxy's lifecycle rides on its loading task in pdf.js — destroying
    // the task frees the parsed document (worker state, cached pages).
    await pdf.loadingTask.destroy();
  }
}
