// The translation seam of the on-demand translation (ADR-0004), ported
// from apps/server/src/translate/translator.ts (mobile-app ticket 04).
// The chapter task depends on this interface only, so tests replace
// DeepSeek with a fake translator and the provider stays swappable.

// One translation request over a batch of sentences. Returns exactly one
// entry per input sentence, in order: the Simplified Chinese translation,
// or null when that sentence could not be translated. The contract is
// total — a translator never throws. A provider that is unreachable,
// rate-limited, or returns garbage reports every sentence of the batch as
// null, so a single bad batch only wastes its own work.
export type Translator = {
  translateBatch: (sentences: string[]) => Promise<(string | null)[]>;
};
