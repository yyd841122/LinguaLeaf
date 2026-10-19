import type Database from "better-sqlite3";
import type { BlockKind } from "../import/pipeline.js";
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
</main>`;

// The file's only script: the two display toggles (GLOSSARY: 显示开关).
// Root classes on <body> drive the visibility CSS; the choice is remembered
// per toggle in localStorage. Every storage touch is guarded — file://
// contexts (and hardened browsers) may throw on access, and the file must
// fall back to all-shown and keep working in-page regardless. No network,
// no fetches: the self-contained red line covers the script too.
const TOGGLE_SCRIPT = `
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
})();`;

// Renders the whole file. Synchronous on purpose: an export is pure reads
// over local SQLite, and the spec accepts second-scale generation without
// progress reporting. The book rides as the narrow { id, title } shape the
// renderer needs — the router's full row stays the router's business.
export function renderAnnotatedBook(
  database: Database.Database,
  book: { id: number; title: string }
): string {
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
${renderBody(book.title, loadBook(database, book.id))}
<script>${TOGGLE_SCRIPT}</script>
</body>
</html>
`;
}
