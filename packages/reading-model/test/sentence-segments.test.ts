import { describe, expect, it } from "vitest";
import { segmentOriginal } from "../src/sentence-segments.js";

describe("segmentOriginal", () => {
  it("pairs each word with its slot and keeps the gaps as text", () => {
    const { paired, segments } = segmentOriginal("Mr. Gupta woke.", [
      "",
      "ˈɡʊptə",
      "ˈwoʊk",
    ]);
    expect(paired).toBe(true);
    expect(segments).toEqual([
      { kind: "word", word: "Mr", ipa: "" },
      { kind: "text", text: ". " },
      { kind: "word", word: "Gupta", ipa: "ˈɡʊptə" },
      { kind: "text", text: " " },
      { kind: "word", word: "woke", ipa: "ˈwoʊk" },
      { kind: "text", text: "." },
    ]);
  });

  it("hands the frontends the tail after the last word, however small", () => {
    const { segments } = segmentOriginal("Books", ["books"]);
    expect(segments).toEqual([
      { kind: "word", word: "Books", ipa: "books" },
      { kind: "text", text: "" },
    ]);
  });

  it("falls back unpaired when slots are null", () => {
    const { paired, segments } = segmentOriginal("two words", null);
    expect(paired).toBe(false);
    expect(segments.every((s) => s.kind !== "word" || s.ipa === null)).toBe(
      true
    );
  });

  it("falls back unpaired when the slot count no longer matches", () => {
    const { paired, segments } = segmentOriginal("two words", ["a"]);
    expect(paired).toBe(false);
    // The exact shape, not just "no IPA": a change that dropped every
    // segment on mismatch — losing the original line and its lookup
    // targets — passed the old every-check (audit 2026-10-23).
    expect(segments).toEqual([
      { kind: "word", word: "two", ipa: null },
      { kind: "text", text: " " },
      { kind: "word", word: "words", ipa: null },
      { kind: "text", text: "" },
    ]);
  });
});
