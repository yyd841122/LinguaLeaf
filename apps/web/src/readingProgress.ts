import { ApiError, fetchJson } from "./api";

// Where a reader stopped in a book: chapter position + block position
// within that chapter (the same positions the API and data-position
// attributes use). Stored server-side so it survives any device.
export type ReadingProgress = {
  chapter: number;
  block: number;
};

// Fetches the saved position. A 404 reads as null — the book was never
// read. Any other failure throws: "could not ask" must not masquerade as
// "never read", or the chapter-start autosave would silently overwrite the
// reader's real position with top-of-chapter (the caller parks the state
// as "unavailable" instead and saves nothing until a real scroll).
export async function fetchReadingProgress(
  bookId: number
): Promise<ReadingProgress | null> {
  try {
    return await fetchJson<ReadingProgress>(`/api/books/${bookId}/progress`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

// Fire-and-forget friendly: keepalive lets the PUT survive page unload.
export async function saveReadingProgress(
  bookId: number,
  progress: ReadingProgress
): Promise<void> {
  await fetchJson(`/api/books/${bookId}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(progress),
    keepalive: true,
  });
}

// The topmost block still poking into the viewport — the sentence the
// reader is on. Blocks carry data-position from the server. Returns null
// when nothing is measurable (empty chapter).
//
// Binary-searched over document order: blocks lay out top to bottom, so
// "bottom > 0" flips from false to true exactly once — log2(n) layout reads
// instead of one per block on every scroll event (a 700-block chapter paid
// 700 reads per tick — audit 2026-10-23).
export function topmostVisibleBlock(): number | null {
  const container = document.querySelector(".blocks");
  if (!container) return null;
  // The live NodeList indexes directly — no per-scroll array copy.
  const blocks = container.querySelectorAll<HTMLElement>("[data-position]");
  let low = 0;
  let high = blocks.length - 1;
  let answer: number | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = blocks[mid];
    if (!candidate) break;
    if (candidate.getBoundingClientRect().bottom > 0) {
      answer = Number(candidate.dataset.position);
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return answer;
}
