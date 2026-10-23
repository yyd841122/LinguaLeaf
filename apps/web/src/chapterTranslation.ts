import { fetchJson } from "./api";
import type { TranslationStatus } from "../../server/src/wire";

// The reading page's client half of the on-demand translation trigger
// (ADR-0004). The server's chapter payload carries the translation state
// beside the content (wire: 章载荷带 translationStatus); these are the
// three fields the button and the poll key on.
export type ChapterTranslationState = {
  translationStatus: TranslationStatus;
  translationPercent: number | null;
  translationError: string | null;
};

// Triggers the background translation of one chapter. The 202 body is the
// chapter payload in its brand-new translating state — the same shape the
// 1.5s poll reads back until the status leaves 'translating'. A 409 (the
// chapter is already translating, or no service is configured) throws as
// ApiError, so the caller can surface a catchable notice.
export async function translateChapter(
  bookId: number,
  chapterPosition: number
): Promise<ChapterTranslationState> {
  return fetchJson<ChapterTranslationState>(
    `/api/books/${bookId}/chapters/${chapterPosition}/translate`,
    { method: "POST" }
  );
}
