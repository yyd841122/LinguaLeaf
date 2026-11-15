// The PDF half of the reader (ticket 06, per ticket 01's verdict: in-place
// overlay). pdf.js renders the page; getTextContent is walked into WORDS
// the same way the spike proved out, and each word gets its IPA from the
// offline dictionary — the same 标注管线 as EPUB (one dictionary, one
// lookup rule), just positioned instead of reflowed.
//
// The LEGACY build (mobile-app ticket 03): the standard build's main and
// worker threads both call Promise.withResolvers (Chromium 119+); the
// legacy build ships the polyfill, so an aging Android System WebView
// stays in range. Same engine, same API — only the bundle differs. The
// module worker itself is safe: Capacitor's WebViewLocalServer maps .mjs
// to application/javascript (new Worker(url, {type:"module"}) verifies
// JS MIME).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { IpaLookup } from "@lingualeaf/import-core";
import { eligiblePdfLines } from "./pdf-lines";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSession = {
  doc: PDFDocumentProxy;
  title: string;
  pageCount: number;
};

// The rejection vocabulary is the shared import chain's: pdf.js's native
// failures map onto the wire reasons the page's copy map already speaks.
// null = nothing shared matches; the caller rethrows the original.
export function classifyPdfError(
  error: unknown
): "encrypted-pdf" | "invalid-pdf" | null {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return "encrypted-pdf";
  if (name === "InvalidPDFException") return "invalid-pdf";
  return null;
}

// 扫描版检测 (GLOSSARY 书: 文本层完好方可导入): a page with (nearly) no
// text items is an image. Mirrors the server's text-length heuristic —
// the first pages decide, the average is what counts (one blank cover
// page must not condemn a real book).
export function detectScanned(pageTextLengths: number[]): boolean {
  if (pageTextLengths.length === 0) return true;
  const sample = pageTextLengths.slice(0, 3);
  const average = sample.reduce((sum, n) => sum + n, 0) / sample.length;
  return average < 15;
}

export async function openPdf(
  bytes: ArrayBuffer,
  filename: string
): Promise<PdfSession> {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const meta = await doc.getMetadata();
    const infoTitle =
      meta.info && "Title" in meta.info
        ? String((meta.info as { Title?: unknown }).Title ?? "").trim()
        : "";
    return {
      doc,
      title: infoTitle || filename.replace(/\.pdf$/i, ""),
      pageCount: doc.numPages,
    };
  } catch (error) {
    await doc.destroy();
    throw error;
  }
}

// The first pages' text lengths, for the scanned check (empty pages count
// as zero; an unreadable page fails the open, not the check).
export async function sampleTextLengths(
  doc: PDFDocumentProxy,
  pages = 3
): Promise<number[]> {
  const lengths: number[] = [];
  for (let n = 1; n <= Math.min(pages, doc.numPages); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    lengths.push(
      content.items.reduce(
        (sum, item) => sum + ("str" in item ? item.str.length : 0),
        0
      )
    );
    page.cleanup();
  }
  return lengths;
}

// One visual line's placed geometry — the facts the bookmark marker and
// the jump scroll need (ticket 03 人验 round 4): the band the mark hangs
// on and the line's own text for display, all in overlay px.
export type PdfLineGeo = {
  lineIndex: number;
  top: number;
  height: number;
  right: number;
  text: string;
};

export type PdfRender = {
  wordCount: number;
  ipaCount: number;
  lines: PdfLineGeo[];
};

// Render one page onto the canvas and lay the word/IPA overlay over it.
// Renders serialize on one promise chain — pdf.js rejects a render()
// while the same canvas has one running, and a page flip or zoom click
// can easily outrun the previous render; the token then drops stale
// applications. Word spans carry data-word so the popup seam (ticket 04)
// works verbatim.
let renderQueue = Promise.resolve();

// A line split at its WORD_PATTERN matches, every segment (word or gap)
// carrying a proportional width share from canvas measureText.
type LineSegment = { word?: string; share: number };

const measureCanvas =
  typeof document === "undefined" ? null : document.createElement("canvas");
const measureContext = measureCanvas?.getContext("2d") ?? null;

function segmentLine(
  str: string,
  matches: RegExpMatchArray[],
  fontPx: number
): LineSegment[] {
  const segments: LineSegment[] = [];
  let cursor = 0;
  if (measureContext) {
    measureContext.font = `${fontPx}px Arial, Helvetica, sans-serif`;
  }
  const shareOf = (piece: string): number =>
    measureContext ? measureContext.measureText(piece).width : piece.length;
  for (const match of matches) {
    const start = match.index ?? cursor;
    if (start > cursor) {
      segments.push({ share: shareOf(str.slice(cursor, start)) });
    }
    segments.push({ word: match[0], share: shareOf(match[0]) });
    cursor = start + match[0].length;
  }
  if (cursor < str.length) {
    segments.push({ share: shareOf(str.slice(cursor)) });
  }
  return segments;
}

export function renderPdfPage(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  lookup: IpaLookup,
  showIpa: boolean
): Promise<PdfRender> {
  const ticket = invalidatePdfRender(overlay);
  const run = renderQueue.then(() =>
    renderPdfPageStep(
      canvas,
      overlay,
      doc,
      pageNumber,
      scale,
      lookup,
      showIpa,
      ticket
    )
  );
  renderQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const emptyRender = (): PdfRender => ({ wordCount: 0, ipaCount: 0, lines: [] });

async function renderPdfPageStep(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  lookup: IpaLookup,
  showIpa: boolean,
  ticket: object
): Promise<PdfRender> {
  if (renderTickets.get(overlay) !== ticket) return emptyRender();
  const page = await doc.getPage(pageNumber);
  try {
    if (renderTickets.get(overlay) !== ticket) return emptyRender();
    // HiDPI: the backing store renders at device pixels while the canvas's
    // CSS size stays at the viewport's — otherwise a 125%/150% Windows
    // display scales the 1x bitmap up and the text goes soft (the blur the
    // real-Edge acceptance caught once the DOM words went transparent).
    //
    // Fit-width (ticket 03 人验 round 5): scale 1 reads as "fill the
    // reader's content width" on a real screen — the PDF-unit page (612px
    // on a ~400px phone) forced horizontal panning at every zoom step.
    // The stored multiplier applies on top of the fit; jsdom has no main
    // ancestor and falls back to multiplier-only, keeping the contract
    // tests' math. Orientation changes re-fit on the next render.
    const main = canvas.closest("main");
    let fit = 1;
    if (main) {
      const style = window.getComputedStyle(main);
      const padding =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const width = main.clientWidth - (Number.isNaN(padding) ? 0 : padding);
      if (width > 0) fit = width / page.getViewport({ scale: 1 }).width;
    }
    const effective = fit * scale;
    const viewport = page.getViewport({ scale: effective });
    const outputScale = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = viewport.width * outputScale;
    canvas.height = viewport.height * outputScale;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d context unavailable");
    await page.render({
      canvasContext: context,
      viewport,
      transform:
        outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    }).promise;
    const content = await page.getTextContent();
    if (renderTickets.get(overlay) !== ticket) {
      return emptyRender();
    }
    clearPdfOverlay(overlay);
    // Pass 1 — geometry for every eligible line. Where each line's IPA
    // goes needs the NEXT line's top, so all geometry settles before any
    // span is built.
    const measured = [...eligiblePdfLines(content.items)].map((line) => {
      // Merged visual line (pdf-lines): the geometry spans every member
      // item — the origin is the leftmost x, the end the rightmost item's
      // right edge, the font the line's largest. One-item lines (the
      // lucky layout) reduce to the same numbers the per-item math gave.
      const transforms = line.items.map((text) =>
        Util.transform(viewport.transform, text.transform)
      );
      const fontPx = Math.max(
        ...transforms.map((tx) => Math.hypot(tx[2], tx[3]))
      );
      const lineX = Math.min(...transforms.map((tx) => tx[4]));
      const baseline = transforms[0]![5];
      const lineEnd = Math.max(
        ...line.items.map(
          (text, i) => transforms[i]![4] + text.width * effective
        )
      );
      return {
        line,
        fontPx,
        lineX,
        baseline,
        lineEnd,
        top: baseline - fontPx,
      };
    });
    // IPA placement (ticket 03 人验 round 6): the band below a word
    // belongs to the NEXT line on a fixed page — an IPA hung there with
    // its near-opaque chip crushes the neighbor's glyphs (the fit-width
    // defect). Where the measured gap to the next line leaves room the
    // IPA keeps its below band; where it doesn't, it shrinks to a
    // translucent chip over the word's own upper band and never touches
    // the neighbor. The page's last line always has room below.
    const ipaBelow = new Map<number, boolean>();
    for (const [i, entry] of measured.entries()) {
      const nextTop = measured[i + 1]?.top;
      const gap =
        nextTop === undefined ? Infinity : nextTop - (entry.top + entry.fontPx);
      ipaBelow.set(entry.line.lineIndex, gap >= entry.fontPx * 0.62 + 3);
    }
    let wordCount = 0;
    let ipaCount = 0;
    const lines: PdfLineGeo[] = [];
    for (const { line, fontPx, lineX, baseline, lineEnd, top } of measured) {
      const { lineIndex, lineText, matches } = line;
      const below = ipaBelow.get(lineIndex) ?? true;
      // Proportional placement: uniform per-character splitting drifts badly
      // on proportional fonts (the hover box lands off the word). Measure
      // every segment (words AND the gaps between them) with an offscreen
      // canvas and rescale so the line's total stays exactly the line's
      // span — the one exact fact pdf.js gives us. Residual error is only
      // the metric difference between the measuring font and the embedded
      // one.
      lines.push({
        lineIndex,
        top,
        height: fontPx,
        right: lineEnd,
        text: lineText,
      });
      const segments = segmentLine(lineText, matches, fontPx);
      const totalShare = segments.reduce((sum, seg) => sum + seg.share, 0);
      const k = (lineEnd - lineX) / totalShare;
      let offset = 0;
      for (const segment of segments) {
        const width = segment.share * k;
        if (segment.word) {
          const piece = segment.word;
          const left = lineX + offset;
          const word = document.createElement("span");
          word.className = "pdf-word";
          word.style.left = `${left}px`;
          word.style.top = `${top}px`;
          word.style.fontSize = `${fontPx}px`;
          word.dataset.pdfWord = piece;
          word.dataset.pdfLineIndex = String(lineIndex);
          word.setAttribute("data-word", piece);
          word.setAttribute("role", "button");
          word.setAttribute("tabindex", "0");
          word.textContent = piece;
          if (showIpa) {
            const ipa = lookup(piece);
            const ipaEl = document.createElement("span");
            ipaEl.className = below ? "pdf-ipa" : "pdf-ipa pdf-ipa-tight";
            ipaEl.dataset.ipa = ipa ?? "";
            ipaEl.style.left = `${width / 2}px`;
            ipaEl.style.top = below ? `${fontPx + 2}px` : `${fontPx * 0.12}px`;
            ipaEl.textContent = ipa ?? "";
            if (ipa) ipaCount += 1;
            word.appendChild(ipaEl);
          }
          overlay.appendChild(word);
          wordCount += 1;
        }
        offset += width;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pdf-note-button block-note-button";
      button.dataset.pdfNote = String(lineIndex);
      button.dataset.lineText = lineText;
      button.style.left = `${lineEnd + 6}px`;
      button.style.top = `${baseline - fontPx}px`;
      button.style.fontSize = `${fontPx}px`;
      button.setAttribute("aria-label", "写笔记");
      button.disabled = true; // The host enables only after its notes read settles.
      button.textContent = "✎";
      overlay.appendChild(button);
    }
    return { wordCount, ipaCount, lines };
  } finally {
    page.cleanup();
  }
}

const renderTickets = new WeakMap<HTMLElement, object>();

// Called on navigation intent and teardown, including while a render is queued.
export function invalidatePdfRender(overlay: HTMLElement): object {
  const ticket = {};
  renderTickets.set(overlay, ticket);
  return ticket;
}

export function clearPdfOverlay(overlay: HTMLElement): void {
  for (const layer of overlay.querySelectorAll(
    "[data-pdf-word], [data-pdf-note]"
  ))
    layer.remove();
}

export async function destroyPdf(session: PdfSession): Promise<void> {
  // pdf.js holds the worker and page caches until destroyed — skipping
  // this leaks both per opened book (pdfjs-extraction gotchas).
  await session.doc.destroy();
}
