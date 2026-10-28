// The verification page (ticket 01), rebuilt on the reader's shared PDF
// engine (src/reader/pdf.ts) when ticket 06 landed the in-place route:
// what the spike proved, the reader now ships. Only the fixture IPA table
// and the page wiring live here.
import { openPdf, renderPdfPage } from "../reader/pdf";

// Small fixture IPA table (票面: 音标数据用小型 fixture 即可); misses leave
// the slot empty — the same 缺词留空 contract as the offline dictionary.
const FIXTURE_IPA: Record<string, string> = {
  The: "ðə",
  the: "ðə",
  old: "oʊld",
  man: "mæn",
  woke: "woʊk",
  early: "ˈɝːli",
  to: "tu",
  read: "riːd",
  as: "æz",
  he: "hi",
  did: "dɪd",
  every: "ˈɛvri",
  morning: "ˈmɔːrnɪŋ",
  "exam-": "ɪɡˈzæm",
  ple: "",
  of: "əv",
  patience: "ˈpeɪʃəns",
  with: "wɪð",
  text: "tekst",
  and: "ənd",
  quiet: "ˈkwaɪət",
  attention: "əˈtɛnʃən",
  Words: "wɜːrdz",
  carry: "ˈkæri",
  their: "ðɛr",
  sounds: "saʊndz",
  them: "ðɛm",
  reader: "ˈriːdər",
  only: "ˈoʊnli",
  needs: "niːdz",
  look: "lʊk",
  underneath: "ˌʌndərˈniːθ",
  line: "laɪn",
  A: "ə",
  second: "ˈsɛkənd",
  column: "ˈkɑːləm",
  proves: "pruːvz",
  overlay: "ˌoʊvərˈleɪ",
  respects: "rɪˈspɛkts",
  no: "noʊ",
  sound: "saʊnd",
  may: "meɪ",
  drift: "drɪft",
  across: "əˈkrɔːs",
  gutter: "ˈɡʌtər",
  between: "bɪˈtwiːn",
  two: "tu",
  texts: "teksts",
  Zoom: "zuːm",
  changes: "ˈtʃeɪndʒɪz",
  distance: "ˈdɪstəns",
  yet: "jɛt",
  pairing: "ˈpɛrɪŋ",
  must: "mʌst",
  survive: "sərˈvaɪv",
  scaling: "ˈskeɪlɪŋ",
  without: "wɪˈðaʊt",
  harm: "hɑːrm",
  Two: "tu",
  one: "wʌn",
  question: "ˈkwɛstʃən",
};

const fixtureLookup = (token: string): string | null =>
  FIXTURE_IPA[token] ?? null;

async function renderPage(data: ArrayBuffer, scale: number): Promise<void> {
  const doc = (await openPdf(data, "sample.pdf")).doc;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const stage = document.getElementById("stage") as HTMLDivElement;
  await renderPdfPage(canvas, stage, doc, 1, scale, fixtureLookup, showIpa());
  await doc.destroy();
}

function showIpa(): boolean {
  const checkbox = document.getElementById("show-ipa") as HTMLInputElement;
  return checkbox.checked;
}

let currentScale = 1;
let currentBytes: ArrayBuffer | null = null;
const input = document.querySelector('input[type="file"]') as HTMLInputElement;
input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  currentBytes = await file.arrayBuffer();
  await renderPage(currentBytes.slice(0), currentScale);
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-zoom]"
)) {
  button.addEventListener("click", async () => {
    currentScale = Number(button.dataset.zoom);
    if (currentBytes) await renderPage(currentBytes.slice(0), currentScale);
  });
}
document.getElementById("show-ipa")?.addEventListener("change", (event) => {
  const checkbox = event.target as HTMLInputElement;
  document.body.classList.toggle("hide-ipa", !checkbox.checked);
});
