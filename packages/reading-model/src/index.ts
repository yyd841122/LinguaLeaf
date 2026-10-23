// The reading model's public surface: the rules both reading frontends
// (the React app and the annotated book file) share, declared once. The
// file's own script entry (src/export-front.ts) is deliberately not part
// of this surface — it is compiled into the exported HTML at build time,
// never imported at runtime.
export { WORD_PATTERN } from "./word-pattern.js";
export { normalizeToken, normalizeLookupToken } from "./lookup-fold.js";
export type { WordLookup } from "./word-lookup.js";
// The clamp's offset constants stay module-internal (anchorPopup consumes
// them; no frontend needs them once it holds the function).
export {
  POPUP_WIDTH_PX,
  POPUP_MAX_HEIGHT_PX,
  POPUP_MARGIN_PX,
  anchorPopup,
  type ClickPoint,
  type Viewport,
} from "./popup-anchor.js";
export { speakWord } from "./speak.js";
export {
  annotatedBookFilename,
  cleanFilenameBase,
  FALLBACK_ATTACHMENT_NAME,
} from "./book-filename.js";
export {
  segmentOriginal,
  type Segment,
  type TextSegment,
  type WordSegment,
} from "./sentence-segments.js";
