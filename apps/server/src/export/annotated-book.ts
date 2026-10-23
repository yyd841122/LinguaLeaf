import type { Dictionary } from "../dict/dictionary.js";
import { lookupWord } from "../dict/dictionary.js";
import {
  WORD_PATTERN,
  normalizeLookupToken,
  segmentOriginal,
  type WordLookup,
} from "@lingualeaf/reading-model";
import type {
  BlockData,
  ChapterData,
  SentenceBlockData,
} from "../book-store.js";
import {
  POPUP_MARGIN_PX,
  POPUP_MAX_HEIGHT_PX,
  POPUP_WIDTH_PX,
} from "@lingualeaf/reading-model";

// The file's only script — the annotated book file's application half. It
// is real TypeScript in packages/reading-model/src/export-front.ts; the
// committed generated file carries the compiled IIFE the template inlines
// (regenerate via npm run build:file-script, gate: file-script-fresh).
import { FILE_SCRIPT } from "./file-script.generated.js";

// The attachment filename rule lives in the reading model; re-exported so
// the router keeps one import site for the export's naming.
export { annotatedBookFilename } from "@lingualeaf/reading-model";

// The annotated book file (GLOSSARY.md): a self-contained single-file HTML
// rendering of everything the library holds for one book — chapter titles,
// every block kind in reading order, and the sentence blocks' three lines
// (original, IPA, translation). The bytes never leave the DOM: no scripts
// are fetched, no fonts or images linked (spec: 自包含红线). Double-clicking
// the file in a browser must read fully offline.

// Book content is untrusted input (spec: 书内容一律视为不可信输入). One
// escape for both text and double-quoted attribute contexts: & first, then
// the angle brackets and both quotes.
const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// One sentence block's three lines (GLOSSARY: 句子块). The original line is
// the reading model's shared walk (segmentOriginal): the same word matches
// the import used to fill the slots, each word paired with its transcription
// in a stacked unit (the JSX half of the same walk is the app's
// WordSegments). Books whose slots predate the pairing — or whose slots no
// longer match the word count — fall back to the flat IPA line, exactly
// like the reading view. The translation line is omitted when missing (an
// intentional difference from the app, which renders an empty placeholder
// line: the file stays compact).
const renderSentenceBlock = (block: SentenceBlockData): string => {
  const { paired, segments } = segmentOriginal(
    block.originalText,
    block.ipaSlots
  );
  let original = "";
  for (const segment of segments) {
    if (segment.kind === "text") {
      original += escapeHtml(segment.text);
      continue;
    }
    const word = escapeHtml(segment.word);
    // The unit stem (ipa-word) stays clickable and visible even when the
    // IPA line is toggled off — only the transcription child hides.
    original += segment.ipa
      ? `<span class="ipa-word" data-word="${word}"><span class="ipa-word-text">${word}</span><span class="ipa-word-ipa">${escapeHtml(segment.ipa)}</span></span>`
      : `<span class="lookup-word" data-word="${word}">${word}</span>`;
  }

  const ipaLine = paired
    ? ""
    : `<p class="ipa-line">${escapeHtml(block.ipaText ?? "")}</p>`;
  const translation = block.translationText?.trim();
  const translationLine =
    translation === undefined || translation.length === 0
      ? ""
      : `<p class="translation-line">${escapeHtml(translation)}</p>`;
  return `<div class="sentence-block"><p class="original-line">${original}</p>${ipaLine}${translationLine}</div>`;
};

const renderBlock = (block: BlockData): string => {
  if (block.kind === "sentence") {
    return renderSentenceBlock(block);
  }
  if (block.kind === "code") {
    return `<pre class="code-block"><code>${escapeHtml(block.originalText)}</code></pre>`;
  }
  if (block.kind === "image") {
    const caption =
      block.originalText.length > 0
        ? `<figcaption>${escapeHtml(block.originalText)}</figcaption>`
        : "";
    return `<figure class="image-block"><span class="image-placeholder" aria-hidden="true">🖼</span>${caption}</figure>`;
  }
  return `<p class="raw-block">${escapeHtml(block.originalText)}</p>`;
};

const renderChapter = (chapter: ChapterData): string => {
  const heading =
    chapter.title.length > 0
      ? `<h2 class="chapter-title">${escapeHtml(chapter.title)}</h2>`
      : "";
  return `<section class="chapter">${heading}<div class="blocks">${chapter.blocks
    .map(renderBlock)
    .join("")}</div></section>`;
};

const renderBody = (title: string, chapters: ChapterData[]): string => `
<header class="export-toolbar">
  <div class="export-toolbar-inner">
    <h1 class="book-title">${escapeHtml(title)}</h1>
    <div class="export-toggles">
      <label class="export-toggle"><input type="checkbox" id="toggle-ipa" data-annotation="ipa" checked>音标行</label>
      <label class="export-toggle"><input type="checkbox" id="toggle-translation" data-annotation="translation" checked>译文行</label>
    </div>
  </div>
</header>
<main class="book">
${chapters.map(renderChapter).join("\n")}
</main>
<div class="lookup-popup" id="lookup-popup" role="dialog" aria-label="词详情" hidden>
  <div class="lookup-head">
    <span class="lookup-head-word" id="lookup-head-word"></span>
    <span class="lookup-lemma" id="lookup-lemma" hidden></span>
    <span class="lookup-head-actions">
      <button type="button" class="lookup-speak" id="lookup-speak" aria-label="发音">🔊</button>
      <button type="button" class="lookup-close" id="lookup-close" aria-label="关闭">✕</button>
    </span>
  </div>
  <p class="lookup-status" id="lookup-status" hidden></p>
  <p class="lookup-ipa" id="lookup-ipa" hidden></p>
  <p class="lookup-pos" id="lookup-pos" hidden></p>
  <p class="lookup-translation" id="lookup-translation" hidden></p>
</div>`;

// The book's deduplicated vocabulary (spec: 只嵌本书句子块词汇): every word
// token in every sentence block, keyed by the lookup-time fold — the same
// normalizeLookupToken the tap-lookup contract normalizes with — and the
// server's own lookup result as the value (null when no entry knows the
// word, so the file's popup can say "not found" instead of guessing). Raw
// blocks, code, and chapter titles stay out; so does the rest of the
// dictionary.
function collectVocabulary(
  chapters: ChapterData[],
  dictionary: Dictionary
): Record<string, WordLookup | null> {
  const vocabulary = new Map<string, WordLookup | null>();
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (block.kind !== "sentence") continue;
      for (const match of block.originalText.matchAll(WORD_PATTERN)) {
        const key = normalizeLookupToken(match[0]);
        if (key.length > 0 && !vocabulary.has(key)) {
          vocabulary.set(key, lookupWord(dictionary, match[0]));
        }
      }
    }
  }
  return Object.fromEntries(vocabulary);
}

// Renders the whole file. Synchronous on purpose: an export is pure reads
// over local SQLite, and the spec accepts second-scale generation without
// progress reporting. The chapters ride in decoded from the book store
// (loadWholeBook) — this module holds no SQL — and the title comes from the
// caller's book row. The dictionary feeds the embedded vocabulary
// (GLOSSARY: 点词查详情).
export function renderAnnotatedBook(
  title: string,
  chapters: ChapterData[],
  dictionary: Dictionary
): string {
  const vocabulary = collectVocabulary(chapters, dictionary);
  // The vocabulary rides as data, not code: a JSON script element the
  // file's script parses at startup. `<` never reaches the raw text — in a
  // JSON string it is indistinguishable from `<` to JSON.parse, and no
  // other JSON position can carry it — so no book- or dictionary-born
  // `</script>` can close the tag early (spec: 内嵌 JSON 脚本安全序列化).
  const vocabularyJson = JSON.stringify(vocabulary).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f6f7f2;
  color: #22342a;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  line-height: 1.6;
}
.export-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f6f7f2;
  border-bottom: 1px solid #dde3d8;
}
.export-toolbar-inner {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0.9rem 1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.book-title {
  font-size: 1.25rem;
  margin: 0;
}
.export-toggles {
  display: flex;
  gap: 1rem;
}
.export-toggle {
  display: inline-flex;
  gap: 0.45rem;
  align-items: center;
  cursor: pointer;
}
.book {
  max-width: 48rem;
  margin: 0 auto 3rem;
  padding: 0 1.25rem;
}
.chapter-title {
  margin: 2.5rem 0 1.25rem;
}
/* Sentence block and annotation lines mirror the reading view's classes
   and values (apps/web/src/style.css); the original line never hides. */
.sentence-block {
  margin: 0 0 1.25rem;
}
.original-line {
  margin: 0;
  font-size: 1.15rem;
}
.ipa-line,
.translation-line {
  margin: 0;
  min-height: 1.4em;
  color: #5c6f64;
  font-size: 0.9rem;
}
.translation-line {
  color: #3f5148;
}
.ipa-word {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  vertical-align: baseline;
  cursor: pointer;
  border-radius: 0.2rem;
}
.ipa-word-ipa {
  color: #5c6f64;
  font-size: 0.75rem;
  line-height: 1.35;
}
.lookup-word {
  cursor: pointer;
  border-radius: 0.2rem;
}
.lookup-word:hover,
.ipa-word:hover {
  background: #ecefe6;
}
/* The word-lookup popup (GLOSSARY: 点词查详情) mirrors the app's .lookup-*
   classes (apps/web/src/style.css): a floating card anchored at the click,
   rows filled through textContent only. The box values interpolate from
   the reading model's popup constants (packages/reading-model,
   popup-anchor) — the app's stylesheet is the hand-mirrored side. */
.lookup-popup {
  position: fixed;
  z-index: 20;
  width: ${POPUP_WIDTH_PX / 16}rem;
  max-width: calc(100vw - ${(POPUP_MARGIN_PX * 2) / 16}rem);
  max-height: ${POPUP_MAX_HEIGHT_PX / 16}rem;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #dde3d8;
  border-radius: 0.5rem;
  padding: 0.6rem 0.9rem;
  box-shadow: 0 0.4rem 1rem rgba(34, 52, 42, 0.12);
}
.lookup-head {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}
.lookup-head-word {
  font-weight: 600;
  font-size: 1.05rem;
}
.lookup-lemma {
  color: #5c6f64;
  font-size: 0.8rem;
}
.lookup-head-actions {
  margin-left: auto;
  display: flex;
  gap: 0.15rem;
}
.lookup-head-actions button {
  border: none;
  background: none;
  padding: 0 0.2rem;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1.2;
}
.lookup-head-actions button:hover {
  background: #ecefe6;
  border-radius: 0.25rem;
}
.lookup-popup p {
  margin: 0.15rem 0;
}
.lookup-ipa {
  color: #5c6f64;
}
.lookup-pos {
  color: #5c6f64;
  font-size: 0.85rem;
}
.lookup-translation {
  white-space: pre-line;
}
.lookup-status {
  color: #5c6f64;
}
.code-block {
  background: #ecefe6;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  margin: 0 0 1.25rem;
}
.raw-block {
  margin: 0 0 1.25rem;
  color: #5c6f64;
}
.image-block {
  margin: 0 auto 1.25rem;
  max-width: 60%;
  text-align: center;
}
.image-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 6rem;
  background: #ecefe6;
  border: 1px dashed #b8c4bc;
  border-radius: 0.5rem;
  font-size: 1.75rem;
}
.image-block figcaption {
  margin-top: 0.4rem;
  color: #5c6f64;
  font-size: 0.85rem;
}
/* Display toggles: hiding the IPA covers both of its shapes — the paired
   transcription and the legacy flat line — while the word stems (.ipa-word)
   stay visible and clickable, and the original line is untouchable. */
body.hide-ipa .ipa-line,
body.hide-ipa .ipa-word-ipa {
  display: none;
}
body.hide-translation .translation-line {
  display: none;
}
@media (max-width: 640px) {
  .book {
    padding: 0 1rem;
  }
  .original-line {
    font-size: 1.05rem;
  }
}
</style>
</head>
<body>
${renderBody(title, chapters)}
<script id="annotated-vocab" type="application/json">${vocabularyJson}</script>
<script>${FILE_SCRIPT}</script>
</body>
</html>
`;
}
