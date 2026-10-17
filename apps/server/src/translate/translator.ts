// The translation seam of the import pipeline (ticket 04). The pipeline
// depends on this interface only, so tests replace DeepSeek with a fake
// translator and the provider stays swappable.

// One translation request over a batch of sentences. Returns exactly one
// entry per input sentence, in order: the Simplified Chinese translation,
// or null when that sentence could not be translated. The contract is
// total — a translator never throws. A provider that is unreachable,
// rate-limited, or returns garbage reports every sentence of the batch as
// null, so a single bad batch delays an import instead of failing it.
export type Translator = {
  translateBatch: (sentences: string[]) => Promise<(string | null)[]>;
};
