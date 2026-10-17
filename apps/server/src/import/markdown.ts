import MarkdownIt from "markdown-it";
import {
  extractChaptersFromHtml,
  type ExtractedChapter,
} from "./extract-html.js";

const markdown = new MarkdownIt({ html: false, typographer: false });

// Single source of truth for what counts as a Markdown book file.
export const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

export function isMarkdownFilename(filename: string): boolean {
  return MARKDOWN_EXTENSION.test(filename);
}

// html:false keeps raw HTML in uploaded books inert (escaped, never executed);
// the reading view re-renders only extracted plain text. Markdown joins the
// same extraction path as EPUB (spec: one pipeline past this point).
export function renderMarkdownToChapters(
  markdownText: string
): ExtractedChapter[] {
  return extractChaptersFromHtml(markdown.render(markdownText));
}
