import type { ExtBook } from "../reader/import-book";

// Canonical chapters/blocks, independent of object property order and
// dictionary-generated IPA. Normalize encoding and line endings only:
// whitespace, block kinds/order and chapter boundaries remain significant.
export async function bookFingerprint(book: ExtBook): Promise<string> {
  const text = (value: string) =>
    value.normalize("NFC").replace(/\r\n?/g, "\n");
  const canonical = JSON.stringify(
    book.chapters.map((chapter) => [
      text(chapter.title),
      chapter.level,
      chapter.blocks.map((block) => [block.kind, text(block.text)]),
    ])
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  return `sha256-v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export class DocumentReplacementRequired extends Error {
  constructor(readonly previousFingerprint: string) {
    super("新书内容与原书不同，需要确认替换");
  }
}

export async function checkReplacement(
  existing: { book: ExtBook; fingerprint?: string } | undefined,
  fingerprint: string,
  replaceFingerprint: string | undefined
): Promise<void> {
  if (!existing) return;
  const previous =
    existing.fingerprint ?? (await bookFingerprint(existing.book));
  if (previous !== fingerprint && replaceFingerprint !== previous) {
    throw new DocumentReplacementRequired(previous);
  }
}
