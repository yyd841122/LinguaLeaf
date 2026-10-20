import { ApiError } from "./api";

// Download a file attachment via fetch → Blob rather than a plain link: a
// 404/409/500 or a network error becomes a catchable failure the shelf can
// render as a message, instead of the browser saving the error page (spec:
// 导出不落盘错误响应). Not fetchJson — the body is bytes, not JSON.
export async function downloadAttachment(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(response.status, url, "GET");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = sanitizeFilename(
    filenameFromDisposition(response.headers.get("content-disposition"))
  );
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Chrome/Firefox fine revoking in the same tick as the click; some
  // WebKit/Safari versions abort the download — observed as a caution
  // during the ticket 03 smoke, not worked around.
  URL.revokeObjectURL(objectUrl);
}

// The server names the attachment (Express emits the RFC 5987 filename* form
// whenever the title is not plain ASCII; the quoted filename= form is its
// printable-ASCII fallback), so prefer the extended form — it is where the
// Chinese title survives.
function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const extended = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended.trim());
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }
  const plain = /filename=(?:"([^"]*)"|([^;]+))/i.exec(disposition);
  const captured = plain?.[1] ?? plain?.[2];
  return captured ? captured.trim() : null;
}

// The header is normally already clean (the server's annotatedBookFilename
// does the same pass), but this client cannot verify what a proxy or a
// future server change puts in the header: one local cleaning pass keeps a
// weird header from planting a name no filesystem accepts. Keep the rules
// identical to annotatedBookFilename — the two passes must agree on what a
// legal name is; variant tests on both sides pin the shared shapes.
function sanitizeFilename(name: string | null): string {
  // \p{Cc} covers the control characters no filesystem wants in a name
  // (written as the Unicode category — a literal \x00 range would trip the
  // no-control-regex rule).
  const cleaned = (name ?? "")
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    // Windows silently drops trailing dots and spaces on save.
    .replace(/[. ]+$/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "book.html";
}
