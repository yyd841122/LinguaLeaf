import MarkdownIt from "markdown-it";
import {
  deriveBookTitle,
  extractChaptersFromHtml,
  type ExtractedChapter,
  type PreparedBook,
} from "@lingualeaf/import-core";

const markdown = new MarkdownIt({ html: false, typographer: false });

// Single source of truth for what counts as a Markdown book file.
export const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

export function isMarkdownFilename(filename: string): boolean {
  return MARKDOWN_EXTENSION.test(filename);
}

// html:false keeps raw HTML in uploaded books inert (escaped, never executed);
// the reading view re-renders only extracted plain text. Markdown joins the
// same extraction path as EPUB (spec: one pipeline past this point).
export function readMarkdownBook(
  filename: string,
  markdownText: string
): PreparedBook {
  const chapters: ExtractedChapter[] = extractChaptersFromHtml(
    markdown.render(markdownText)
  );
  return {
    // No metadata rung: the book's own first heading, then the file name.
    title: deriveBookTitle(null, chapters, filename, MARKDOWN_EXTENSION),
    format: "markdown",
    chapters,
  };
}
