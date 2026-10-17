import type { Translator } from "./translator.js";

// Sentences per translation request. Large enough that DeepSeek's
// per-request overhead amortizes, small enough that one malformed reply
// wastes little work and prompts stay well under context limits.
export const SENTENCES_PER_BATCH = 20;

// How many times a sentence may be requested before the import gives up on
// it and leaves its translation empty (spec: 最终翻译失败的句子译文留空).
export const MAX_TRANSLATION_ROUNDS = 3;

// One aligned batch result: a translation per input sentence, null where
// the translator could not deliver (missing, blank, or out of range).
function alignBatch(
  batch: string[],
  returned: (string | null)[]
): (string | null)[] {
  return batch.map((_, index) => {
    const translation = returned[index];
    return typeof translation === "string" && translation.trim().length > 0
      ? translation.trim()
      : null;
  });
}

// Translates every sentence of a book: batches the list, requests each
// batch through the translator, and re-requests only the sentences that
// came back failed (null) until they translate or the rounds run out.
// Returns one entry per input sentence; entries left null after the final
// round are the sentences whose translation the import gives up on.
export async function translateSentences(
  translator: Translator,
  sentences: string[]
): Promise<(string | null)[]> {
  const translations: (string | null)[] = sentences.map(() => null);
  // The retry queue carries each sentence with its position, so batches
  // never re-derive sentences from indices.
  let pending = sentences.map((sentence, index) => ({ index, sentence }));
  for (
    let round = 0;
    round < MAX_TRANSLATION_ROUNDS && pending.length > 0;
    round += 1
  ) {
    const failed: { index: number; sentence: string }[] = [];
    for (let start = 0; start < pending.length; start += SENTENCES_PER_BATCH) {
      const entries = pending.slice(start, start + SENTENCES_PER_BATCH);
      const batch = entries.map((entry) => entry.sentence);
      const returned = alignBatch(
        batch,
        await translator.translateBatch(batch)
      );
      entries.forEach((entry, position) => {
        const translation = returned[position] ?? null;
        if (translation === null) {
          failed.push(entry);
        } else {
          translations[entry.index] = translation;
        }
      });
    }
    pending = failed;
  }
  return translations;
}

// Chapter-shaped entry point for the import pipeline: sentences arrive per
// chapter in book order, translations come back in the same shape.
// Requests still batch across chapter boundaries, so back-to-back short
// chapters share one call.
export async function translateChapters(
  translator: Translator,
  sentencesByChapter: string[][]
): Promise<(string | null)[][]> {
  const sentencesByChapterWithoutTranslations = sentencesByChapter.map(
    () => [] as (string | null)[]
  );
  if (!sentencesByChapter.some((sentences) => sentences.length > 0)) {
    return sentencesByChapterWithoutTranslations;
  }
  const translations = await translateSentences(
    translator,
    sentencesByChapter.flat()
  );
  const byChapter: (string | null)[][] = [];
  let cursor = 0;
  for (const sentences of sentencesByChapter) {
    byChapter.push(translations.slice(cursor, cursor + sentences.length));
    cursor += sentences.length;
  }
  return byChapter;
}
