import { describe, expect, it } from "vitest";
import {
  OfflineDictionary,
  type BakedDictionary,
} from "../src/dict/offline-dictionary";

// Fixture mirrors the baked asset's real shapes: mixed-case forms,
// inflected forms riding the inflection index, ECDICT-phonetic-only words,
// thin pointer entries on inflected forms, and words no table knows
// (CODING_STANDARDS: fixtures mirror real data).
const FIXTURE: BakedDictionary = {
  ipa: { woke: "woʊk", calm: "kɑːm", run: "rʌn" },
  inflections: { runs: "run", books: "book" },
  entries: {
    woke: { p: "wəʊk", t: "v. 醒来\nn. 醒来后的状态" },
    serene: { p: "səˈriːn", t: "adj. 平静的" },
    run: { p: "", t: "v. 跑" },
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

describe("OfflineDictionary — lookup (ticket 04 popup entry)", () => {
  it("returns word, lemma, IPA with provenance, pos, translation", () => {
    expect(dictionary().lookup("Woke")).toEqual({
      word: "woke",
      lemma: null,
      ipa: "woʊk",
      ipaSource: "form",
      pos: "v. n.",
      translation: "v. 醒来\nn. 醒来后的状态",
    });
  });

  it("resolves inflected forms through the lemma (runs → run)", () => {
    expect(dictionary().lookup("runs")).toEqual({
      word: "runs",
      lemma: "run",
      ipa: "rʌn",
      ipaSource: "lemma",
      pos: "v.",
      translation: "v. 跑",
    });
  });

  it("answers null when no entry exists — zero-write territory", () => {
    // IPA alone is not an entry: the server's lookupWord contract is the
    // ECDICT entry (lemma's own first), so the popup can report 未收录
    // and the store writes nothing.
    expect(dictionary().lookup("calm")).toBeNull();
    expect(dictionary().lookup("xqzzz")).toBeNull();
    expect(dictionary().lookup("")).toBeNull();
  });

  it("stateKey folds to the lemma — states go cross-form", () => {
    expect(dictionary().stateKey("runs")).toBe("run");
    expect(dictionary().stateKey("Woke")).toBe("woke");
  });
});
