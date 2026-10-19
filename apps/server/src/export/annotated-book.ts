import type Database from "better-sqlite3";
import type { BlockKind } from "../import/pipeline.js";
import type { Dictionary, WordLookup } from "../dict/dictionary.js";
import { lookupWord, normalizeLookupToken } from "../dict/dictionary.js";
import { WORD_PATTERN } from "../dict/ipa-line.js";

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

// Download filename for the attachment header. The Chinese title survives
// (it rides in the RFC 5987 filename* form Express generates); what is
// stripped is what no common filesystem accepts in a name.
export function annotatedBookFilename(title: string): string {
  const cleaned = title
    // \p{Cc} covers the control characters no filesystem wants in a name
    // (written as the Unicode category — a literal \x00 range would trip
    // the no-control-regex rule).
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    // Windows silently drops trailing dots and spaces on save.
    .replace(/[. ]+$/, "")
    .trim();
  return `${cleaned.length > 0 ? cleaned : "book"}.html`;
}

type BlockRow = {
  kind: BlockKind;
  original_text: string;
  ipa_slots: string | null;
  ipa_text: string | null;
  translation_text: string | null;
};

type ChapterRow = {
  id: number;
  title: string;
  blocks: BlockRow[];
};

// One joined query in book order: chapters LEFT JOIN blocks so a
// heading-only chapter still renders (its section just has no blocks).
// Mirrors the shape of books-router.ts's per-chapter queries, but reads the
// whole book in one pass — the export is the only consumer that needs every
// chapter at once.
function loadBook(database: Database.Database, bookId: number): ChapterRow[] {
  const rows = database
    .prepare(
      `SELECT c.id AS chapter_id, c.title AS chapter_title, b.kind, b.original_text,
              b.ipa_slots, b.ipa_text, b.translation_text
       FROM chapters c
       LEFT JOIN blocks b ON b.chapter_id = c.id
       WHERE c.book_id = ?
       ORDER BY c.position, b.position`
    )
    .all(bookId) as {
    chapter_id: number;
    chapter_title: string;
    kind: BlockKind | null;
    original_text: string | null;
    ipa_slots: string | null;
    ipa_text: string | null;
    translation_text: string | null;
  }[];

  const chapters: ChapterRow[] = [];
  for (const row of rows) {
    let chapter = chapters.at(-1);
    if (!chapter || chapter.id !== row.chapter_id) {
      chapter = { id: row.chapter_id, title: row.chapter_title, blocks: [] };
      chapters.push(chapter);
    }
    if (row.kind !== null) {
      chapter.blocks.push({
        kind: row.kind,
        original_text: row.original_text ?? "",
        ipa_slots: row.ipa_slots,
        ipa_text: row.ipa_text,
        translation_text: row.translation_text,
      });
    }
  }
  return chapters;
}

// One sentence block's three lines (GLOSSARY: 句子块). The original line
// walks the same word matches the import used to fill the slots, pairing
// each word with its transcription in a stacked unit (mirror of the app's
// WordSegments; WORD_PATTERN is shared, not re-declared). Books whose slots
// predate the pairing — or whose slots no longer match the word count —
// fall back to the flat IPA line, exactly like the reading view. The
// translation line is omitted when missing (an intentional difference from
// the app, which renders an empty placeholder line: the file stays compact).
const renderSentenceBlock = (block: BlockRow): string => {
  // The slots column is written by the import pipeline as a JSON array; the
  // parse mirrors the chapter route's (a corrupt row fails loudly there too).
  const slots =
    block.ipa_slots !== null ? (JSON.parse(block.ipa_slots) as string[]) : null;
  const matches = [...block.original_text.matchAll(WORD_PATTERN)];
  const slotPaired = slots !== null && slots.length === matches.length;
  let original = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? cursor;
    if (start > cursor) {
      original += escapeHtml(block.original_text.slice(cursor, start));
    }
    const word = escapeHtml(match[0]);
    const ipa = slotPaired ? slots[index] : undefined;
    // The unit stem (ipa-word) stays clickable and visible even when the
    // IPA line is toggled off — only the transcription child hides.
    original += ipa
      ? `<span class="ipa-word" data-word="${word}"><span class="ipa-word-text">${word}</span><span class="ipa-word-ipa">${escapeHtml(ipa)}</span></span>`
      : `<span class="lookup-word" data-word="${word}">${word}</span>`;
    cursor = start + match[0].length;
  });
  original += escapeHtml(block.original_text.slice(cursor));

  const ipaLine = slotPaired
    ? ""
    : `<p class="ipa-line">${escapeHtml(block.ipa_text ?? "")}</p>`;
  const translation = block.translation_text?.trim();
  const translationLine =
    translation === undefined || translation.length === 0
      ? ""
      : `<p class="translation-line">${escapeHtml(translation)}</p>`;
  return `<div class="sentence-block"><p class="original-line">${original}</p>${ipaLine}${translationLine}</div>`;
};

const renderBlock = (block: BlockRow): string => {
  if (block.kind === "sentence") {
    return renderSentenceBlock(block);
  }
  if (block.kind === "code") {
    return `<pre class="code-block"><code>${escapeHtml(block.original_text)}</code></pre>`;
  }
  if (block.kind === "image") {
    const caption =
      block.original_text.length > 0
        ? `<figcaption>${escapeHtml(block.original_text)}</figcaption>`
        : "";
    return `<figure class="image-block"><span class="image-placeholder" aria-hidden="true">🖼</span>${caption}</figure>`;
  }
  return `<p class="raw-block">${escapeHtml(block.original_text)}</p>`;
};

const renderChapter = (chapter: ChapterRow): string => {
  const heading =
    chapter.title.length > 0
      ? `<h2 class="chapter-title">${escapeHtml(chapter.title)}</h2>`
      : "";
  return `<section class="chapter">${heading}<div class="blocks">${chapter.blocks
    .map(renderBlock)
    .join("")}</div></section>`;
};

const renderBody = (title: string, chapters: ChapterRow[]): string => `
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
  chapters: ChapterRow[],
  dictionary: Dictionary
): Record<string, WordLookup | null> {
  const vocabulary = new Map<string, WordLookup | null>();
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (block.kind !== "sentence") continue;
      for (const match of block.original_text.matchAll(WORD_PATTERN)) {
        const key = normalizeLookupToken(match[0]);
        if (key.length > 0 && !vocabulary.has(key)) {
          vocabulary.set(key, lookupWord(dictionary, match[0]));
        }
      }
    }
  }
  return Object.fromEntries(vocabulary);
}

// The file's only script: the two display toggles (GLOSSARY: 显示开关)
// and the tap-word lookup (GLOSSARY: 点词查详情). Root classes on <body>
// drive the visibility CSS; the choice is remembered per toggle in
// localStorage. Every storage touch is guarded — file:// contexts (and
// hardened browsers) may throw on access, and the file must fall back to
// all-shown and keep working in-page regardless. No network, no fetches:
// the self-contained red line covers the script too.
const FILE_SCRIPT = `
(function () {
  "use strict";
  var KEY_BY_TOGGLE = {
    "toggle-ipa": "lingualeaf-export.show-ipa",
    "toggle-translation": "lingualeaf-export.show-translation"
  };
  function readFlag(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }
  function writeFlag(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // In-page toggling keeps working; only the memory is lost.
    }
  }
  Object.keys(KEY_BY_TOGGLE).forEach(function (id) {
    var toggle = document.getElementById(id);
    if (!toggle) return;
    if (readFlag(KEY_BY_TOGGLE[id]) === "0") toggle.checked = false;
    var apply = function () {
      document.body.classList.toggle(
        "hide-" + toggle.getAttribute("data-annotation"),
        !toggle.checked
      );
    };
    apply();
    toggle.addEventListener("change", function () {
      apply();
      writeFlag(KEY_BY_TOGGLE[id], toggle.checked ? "1" : "0");
    });
  });

  // -- 点词查详情 --
  // Words arrive pre-tokenized: every clickable word in the file was
  // wrapped at export time by the same shared pattern the IPA line uses
  // (dict/ipa-line.ts WORD_PATTERN — the web's ReadingView keeps its own
  // synced copy of that pattern for its render-time wrapping; this file
  // needs no runtime copy because the wrapping is baked into the markup).
  // What the file does own is the lookup-key fold below: a faithful copy
  // of the server's normalizeLookupToken (dict/dictionary.ts). Keep the
  // two identical — a divergent fold makes case and curly-quote variants
  // silently miss the vocabulary.
  var VOCAB = {};
  try {
    VOCAB = JSON.parse(
      document.getElementById("annotated-vocab").textContent
    );
  } catch (error) {
    // A missing or corrupt vocabulary makes every popup report a miss;
    // reading and the toggles keep working.
  }
  function lookupKey(token) {
    return token
      .trim()
      .toLowerCase()
      // The curly apostrophe, as its escape: the fold must survive any
      // transcoding of this file.
      .replace(/\\u2019/g, "'")
      .replace(/^[^a-z']+|[^a-z']+$/g, "");
  }
  function lookupEntry(key) {
    if (key.length === 0) return null;
    // Own properties only: a miss on a word like "constructor" must read
    // as a miss, not inherit from Object.prototype.
    return Object.prototype.hasOwnProperty.call(VOCAB, key)
      ? VOCAB[key]
      : null;
  }

  var popup = document.getElementById("lookup-popup");
  // The word the popup currently shows — what the 发音 button speaks (the
  // clicked surface form, not the lemma, like the app).
  var spokenWord = "";
  // The popup's rows are filled through textContent only — book-derived
  // values (senses, transcriptions, the words themselves) can never become
  // markup here.
  function fillRow(id, value) {
    var row = document.getElementById(id);
    row.textContent = value;
    row.hidden = false;
  }
  function hideRow(id) {
    var row = document.getElementById(id);
    row.hidden = true;
  }
  // Anchor clamp mirroring the app's WordLookupPopup (plain arithmetic on
  // the click point, no layout reads). The numbers are named after that
  // component's constants — keep the values identical with them and with
  // the .lookup-* stylesheet below: three sites move together.
  var POPUP_WIDTH_PX = 288;
  var POPUP_MAX_HEIGHT_PX = 256;
  var POPUP_MARGIN_PX = 8;
  var POPUP_VERTICAL_OFFSET_PX = 14;
  var POPUP_HORIZONTAL_OFFSET_PX = 20;
  function anchorPopup(point) {
    var width = Math.min(
      POPUP_WIDTH_PX,
      window.innerWidth - 2 * POPUP_MARGIN_PX
    );
    var maxLeft = Math.max(
      POPUP_MARGIN_PX,
      window.innerWidth - width - POPUP_MARGIN_PX
    );
    var maxTop = Math.max(
      POPUP_MARGIN_PX,
      window.innerHeight - POPUP_MAX_HEIGHT_PX - POPUP_MARGIN_PX
    );
    popup.style.left =
      Math.min(
        Math.max(point.x - POPUP_HORIZONTAL_OFFSET_PX, POPUP_MARGIN_PX),
        maxLeft
      ) + "px";
    popup.style.top =
      Math.min(
        Math.max(point.y + POPUP_VERTICAL_OFFSET_PX, POPUP_MARGIN_PX),
        maxTop
      ) + "px";
  }
  function openPopup(word, point) {
    spokenWord = word;
    var entry = lookupEntry(lookupKey(word));
    fillRow("lookup-head-word", word);
    if (entry) {
      hideRow("lookup-status");
      if (entry.lemma && entry.lemma !== entry.word) {
        fillRow("lookup-lemma", "原形 " + entry.lemma);
      } else {
        hideRow("lookup-lemma");
      }
      if (entry.ipa) fillRow("lookup-ipa", "/" + entry.ipa + "/");
      else hideRow("lookup-ipa");
      if (entry.pos) fillRow("lookup-pos", entry.pos);
      else hideRow("lookup-pos");
      if (entry.translation) fillRow("lookup-translation", entry.translation);
      else hideRow("lookup-translation");
    } else {
      // No entry knows the word (spec: 查不到的词提示无结果): say so, and
      // keep every sense row from the previous lookup hidden.
      hideRow("lookup-lemma");
      hideRow("lookup-ipa");
      hideRow("lookup-pos");
      hideRow("lookup-translation");
      fillRow("lookup-status", "词库中未收录这个词。");
    }
    anchorPopup(point);
    popup.hidden = false;
  }
  // Dismissal mirrors the app's WordLookupPopup: a click that is neither
  // inside the popup nor on a word closes it (clicking another word moves
  // it instead), Escape closes it, and the ✕ button is the explicit close.
  function closePopup() {
    popup.hidden = true;
  }
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    if (popup.contains(target)) return;
    var word = target.closest("[data-word]");
    if (!word) {
      closePopup();
      return;
    }
    openPopup(word.getAttribute("data-word"), {
      x: event.clientX,
      y: event.clientY,
    });
  });
  document
    .getElementById("lookup-close")
    .addEventListener("click", closePopup);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closePopup();
  });

  // -- 发音 --
  // Browser speech synthesis for the popup's word, mirroring the app's
  // speakWord (apps/web/src/wordLookup.ts): silent no-op where the API is
  // missing or partial — an unsupported environment must never turn a
  // click into an error. Repeated clicks restart from silence. Whether any
  // sound comes out offline depends on the device's local voices.
  document
    .getElementById("lookup-speak")
    .addEventListener("click", function () {
      var synthesis = window.speechSynthesis;
      var Utterance = window.SpeechSynthesisUtterance;
      if (!synthesis || !Utterance) return;
      synthesis.cancel();
      var utterance = new Utterance(spokenWord);
      utterance.lang = "en-US";
      synthesis.speak(utterance);
    });
})();`;

// Renders the whole file. Synchronous on purpose: an export is pure reads
// over local SQLite, and the spec accepts second-scale generation without
// progress reporting. The book rides as the narrow { id, title } shape the
// renderer needs — the router's full row stays the router's business. The
// dictionary feeds the embedded vocabulary (GLOSSARY: 点词查详情).
export function renderAnnotatedBook(
  database: Database.Database,
  dictionary: Dictionary,
  book: { id: number; title: string }
): string {
  const chapters = loadBook(database, book.id);
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
<title>${escapeHtml(book.title)}</title>
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
   rows filled through textContent only. Keep identical with that
   stylesheet and with the clamp constants in the file's script — three
   sites move together. */
.lookup-popup {
  position: fixed;
  z-index: 20;
  width: 18rem;
  max-width: calc(100vw - 1rem);
  max-height: 16rem;
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
${renderBody(book.title, chapters)}
<script id="annotated-vocab" type="application/json">${vocabularyJson}</script>
<script>${FILE_SCRIPT}</script>
</body>
</html>
`;
}
