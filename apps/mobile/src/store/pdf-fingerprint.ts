export const PDF_DOC_ID_PREFIX = "pdf:sha256-v1:";

// Hash before pdf.js receives the buffer (it may transfer/detach it).
// Every byte participates, including pages beyond the scanned sample.
export async function pdfFingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `${PDF_DOC_ID_PREFIX}${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
