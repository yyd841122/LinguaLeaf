import JSZip from "jszip";

// EPUB fixtures built in-test from their parts: the structure (container,
// OPF, spine order, XHTML docs, image resources) stays visible and each
// test assembles exactly the messy shape it needs (encoded hrefs, missing
// spine resources, absent dc:title). The committed binary sample-book.epub
// next to this file is `createSampleEpub()` written to disk, for manual
// acceptance uploads through the UI; a fixture test asserts it stays
// byte-identical to the builder.

// File timestamps are pinned so the builder output is byte-stable.
const FIXED_DATE = new Date("2026-10-18T00:00:00Z");

// A valid 1×1 PNG; content never leaves the pipeline (images become
// placeholders), only the manifest entry and the zip path matter.
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export type EpubDoc = {
  href: string;
  body: string;
  // <head><title> of the document — what a headingless document's chapter
  // falls back to. Defaults to "chapter".
  title?: string;
  // The href as written in the OPF manifest, when it differs from the zip
  // path (URL-encoded: "text/chapter%20one.xhtml" for a path with a space).
  manifestHref?: string;
};
export type EpubImage = { href: string };

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const xhtml = (
  title: string,
  body: string
) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body>${body}</body>
</html>`;

export type EpubPackage = {
  // Omitted or empty produces an OPF without dc:title.
  title?: string;
  docs: EpubDoc[];
  images?: EpubImage[];
  // Build the zip without the OPF the container points at (broken-book fixture).
  omitPackage?: boolean;
  // Zip paths to strip after building — a truncated archive whose spine
  // promises documents it no longer contains.
  dropFiles?: string[];
  // Spine order as indices into docs — defaults to manifest/zip order, so a
  // reader that walks either of those instead of the spine fails here
  // (audit 2026-10-23).
  spineOrder?: number[];
  // Namespace-prefix every OPF element (opf:package, opf:itemref, ...): a
  // valid package whose structural names carry a prefix (audit 2026-10-23 —
  // literal XML selectors read such a book as empty).
  prefixOpf?: boolean;
};

export async function buildEpub(book: EpubPackage): Promise<Buffer> {
  const zip = new JSZip();
  // The mimetype entry is conventionally first and uncompressed.
  zip.file("mimetype", "application/epub+zip", {
    compression: "STORE",
    date: FIXED_DATE,
    createFolders: false,
  });
  zip.file("META-INF/container.xml", CONTAINER_XML, {
    date: FIXED_DATE,
    createFolders: false,
  });
  const tag = (name: string): string => (book.prefixOpf ? `opf:${name}` : name);
  const manifestItems = [
    ...book.docs.map(
      (doc, index) =>
        `<${tag("item")} id="doc${index}" href="${doc.manifestHref ?? doc.href}" media-type="application/xhtml+xml"/>`
    ),
    ...(book.images ?? []).map(
      (image, index) =>
        `<${tag("item")} id="img${index}" href="${image.href}" media-type="image/png"/>`
    ),
  ];
  const spineItems = (book.spineOrder ?? book.docs.map((_doc, index) => index))
    .map((docIndex) => `<${tag("itemref")} idref="doc${docIndex}"/>`)
    .join("");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<${tag("package")} xmlns${book.prefixOpf ? ":opf" : ""}="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <${tag("metadata")} xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:lingualeaf-sample</dc:identifier>${
      book.title ? `\n    <dc:title>${book.title}</dc:title>` : ""
    }
    <dc:language>en</dc:language>
  </${tag("metadata")}>
  <${tag("manifest")}>${manifestItems.join("")}</${tag("manifest")}>
  <${tag("spine")}>${spineItems}</${tag("spine")}>
</${tag("package")}>`;
  if (!book.omitPackage) {
    zip.file("OEBPS/content.opf", opf, {
      date: FIXED_DATE,
      createFolders: false,
    });
  }
  for (const doc of book.docs) {
    zip.file(`OEBPS/${doc.href}`, xhtml(doc.title ?? "chapter", doc.body), {
      date: FIXED_DATE,
      createFolders: false,
    });
  }
  for (const image of book.images ?? []) {
    zip.file(`OEBPS/${image.href}`, ONE_BY_ONE_PNG, {
      date: FIXED_DATE,
      createFolders: false,
    });
  }
  for (const dropped of book.dropFiles ?? []) {
    zip.remove(dropped);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

// The seam test's book: title page, an illustrated chapter (paragraph, two
// images — one bare, one in a figure with caption), a two-sentence chapter.
export function createSampleEpub(): Promise<Buffer> {
  return buildEpub({
    title: "Sample EPUB Book",
    docs: [
      {
        href: "text/title.xhtml",
        body: `<h1>The Sample EPUB</h1>
<p>He wrote the book on quiet reading.</p>
<p>A second paragraph keeps the spine honest.</p>`,
      },
      {
        href: "text/pictures.xhtml",
        body: `<h2>Chapter One: Pictures</h2>
<p>A picture sits between two sentences.</p>
<p><img src="../images/dot.png" alt="A red dot"/></p>
<p>The story continues after the picture.</p>
<figure><img src="../images/square.png" alt="A blue square"/><figcaption>The square closes the chapter.</figcaption></figure>`,
      },
      {
        href: "text/words.xhtml",
        body: `<h2>Chapter Two: Words</h2>
<p>Zebras cannot read. Yet the book remains calm!</p>`,
      },
    ],
    images: [{ href: "images/dot.png" }, { href: "images/square.png" }],
  });
}
