// The verification page's engine (ticket 01): render a PDF page with
// pdf.js, walk getTextContent into WORDS (items are line fragments, not
// words), and absolutely-position one hit-target span + one IPA span per
// word. The 判据 reads the geometry of these spans.
import * as pdfjsLib from "pdfjs-dist";
import { Util } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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
  columns: "ˈkɑːləmz",
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

// Items are fragments ("str" with embedded spaces), not words: split each
// on whitespace and apportion x by character count — the same
// approximation pdf.js's own textLayer makes for sub-item positioning.
// renderToken drops stale renders: zoom clicks fire faster than pdf.js
// finishes, and an old page's spans must not land on the new canvas.
let renderToken = 0;
async function renderPage(data: ArrayBuffer, scale: number): Promise<void> {
  const token = ++renderToken;
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport })
    .promise;
  const content = await page.getTextContent();

  if (token !== renderToken) {
    await doc.cleanup();
    return;
  }
  const stage = document.getElementById("stage") as HTMLDivElement;
  for (const layer of stage.querySelectorAll(".spike-word")) layer.remove();

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
      const left = tx[4] + offset;
      const baseline = tx[5];
      const word = document.createElement("span");
      word.className = "spike-word";
      word.style.left = `${left}px`;
      word.style.top = `${baseline - fontPx}px`;
      word.style.fontSize = `${fontPx}px`;
      word.dataset.word = piece;
      word.textContent = piece;
      const ipa = FIXTURE_IPA[piece];
      const ipaEl = document.createElement("span");
      ipaEl.className = "spike-ipa";
      ipaEl.dataset.ipa = ipa ?? "";
      // Coordinates are word-relative: the word span is the positioned
      // ancestor, so 50% centers the IPA under the word and fontPx + 2
      // puts it just below the baseline band.
      ipaEl.style.left = "50%";
      ipaEl.style.top = `${fontPx + 2}px`;
      ipaEl.textContent = ipa ?? "";
      word.appendChild(ipaEl);
      stage.appendChild(word);
      offset += piece.length * charWidth;
    }
  }
  await doc.cleanup();
  void token;
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
