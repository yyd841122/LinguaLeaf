import type { Dictionary } from "../dict/dictionary.js";
import { buildIpaSlots } from "../dict/ipa-line.js";
import type { ExtractedChapter } from "./extract-html.js";
import { splitSentences } from "./sentences.js";
import type { BlockRow } from "../book-store.js";

export type BookFormat = "markdown" | "epub" | "pdf";

// What the format-specific front halves (markdown.ts, epub.ts, pdf.ts) hand
// to the shared import: extracted chapters plus the book title. Everything
// past this type — sentence splitting, IPA, translation, insert — is one
// path. pageCount is a PDF fact (the shelf's long-book hint rides on it);
// the other front halves leave it unset.
export type PreparedBook = {
  title: string;
  format: BookFormat;
  chapters: ExtractedChapter[];
  pageCount?: number;
};

// The annotation pass that is pure CPU: sentence splitting plus per-word
// IPA lookups against the local dictionary (all fast). Translation — the
// slow, network-bound pass — happens later in the import task
// (import-task.ts), so its progress can be reported per batch. The rows it
// returns are the book store's write shape (BlockRow): one module computes
// them, one module inserts them.
export function buildChapterBlocks(
  book: PreparedBook,
  dictionary: Dictionary
): BlockRow[][] {
  return book.chapters.map((chapter) => {
    const blocks: BlockRow[] = [];
    for (const item of chapter.items) {
      if (item.kind === "paragraph") {
        for (const sentence of splitSentences(item.text)) {
          const slots = buildIpaSlots(dictionary, sentence);
          blocks.push({
            kind: "sentence",
            text: sentence,
            ipaSlots: slots,
            ipaText: slots.join(" ").trim(),
            translation: null,
          });
        }
      } else if (item.kind === "image") {
        // Images stay placeholder blocks in their reading position; the
        // alt text rides in original_text (ticket 07).
        blocks.push({
          kind: "image",
          text: item.text,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        });
      } else {
        // Code and passthrough items are never annotated (spec: 代码块与
        // 链接不做标注), so their annotation columns stay NULL.
        blocks.push({
          kind: item.kind,
          text: item.text,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        });
      }
    }
    return blocks;
  });
}
