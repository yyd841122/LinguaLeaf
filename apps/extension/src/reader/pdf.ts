// The PDF half of the reader (ticket 06, per ticket 01's verdict: in-place
// overlay). pdf.js renders the page; getTextContent is walked into WORDS
// the same way the spike proved out, and each word gets its IPA from the
// offline dictionary — the same 标注管线 as EPUB (one dictionary, one
// lookup rule), just positioned instead of reflowed.
import * as pdfjsLib from "pdfjs-dist";
import { Util } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { IpaLookup } from "@lingualeaf/import-core";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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

export type PdfRender = { wordCount: number; ipaCount: number };

// Render one page onto the canvas and lay the word/IPA overlay over it.
// renderToken drops stale renders (zoom/page flips outrun pdf.js); the
// word spans carry data-word so the popup seam (ticket 04) works verbatim.
export async function renderPdfPage(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  lookup: IpaLookup,
  showIpa: boolean
): Promise<PdfRender> {
  const token = ++pdfRenderToken;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d context unavailable");
  await page.render({ canvasContext: context, viewport }).promise;
  const content = await page.getTextContent();
  if (token !== pdfRenderToken) {
    page.cleanup();
    return { wordCount: 0, ipaCount: 0 };
  }
  for (const layer of overlay.querySelectorAll("[data-pdf-word]")) {
    layer.remove();
  }
  let wordCount = 0;
  let ipaCount = 0;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const text = item as TextItem;
    if (text.str.trim() === "") continue;
    const tx = Util.transform(viewport.transform, text.transform);
    const fontPx = Math.hypot(tx[2], tx[3]);
    const charWidth = (text.width * scale) / text.str.length;
    let offset = 0;
    for (const piece of text.str.split(/(\s+)/)) {
      if (piece.trim() === "") {
        offset += piece.length * charWidth;
        continue;
      }
      const word = document.createElement("span");
      word.className = "pdf-word";
      word.style.left = `${tx[4] + offset}px`;
      word.style.top = `${tx[5] - fontPx}px`;
      word.style.fontSize = `${fontPx}px`;
      word.dataset.pdfWord = piece;
      word.setAttribute("data-word", piece);
      word.setAttribute("role", "button");
      word.setAttribute("tabindex", "0");
      word.textContent = piece;
      if (showIpa) {
        const ipa = lookup(piece);
        const ipaEl = document.createElement("span");
        ipaEl.className = "pdf-ipa";
        ipaEl.dataset.ipa = ipa ?? "";
        ipaEl.style.left = "50%";
        ipaEl.style.top = `${fontPx + 2}px`;
        ipaEl.textContent = ipa ?? "";
        if (ipa) ipaCount += 1;
        word.appendChild(ipaEl);
      }
      overlay.appendChild(word);
      wordCount += 1;
      offset += piece.length * charWidth;
    }
  }
  page.cleanup();
  return { wordCount, ipaCount };
}

let pdfRenderToken = 0;

export async function destroyPdf(session: PdfSession): Promise<void> {
  // pdf.js holds the worker and page caches until destroyed — skipping
  // this leaks both per opened book (pdfjs-extraction gotchas).
  await session.doc.destroy();
}
