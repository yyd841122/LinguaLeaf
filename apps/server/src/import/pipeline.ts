import type { Dictionary } from "../dict/dictionary.js";
import { buildIpaSlots } from "../dict/ipa-line.js";
import { splitSentences, type PreparedBook } from "@lingualeaf/import-core";
import type { BlockRow } from "../book-store.js";

// PreparedBook and the extraction half it names moved to
// @lingualeaf/import-core (extension-reader ticket 02); the server's half
// of the pipeline is what remains here: the annotation pass over the
// extracted chapters, keyed to the server's SQLite dictionary.

// The annotation pass that is pure CPU: sentence splitting plus per-word
// IPA lookups against the local dictionary (all fast). It is the import's
// only annotation work — the network-bound translation left the pipeline
// in on-demand-translation (ADR-0004 ticket 02), so every block lands with
// its translation NULL and the chapter route fills it on demand. The rows
// it returns are the book store's write shape (BlockRow): one module
// computes them, one module inserts them.
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
