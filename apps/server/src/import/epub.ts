import { posix } from "node:path";
import { UploadRejected } from "./upload-rejection.js";
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
// document, a spine document missing from the archive. These reject the
// upload as the invalid-epub wire reason (a 400); anything downstream of
// extraction (sentence splitting, annotation) cannot fail the import.
const invalidEpub = (message: string): UploadRejected =>
  new UploadRejected("invalid-epub", `invalid EPUB: ${message}`);

// Namespace prefixes vary across EPUBs (opf:itemref, bare itemref);
// structural selectors match on the local name so a valid prefixed package
// is not mistaken for an empty one (audit 2026-10-23).
const localNameOf = (element: unknown): string => {
  const tagName = (element as { tagName?: string } | null)?.tagName ?? "";
  return tagName.split(":").pop()?.toLowerCase() ?? "";
};

// Decompression budget: a tiny zip can expand enormously, and every member
// here lands in memory as a string (audit 2026-10-23: a 3 KB EPUB expanded
// to 2 MB of text — unbounded, that is a bomb dial).
const MAX_MEMBER_CHARS = 4 * 1024 * 1024;
const MAX_TOTAL_CHARS = 32 * 1024 * 1024;
const MAX_SPINE_DOCUMENTS = 512;
const MAX_ZIP_ENTRIES = 4096;

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
    throw invalidEpub("not a valid EPUB (ZIP) file");
  }
  if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) {
    throw invalidEpub(`EPUB holds over ${MAX_ZIP_ENTRIES} archive entries`);
  }

  let totalChars = 0;
  const zipText = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) throw invalidEpub(`EPUB is missing ${path}`);
    // Pre-decode budget from the central directory, where JSZip records the
    // uncompressed size: an oversized member is rejected before its bytes
    // are ever allocated (audit 2026-10-23, verification round). The field
    // is JSZip-internal, so a missing value falls through to the post-
    // decode check below rather than assuming safety.
    const uncompressedSize = (
      file as unknown as { _data?: { uncompressedSize?: number } }
    )._data?.uncompressedSize;
    if (uncompressedSize !== undefined && uncompressedSize > MAX_MEMBER_CHARS) {
      throw invalidEpub(`EPUB member ${path} exceeds the decompression budget`);
    }
    let text: string;
    try {
      text = await file.async("string");
    } catch {
      // Archive corruption surfaces as a native decode error; a broken
      // upload is the client's 400, not a server 500 (audit 2026-10-23).
      throw invalidEpub(`EPUB member ${path} could not be decompressed`);
    }
    totalChars += text.length;
    if (text.length > MAX_MEMBER_CHARS || totalChars > MAX_TOTAL_CHARS) {
      throw invalidEpub(`EPUB member ${path} exceeds the decompression budget`);
    }
    return text;
  };

  const firstByLocalName = (
    scope: ReturnType<typeof cheerio.load>,
    name: string
  ) =>
    scope("*")
      .toArray()
      .find((element) => localNameOf(element) === name);

  const container = cheerio.load(await zipText("META-INF/container.xml"), {
    xmlMode: true,
  });
  const rootfile = firstByLocalName(container, "rootfile");
  const packagePath = rootfile
    ? container(rootfile).attr("full-path")
    : undefined;
  if (!packagePath) {
    throw invalidEpub("container.xml names no package document");
  }

  const opf = cheerio.load(await zipText(packagePath), { xmlMode: true });
  const metadata = firstByLocalName(opf, "metadata");
  const titleElement = metadata
    ? opf(metadata)
        .children()
        .toArray()
        .find((element) => localNameOf(element) === "title")
    : undefined;
  const metadataTitle = titleElement ? opf(titleElement).text().trim() : "";

  // Manifest maps spine idrefs to hrefs; hrefs resolve against the package
  // document's directory.
  const packageDir = posix.dirname(packagePath);
  const hrefsById = new Map<string, string>();
  const manifest = firstByLocalName(opf, "manifest");
  if (manifest) {
    for (const item of opf(manifest)
      .children()
      .toArray()
      .filter((element) => localNameOf(element) === "item")) {
      const id = opf(item).attr("id");
      const href = opf(item).attr("href");
      if (id && href) hrefsById.set(id, href);
    }
  }
  const spine = firstByLocalName(opf, "spine");
  const itemrefs = spine
    ? opf(spine)
        .children()
        .toArray()
        .filter((element) => localNameOf(element) === "itemref")
    : [];
  if (itemrefs.length > MAX_SPINE_DOCUMENTS) {
    throw invalidEpub(
      `spine lists ${itemrefs.length} documents, over the ${MAX_SPINE_DOCUMENTS} cap`
    );
  }
  const documents: { title: string | null; body: string }[] = [];
  for (const itemref of itemrefs) {
    const idref = opf(itemref).attr("idref") ?? "";
    const href = hrefsById.get(idref);
    if (!href) {
      // An idref the manifest cannot resolve is a broken spine — every
      // reader would hit the gap, so reject instead of silently publishing
      // a book missing its pieces (audit 2026-10-23).
      throw invalidEpub(`spine references unknown manifest id "${idref}"`);
    }
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

  if (documents.length === 0) {
    throw invalidEpub("spine resolved to no readable documents");
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
