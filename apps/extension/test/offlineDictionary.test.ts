import { describe, expect, it } from "vitest";
import {
  OfflineDictionary,
  type BakedDictionary,
} from "../src/dict/offline-dictionary";

// Fixture mirrors the baked asset's real shapes: mixed-case forms,
// inflected forms riding the inflection index, ECDICT-phonetic-only words,
// and words no table knows (CODING_STANDARDS: fixtures mirror real data).
const FIXTURE: BakedDictionary = {
  ipa: { woke: "woʊk", calm: "kɑːm", run: "rʌn" },
  inflections: { runs: "run", books: "book" },
  entries: {
    woke: { p: "wəʊk", t: "v. 醒来" },
    serene: { p: "səˈriːn", t: "adj. 平静的" },
  },
};
const dictionary = () => new OfflineDictionary(FIXTURE);

describe("OfflineDictionary — resolveIpa", () => {
  it("answers from the form's own American IPA first", () => {
    expect(dictionary().resolveIpa("woke")).toEqual({
      ipa: "woʊk",
      source: "form",
    });
  });

  it("folds the token before looking (Woke reads like woke)", () => {
    expect(dictionary().resolveIpa("Woke")).toEqual({
      ipa: "woʊk",
      source: "form",
    });
  });

  it("falls back through the inflection index and discloses the lemma", () => {
    // runs has no ipa of its own; run's reading answers, and the source
    // says lemma so the popup (ticket 04) can disclose it — never pass a
    // lemma reading off as the form's own (spec: 词元回退不冒充).
    expect(dictionary().resolveIpa("runs")).toEqual({
      ipa: "rʌn",
      source: "lemma",
    });
  });

  it("falls back to the baked ECDICT phonetic, form before lemma", () => {
    expect(dictionary().resolveIpa("serene")).toEqual({
      ipa: "səˈriːn",
      source: "form",
    });
  });

  it("answers null for a word no table knows — the slot stays empty", () => {
    expect(dictionary().resolveIpa("xqzzz")).toBeNull();
    expect(dictionary().resolveIpa("123")).toBeNull();
    expect(dictionary().resolveIpa("")).toBeNull();
  });

  it("an empty baked asset behaves as no dictionary", () => {
    const empty = new OfflineDictionary({
      ipa: {},
      inflections: {},
      entries: {},
    });
    expect(empty.resolveIpa("woke")).toBeNull();
  });
});
