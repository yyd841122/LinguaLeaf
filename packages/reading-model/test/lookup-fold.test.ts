import { describe, expect, it } from "vitest";
import { normalizeLookupToken, normalizeToken } from "../src/lookup-fold.js";

describe("normalizeToken (the import fold)", () => {
  it("lowers case, folds the curly apostrophe, trims", () => {
    expect(normalizeToken("  Don’t ")).toBe("don't");
  });

  it("keeps edge punctuation — stripping is a lookup-side concern", () => {
    expect(normalizeToken("'book,'")).toBe("'book,'");
    // A source entry that only becomes a word after stripping ("3D" -> "d")
    // must stay out of the dictionary, so the fold never strips edges.
    expect(normalizeToken("3D")).toBe("3d");
  });
});

describe("normalizeLookupToken (the lookup fold)", () => {
  it("lands case, curly-quote, and edge-punctuation variants on one key", () => {
    expect(normalizeLookupToken("Books")).toBe("books");
    expect(normalizeLookupToken("don’t")).toBe("don't");
    // A leading apostrophe survives the edge strip (it rides inside the
    // allowed class) — the vocabulary never carries such keys (WORD_PATTERN
    // matches have none), so the shape only ever reads as a miss. Pinned,
    // not endorsed: this is the test that flips when the fold is
    // deliberately taught to strip leading apostrophes.
    expect(normalizeLookupToken("'book',")).toBe("'book'");
    expect(normalizeLookupToken("“well-known”")).toBe("well-known");
  });

  it("reads an over-long folded token as a miss", () => {
    // Not a word at any length past the cap; reading it as a miss bounds
    // every consumer's work (audit 2026-10-23).
    expect(normalizeLookupToken("a".repeat(65))).toBe("");
    expect(normalizeLookupToken("a".repeat(64))).toBe("a".repeat(64));
  });

  it("keeps internal apostrophes and hyphens through the edge strip", () => {
    expect(normalizeLookupToken("don't")).toBe("don't");
    expect(normalizeLookupToken("well-known")).toBe("well-known");
  });

  it("returns an empty key for punctuation-only clicks", () => {
    expect(normalizeLookupToken("—")).toBe("");
  });
});
