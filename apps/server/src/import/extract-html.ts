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

  // Paragraph-shaped content joins the chapter: link-bearing paragraphs stay
  // unsplit `raw` items, everything else is sentence-split downstream.
  const addParagraph = (paragraph: ReturnType<typeof $>) => {
    const text = paragraph.text().replace(/\s+/g, " ").trim();
    // Empty paragraphs (e.g. image-only, until ticket 07 adds placeholders) are dropped.
    if (!text) return;
    current.items.push(
      paragraph.find("a").length > 0
        ? { kind: "raw", text }
        : { kind: "paragraph", text }
    );
  };

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
      addParagraph(node);
      continue;
    }
    // Lists and blockquotes are prose: their items/paragraphs are annotated
    // like any other paragraph instead of vanishing from the book.
    if (tag === "ul" || tag === "ol") {
      node.find("li").each((_index, li) => addParagraph($(li)));
      continue;
    }
    if (tag === "blockquote") {
      node.children("p").each((_index, p) => addParagraph($(p)));
      continue;
    }
    // Anything else with text passes through verbatim rather than silently
    // dropping content (tables, definitions, ...); ticket 07 refines this for
    // images.
    const passthrough = node.text().replace(/\s+/g, " ").trim();
    if (passthrough) current.items.push({ kind: "raw", text: passthrough });
  }
  // The untitled lead-in only exists when content precedes the first heading;
  // an empty shell would just be TOC noise.
  const [leadIn, ...rest] = chapters;
  return leadIn && leadIn.items.length > 0 ? chapters : rest;
}
