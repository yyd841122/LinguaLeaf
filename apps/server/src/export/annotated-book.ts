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

// The file's only script — the annotated book file's application half. It
// is real TypeScript in packages/reading-model/src/export-front.ts; the
// committed generated file carries the compiled IIFE the template inlines
// (regenerate via npm run build:file-script, gate: file-script-fresh).
import { FILE_SCRIPT } from "./file-script.generated.js";
import { EXPORT_STYLE } from "./style.generated.js";

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
    // IPA line is toggled off — only the transcription child hides. The
    // transcription rides as data-ipa and paints via ::before (shared
    // stylesheet): pseudo-element content never enters a text selection,
    // so copying the original line never picks the IPA up (user-select:
    // none alone still lets engines include it in the copied range).
    original += segment.ipa
      ? `<span class="ipa-word" data-word="${word}"><span class="ipa-word-text">${word}</span><span class="ipa-word-ipa" data-ipa="${escapeHtml(segment.ipa)}"></span></span>`
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
${EXPORT_STYLE}
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
