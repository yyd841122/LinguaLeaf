import { describe, expect, it } from "vitest";
import { splitSentences } from "../src/sentences.js";

describe("splitSentences", () => {
  it("splits on newlines without eating the punctuation beside them", () => {
    // sbd's newline_boundaries mode swapped newlines for a sentinel and ate
    // punctuation runs beside it ("Wait----" lost its dashes); the
    // split-first walk keeps the text intact (audit 2026-10-23).
    expect(splitSentences("Wait----\nstop!")).toEqual(["Wait----", "stop!"]);
    expect(splitSentences("First one.\nSecond one.")).toEqual([
      "First one.",
      "Second one.",
    ]);
  });

  it("still splits abbreviations inside a single line", () => {
    expect(splitSentences("Mr. Gupta woke early. The sea was calm.")).toEqual([
      "Mr. Gupta woke early.",
      "The sea was calm.",
    ]);
  });
});
