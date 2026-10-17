import type { Translator } from "../../src/translate/translator.js";

// A translator stub whose behavior each test scripts. It records every
// batch it receives (the input side of the seam, which is where the
// batching contract lives) and hands the batch to the test's script.
export function createFakeTranslator(
  translate: (
    sentences: string[]
  ) => (string | null)[] | Promise<(string | null)[]>
): Translator & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async translateBatch(sentences) {
      calls.push([...sentences]);
      return await translate(sentences);
    },
  };
}
