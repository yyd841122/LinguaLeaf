import { describe, expect, it } from "vitest";
import { translateSentences } from "../../src/translate/batch.js";
import { createFakeTranslator } from "../fixtures/translator.js";

describe("translateSentences", () => {
  it("requests sentences in order, batched instead of one by one", async () => {
    const sentences = Array.from(
      { length: 45 },
      (_, i) => `Sentence ${i + 1}.`
    );
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => `译:${sentence}`)
    );

    const translations = await translateSentences(translator, sentences);

    expect(translator.calls.map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(translations[0]).toBe("译:Sentence 1.");
    expect(translations[44]).toBe("译:Sentence 45.");
  });
});

describe("translateSentences retry", () => {
  it("retries only the sentences a batch failed and keeps the successes", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) =>
        sentence === "Two." && translator.calls.length === 1
          ? null
          : `译:${sentence}`
      )
    );

    const translations = await translateSentences(translator, [
      "One.",
      "Two.",
      "Three.",
    ]);

    expect(translations).toEqual(["译:One.", "译:Two.", "译:Three."]);
    expect(translator.calls[1]).toEqual(["Two."]);
  });

  it("treats a blank translation as a failure and retries it", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) =>
        sentence === "Blank." && translator.calls.length === 1
          ? "  "
          : `译:${sentence}`
      )
    );

    const translations = await translateSentences(translator, [
      "Blank.",
      "Full.",
    ]);

    expect(translations).toEqual(["译:Blank.", "译:Full."]);
    expect(translator.calls[1]).toEqual(["Blank."]);
  });
});

describe("translateSentences giving up", () => {
  it("stops retrying after the third round and leaves the failures null", async () => {
    const translator = createFakeTranslator((batch) =>
      batch.map((sentence) => (sentence === "Lost." ? null : `译:${sentence}`))
    );

    const translations = await translateSentences(translator, [
      "Lost.",
      "Kept.",
    ]);

    expect(translations).toEqual([null, "译:Kept."]);
    // Round 1 carries both sentences; rounds 2 and 3 carry only "Lost.".
    expect(translator.calls.length).toBe(3);
  });

  it("survives a translator that answers with a short, misaligned array", async () => {
    const translator = createFakeTranslator(() => []);

    const translations = await translateSentences(translator, ["One.", "Two."]);

    expect(translations).toEqual([null, null]);
    expect(translator.calls.length).toBe(3);
  });
});
