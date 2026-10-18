import { posix } from "node:path";
import JSZip from "jszip";
import * as cheerio from "cheerio";
import type { PreparedBook } from "./pipeline.js";
import {
  deriveBookTitle,
  extractChaptersFromHtml,
  type ExtractedChapter,
} from "./extract-html.js";

export const EPUB_EXTENSION = /\.epub$/i;

export function isEpubFilename(filename: string): boolean {
  return EPUB_EXTENSION.test(filename);
}

// A structurally broken upload — not a zip, no container, no package
// document, a spine document missing from the archive. The router reports
// this class as 400; anything downstream of extraction (sentence splitting,
// annotation) cannot fail the import.
export class EpubParseError extends Error {}

// Href segments are URL-encoded in the container (spaces as %20); a
// malformed escape falls back to the raw segment instead of throwing.
const decodeHref = (href: string) => {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
};

// The EPUB front half of the import: unzip, follow container.xml → package
// document → spine, and take each spine document's body through the same
// extraction as Markdown (ticket 07). Every spine document is a chapter
// boundary (按 spine 顺序抽取章节): a document with headings contributes its
// chapters in order, a headingless one (covers, title pages) becomes a
// single chapter titled from its <head><title>.
export async function readEpubBook(
  content: Buffer,
  filename: string
): Promise<PreparedBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(content);
  } catch {
    throw new EpubParseError("not a valid EPUB (ZIP) file");
  }

  const zipText = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) throw new EpubParseError(`EPUB is missing ${path}`);
    return file.async("string");
  };

  const container = cheerio.load(await zipText("META-INF/container.xml"), {
    xmlMode: true,
  });
  const packagePath = container("rootfile").first().attr("full-path");
  if (!packagePath) {
    throw new EpubParseError("container.xml names no package document");
  }

  const opf = cheerio.load(await zipText(packagePath), { xmlMode: true });
  const metadataTitle = opf("metadata")
    .children()
    .filter(
      (_index, element) => (element.tagName ?? "").toLowerCase() === "dc:title"
    )
    .first()
    .text()
    .trim();

  // Manifest maps spine idrefs to hrefs; hrefs resolve against the package
  // document's directory.
  const packageDir = posix.dirname(packagePath);
  const hrefsById = new Map<string, string>();
  for (const item of opf("manifest").find("item").toArray()) {
    const id = opf(item).attr("id");
    const href = opf(item).attr("href");
    if (id && href) hrefsById.set(id, href);
  }
  const documents: { title: string | null; body: string }[] = [];
  for (const itemref of opf("spine").find("itemref").toArray()) {
    const href = hrefsById.get(opf(itemref).attr("idref") ?? "");
    if (!href) continue;
    // Strip the fragment before resolving; a spine href rarely carries one.
    const path = posix
      .join(packageDir, decodeHref(href.replace(/#.*$/, "")))
      .replace(/^\.\//, "");
    const document = cheerio.load(await zipText(path));
    documents.push({
      title: document("head > title").first().text().trim() || null,
      body: document("body").html() ?? "",
    });
  }

  const chapters: ExtractedChapter[] = [];
  for (const document of documents) {
    const extracted = extractChaptersFromHtml(document.body);
    if (extracted.some((chapter) => chapter.level !== null)) {
      chapters.push(...extracted);
      continue;
    }
    // A headingless document folds into one chapter so it keeps its own
    // place in the 目录 instead of merging into a neighbouring chapter.
    const items = extracted.flatMap((chapter) => chapter.items);
    if (items.length === 0) continue;
    chapters.push({ title: document.title ?? "Untitled", level: null, items });
  }

  return {
    title: deriveBookTitle(metadataTitle, chapters, filename, EPUB_EXTENSION),
    format: "epub",
    chapters,
  };
}
