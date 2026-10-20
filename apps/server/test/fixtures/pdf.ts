import { PDFDocument, StandardFonts } from "pdf-lib";

// Deterministic fixture PDFs (spec: 杜绝时间戳类不确定因素).
// updateMetadata: false keeps pdf-lib from stamping CreationDate/ModDate,
// so two runs of the same builder call produce byte-identical files —
// asserted by the determinism test. Standard-14 fonts embed nothing.
export type SamplePdfOptions = {
  // Metadata title; null omits it entirely (title-fallback coverage).
  title?: string | null;
  // One entry per page; \n inside an entry is a printed line break.
  pages?: string[];
};

export async function createSamplePdf(
  options: SamplePdfOptions = {}
): Promise<Buffer> {
  const { title = "Sample PDF Book", pages = defaultThreeTextPages() } =
    options;
  const document = await PDFDocument.create({ updateMetadata: false });
  if (title !== null) {
    document.setTitle(title);
  }
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = document.addPage([595, 842]);
    // Blank pages (covers, plates) are legal; drawing nothing keeps them.
    if (text !== "") {
      page.drawText(text, { x: 60, y: 760, font, size: 12, lineHeight: 18 });
    }
  }
  return Buffer.from(await document.save());
}

// Three text pages of real prose (each >100 chars so the scan gate passes).
// Page 1 carries a sentence wrapped across two printed lines and one that
// runs off the page bottom; it finishes as page 2's first line.
export function defaultThreeTextPages(): string[] {
  return [
    [
      "The first page opens the sample book with a steady voice.",
      "A wrapped sentence breaks across two printed lines, and the",
      "reader never notices the seams.",
      "A sentence runs off the bottom of this page and",
    ].join("\n"),
    [
      "finishes on the next one without losing a word.",
      "The second page keeps the story moving through quiet prose.",
      "Nothing here repeats a short line, so the cleanup pass must",
      "leave every sentence exactly where it stands.",
    ].join("\n"),
    [
      "The third page closes the sample with a final calm remark.",
      "The book ends the way it began, in plain and legible English",
      "sentences ready for annotation.",
    ].join("\n"),
  ];
}

// A hand-assembled single-page PDF whose Type0 (Identity-H) font carries a
// ToUnicode CMap mapping CID 1 to U+FB01 — the mechanism real typeset PDFs
// use, and the only one that actually yields the ﬁ codepoint from pdf.js
// (standard-font glyph names resolve "fi" to the plain letter pair). Fixed
// template, computed xref offsets: no clock, no randomness.
// Serializes hand-built PDF object bodies into a valid single-file PDF:
// fixed template, computed xref offsets, no clock, no randomness. The
// trailer extras carry entries like /Encrypt that only some fixtures need.
function writeRawPdf(objects: string[], trailerExtras: string): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtras}>>\n`;
  pdf += `startxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export async function createLigaturePdf(): Promise<Buffer> {
  const line =
    "\uFB01ne tuning of the ligatures keeps every original glyph reading " +
    "smoothly across the whole printed line.";
  // Identity-H text is 2-byte CIDs; ASCII rides an identity bfrange, the
  // ligature is CID 1 (mapped to FB01 in the ToUnicode CMap below).
  const toHex = (text: string): string =>
    Array.from(text, (ch) =>
      ch === "\uFB01" ? "0001" : ch.charCodeAt(0).toString(16).padStart(4, "0")
    ).join("");
  // Wrapped like real typeset text: one long Td-less line would run past
  // the MediaBox edge and pdf.js flushes its text chunk at the page
  // boundary, truncating extraction mid-word. Chunks break on spaces —
  // real books do not break words without a hyphen.
  const lineLength = 40;
  const chunks: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current !== "" && current.length + 1 + word.length > lineLength) {
      chunks.push(current);
      current = word;
    } else {
      current = current === "" ? word : `${current} ${word}`;
    }
  }
  if (current !== "") chunks.push(current);
  const content = [
    "BT /F1 12 Tf 72 720 Td",
    ...chunks.map((chunk, index) =>
      index === 0 ? `<${toHex(chunk)}> Tj` : `0 -18 Td <${toHex(chunk)}> Tj`
    ),
    "ET",
  ].join(" ");
  const toUnicode = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CMapName /Custom def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    "1 beginbfchar",
    "<0001> <FB01>",
    "endbfchar",
    "1 beginbfrange",
    "<0020> <007E> <0020>",
    "endbfrange",
    "endcmap",
    "end",
    "end",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /Arial /Encoding /Identity-H " +
      "/DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Arial " +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> " +
      "/FontDescriptor 8 0 R /DW 1000 /CIDToGIDMap /Identity >>",
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
    "<< /Type /FontDescriptor /FontName /Arial /Flags 4 " +
      "/FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent -200 " +
      "/CapHeight 1000 /StemV 80 >>",
  ];
  return writeRawPdf(objects, "");
}

// One fixed 1x1 PNG (red pixel), embedded on every page: an image-only,
// text-layer-free PDF. Same input bytes every run — pdf-lib's embedding is
// a pure function of the PNG, so the fixture stays deterministic.
const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export async function createScannedPdf(
  options: {
    pages?: number;
  } = {}
): Promise<Buffer> {
  const { pages = 4 } = options;
  const document = await PDFDocument.create({ updateMetadata: false });
  const image = await document.embedPng(RED_PIXEL_PNG);
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([595, 842]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await document.save());
}

// Enough pages to trip the import's page-count cap. The pages are copies of
// one template, so generation stays cheap and deterministic.
export async function createOversizedPdf(pages = 2001): Promise<Buffer> {
  const template = await PDFDocument.create({ updateMetadata: false });
  const font = await template.embedFont(StandardFonts.Helvetica);
  const page = template.addPage([595, 842]);
  page.drawText("Overflow page for the page-count cap fixture.", {
    x: 60,
    y: 760,
    font,
    size: 12,
  });

  const document = await PDFDocument.create({ updateMetadata: false });
  const copies = await document.copyPages(
    template,
    Array.from({ length: pages }, () => 0)
  );
  for (const copy of copies) document.addPage(copy);
  return Buffer.from(await document.save());
}

// A hand-assembled one-page PDF carrying a standard /Encrypt dict with
// garbage owner/user keys: the empty password fails, so pdf.js throws
// PasswordException and the import must answer 400 with the 加密 文案.
// Fixed template, computed xref offsets.
export async function createEncryptedPdf(): Promise<Buffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Filter /Standard /V 1 /R 2 /O <0102030405060708090a0b0c0d0e0f10" +
      "1112131415161718191a1b1c1d1e1f20> /U <2122232425262728292a2b2c2d2e2f30" +
      "3132333435363738393a3b3c3d3e3f40> /P -1 >>",
  ];
  return writeRawPdf(objects, "/Encrypt 4 0 R ");
}
