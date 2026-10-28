// The import chain's browser-safe half: EPUB unzipping, HTML chapter
// extraction, sentence splitting, and the rejection vocabulary. Shared by
// the server's import pipeline and the extension's local import (ADR-0006)
// — one chain, two hosts. The annotation pass is NOT here: IPA slots need
// a dictionary (SQLite server-side, baked offline extension-side), so each
// host builds its own blocks from a PreparedBook.
export { readEpubBook, isEpubFilename, EPUB_EXTENSION } from "./epub.js";
export {
  extractChaptersFromHtml,
  deriveBookTitle,
  type ExtractedChapter,
  type ParagraphItem,
  type CodeItem,
  type RawItem,
  type ImageItem,
  type ContentItem,
} from "./extract-html.js";
export { splitSentences } from "./sentences.js";
export {
  tokenizeWords,
  buildIpaSlots,
  buildIpaLine,
  type IpaLookup,
} from "./ipa-line.js";
export {
  UploadRejected,
  type ImportErrorCode,
  type ImportRejection,
} from "./rejection.js";
export { posFromTranslation } from "./pos.js";
export type { PreparedBook, BookFormat } from "./types.js";
