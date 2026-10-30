import type { Dictionary } from "../dict/dictionary.js";
import { ipaLookupOf } from "../dict/ipa-line.js";
import { walkChapterBlocks, type PreparedBook } from "@lingualeaf/import-core";
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
// The dispatch (split -> slots, placeholders, passthrough) is the shared
// import chain's (walkChapterBlocks); this module is the server's host
// mapping onto its SQLite write shape.
export function buildChapterBlocks(
  book: PreparedBook,
  dictionary: Dictionary
): BlockRow[][] {
  const lookup = ipaLookupOf(dictionary);
  return book.chapters.map((chapter) =>
    walkChapterBlocks(chapter.items, lookup, {
      sentence: (text, ipaSlots) => ({
        kind: "sentence",
        text,
        ipaSlots,
        // The flat line rides beside the slots: derived here, in the one
        // pass that computes them, so the stored alignment cannot drift.
        ipaText: ipaSlots.join(" ").trim(),
        translation: null,
      }),
      plain: (kind, text) => ({
        kind,
        text,
        ipaSlots: null,
        ipaText: null,
        translation: null,
      }),
    })
  );
}
