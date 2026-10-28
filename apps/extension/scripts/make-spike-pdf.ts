// The spike's sample PDF (ticket 01): deterministic (updateMetadata false),
// one page, two text columns, a hyphenated word broken across lines, and
// plain paragraphs — the shapes the 判据 must survive. Run:
//   npx tsx scripts/make-spike-pdf.ts [out]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const out = resolve(
  process.argv[2] ?? resolve(import.meta.dirname, "../spike/sample.pdf")
);

const doc = await PDFDocument.create({ updateMetadata: false });
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([612, 792]);
const ink = rgb(0.13, 0.2, 0.16);
const size = 11;
const leading = 16;

const draw = (text: string, x: number, y: number) =>
  page.drawText(text, { x, y, size, font, color: ink });

draw("Two columns, one question", 72, 740);

// Column text: the second line ends mid-word with a hyphen ("exam-"), the
// next line starts with the rest ("ple") — word-level overlay must decide
// what a word is across that break.
const col1 = [
  "The old man woke early to read,",
  "as he did every morning exam-",
  "ple of patience with the text,",
  "and of quiet attention.",
  "",
  "Words carry their sounds with",
  "them; the reader only needs",
  "to look underneath the line.",
];
const col2 = [
  "A second column proves the",
  "overlay respects columns: no",
  "sound may drift across the",
  "gutter between two texts.",
  "",
  "Zoom changes every distance,",
  "yet the pairing must survive",
  "the scaling without harm.",
];

let y = 700;
for (const line of col1) {
  if (line) draw(line, 72, y);
  y -= leading;
}
y = 700;
for (const line of col2) {
  if (line) draw(line, 324, y);
  y -= leading;
}

const bytes = await doc.save();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);
