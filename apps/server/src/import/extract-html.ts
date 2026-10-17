import * as cheerio from "cheerio";

export type ParagraphItem = { kind: "paragraph"; text: string };
export type CodeItem = { kind: "code"; text: string };
export type RawItem = { kind: "raw"; text: string };
export type ContentItem = ParagraphItem | CodeItem | RawItem;

export type ExtractedChapter = {
  title: string;
  // Heading level (h1-h6) of the chapter title; null for the untitled lead-in
  // chapter that holds content before the first heading.
  level: number | null;
  items: ContentItem[];
};

// Shared extraction path: both Markdown (after markdown-it) and EPUB
// (ticket 07, after cheerio takes the spine XHTML) land here. Walk top-level
// elements in document order; headings open chapters and never become sentence
// blocks; fenced code blocks and paragraphs containing links pass through
// verbatim as `code` / `raw` items instead of being sentence-split.
export function extractChaptersFromHtml(html: string): ExtractedChapter[] {
  const $ = cheerio.load(html);
  const chapters: ExtractedChapter[] = [];
  let current: ExtractedChapter = { title: "", level: null, items: [] };
  chapters.push(current);

  for (const element of $("body").children().toArray()) {
    const node = $(element);
    const tag = (element.tagName ?? "").toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      current = {
        title: node.text().trim(),
        level: Number(heading[1]),
        items: [],
      };
      chapters.push(current);
      continue;
    }
    if (tag === "pre") {
      const code = node.text().trim();
      if (code) current.items.push({ kind: "code", text: code });
      continue;
    }
    if (tag === "p") {
      const text = node.text().replace(/\s+/g, " ").trim();
      // Empty paragraphs (e.g. image-only, until ticket 07 adds placeholders) are dropped.
      if (!text) continue;
      current.items.push(
        node.find("a").length > 0
          ? { kind: "raw", text }
          : { kind: "paragraph", text }
      );
    }
    // Lists, blockquotes, tables and friends are outside the tracer bullet;
    // later tickets extend the walk when their scope needs them.
  }
  // The untitled lead-in only exists when content precedes the first heading;
  // an empty shell would just be TOC noise.
  const [leadIn, ...rest] = chapters;
  return leadIn && leadIn.items.length > 0 ? chapters : rest;
}
