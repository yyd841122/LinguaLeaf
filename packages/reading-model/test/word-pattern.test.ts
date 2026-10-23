import { describe, expect, it } from "vitest";
import { WORD_PATTERN } from "../src/word-pattern.js";

describe("WORD_PATTERN", () => {
  it("keeps apostrophe and hyphen joins inside a word", () => {
    expect("don't well-written".match(WORD_PATTERN)).toEqual([
      "don't",
      "well-written",
    ]);
  });

  it("gives numbers and standalone punctuation no match", () => {
    expect("3 dogs, 4 cats.".match(WORD_PATTERN)).toEqual(["dogs", "cats"]);
  });

  it("is global — the matchAll walk on both frontends relies on it", () => {
    expect(WORD_PATTERN.flags).toContain("g");
  });
});
