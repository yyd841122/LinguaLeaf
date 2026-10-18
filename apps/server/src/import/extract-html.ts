import * as cheerio from "cheerio";

export type ParagraphItem = { kind: "paragraph"; text: string };
export type CodeItem = { kind: "code"; text: string };
export type RawItem = { kind: "raw"; text: string };
export type ImageItem = { kind: "image"; text: string };
export type ContentItem = ParagraphItem | CodeItem | RawItem | ImageItem;

export type ExtractedChapter = {
  title: string;
  // Heading level (h1-h6) of the chapter title; null for the untitled lead-in
  // chapter that holds content before the first heading.
  level: number | null;
  items: ContentItem[];
};

// Wrapper elements whose children are visited in order instead of the
// element being flattened into one text run: EPUB spine documents wrap their
// content in divs/sections, and lists/blockquotes/figures carry prose and
// images that would otherwise vanish or merge into a single blob.
const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "aside",
  "figure",
  "blockquote",
  "ul",
  "ol",
]);
// Elements that may legally sit inside a paragraph-shaped element but are
// block-shaped: flushed text runs stop there and the element is re-dispatched
// to the top-level walk (a list inside a list item stays separate items).
const INNER_BLOCK_TAGS = new Set(["p", "pre", "table", "hr"]);

// Shared extraction path: both Markdown (after markdown-it) and EPUB (after
// the spine documents' bodies are joined) land here. Walk elements in
// document order; headings open chapters and never become sentence blocks;
// fenced code blocks pass through verbatim as `code` items; paragraphs are
// sentence-split downstream except link-bearing runs, which stay `raw`;
// images become placeholder items that keep their reading position
// (ticket 07).
export function extractChaptersFromHtml(html: string): ExtractedChapter[] {
  const $ = cheerio.load(html);
  type Node = ReturnType<typeof $>;
  const chapters: ExtractedChapter[] = [];
  let current: ExtractedChapter = { title: "", level: null, items: [] };
  chapters.push(current);

  const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

  const openChapter = (title: string, level: number) => {
    current = { title, level, items: [] };
    chapters.push(current);
  };

  // Cheerio's child collections are AnyNode unions (text nodes, comments,
  // ...); only elements carry a tagName.
  const tagNameOf = (node: Node): string => {
    const first = node.get(0);
    return first && "tagName" in first ? first.tagName.toLowerCase() : "";
  };

  const imageItem = (node: Node): ImageItem => ({
    kind: "image",
    text: collapseWhitespace(node.attr("alt") ?? ""),
  });

  const visit = (node: Node) => {
    const tag = tagNameOf(node);
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      openChapter(
        collapseWhitespace(node.text()) || "Untitled",
        Number(heading[1])
      );
      return;
    }
    // Paragraph-shaped: li and figcaption read like paragraphs of prose.
    if (tag === "p" || tag === "figcaption" || tag === "li" || tag === "dd") {
      addParagraphContent(node);
      return;
    }
    if (tag === "pre") {
      const code = node.text().trim();
      if (code) current.items.push({ kind: "code", text: code });
      return;
    }
    if (tag === "img") {
      current.items.push(imageItem(node));
      return;
    }
    if (tag === "hr" || tag === "br") return;
    if (CONTAINER_TAGS.has(tag)) {
      for (const child of node.children().toArray()) visit($(child));
      return;
    }
    // Anything else with text passes through verbatim rather than silently
    // dropping content (tables, definitions, ...).
    const passthrough = collapseWhitespace(node.text());
    if (passthrough) current.items.push({ kind: "raw", text: passthrough });
  };

  // Paragraph-shaped content joins the chapter in document order: text runs
  // become paragraph items (raw when they carry a link), embedded images
  // become placeholder items, so an illustration keeps its reading position.
  function addParagraphContent(element: Node) {
    let run = "";
    let runHasLink = false;

    const flushRun = () => {
      const text = collapseWhitespace(run);
      if (text) {
        current.items.push(
          runHasLink ? { kind: "raw", text } : { kind: "paragraph", text }
        );
      }
      run = "";
      runHasLink = false;
    };

    const walk = (node: Node) => {
      for (const child of node.contents().toArray()) {
        if (child.type === "text") {
          run += $(child).text();
          continue;
        }
        const tag = tagNameOf($(child));
        if (tag === "img") {
          flushRun();
          current.items.push(imageItem($(child)));
          continue;
        }
        if (tag === "br") {
          run += " ";
          continue;
        }
        if (CONTAINER_TAGS.has(tag) || INNER_BLOCK_TAGS.has(tag)) {
          flushRun();
          visit($(child));
          continue;
        }
        if (tag === "a") runHasLink = true;
        walk($(child));
      }
    };
    walk(element);
    flushRun();
  }

  for (const element of $("body").children().toArray()) visit($(element));
  // The untitled lead-in only exists when content precedes the first heading;
  // an empty shell would just be TOC noise. An image-only lead-in survives —
  // an EPUB cover keeps its position as the book's first page.
  const [leadIn, ...rest] = chapters;
  return leadIn && leadIn.items.length > 0 ? chapters : rest;
}

// Book-title ladder shared by the format front halves: the format's own
// metadata title (EPUB dc:title) wins, then the first chapter heading, then
// the file name.
export function deriveBookTitle(
  preferred: string | null | undefined,
  chapters: ExtractedChapter[],
  filename: string,
  extension: RegExp
): string {
  const firstHeading = chapters.find(
    (chapter) => chapter.level !== null
  )?.title;
  return (
    preferred?.trim() ||
    firstHeading ||
    filename.replace(extension, "").trim() ||
    "Untitled"
  );
}
