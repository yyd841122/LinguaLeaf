import { describe, expect, it } from "vitest";
import { lookupWord } from "../src/dict/dictionary.js";
import { parseExchangeRanked } from "../src/dict/import-ecdict.js";
import { buildIpaLine, tokenizeWords } from "../src/dict/ipa-line.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";

describe("lookupWord resolution chain", () => {
  it("finds a common word by its exact form", () => {
    const dictionary = createFixtureDictionary();
    expect(lookupWord(dictionary, "book")).toEqual({
      word: "book",
      lemma: null,
      ipa: "bʊk",
      pos: "n. v.",
      translation: "n. 书, 簿, 账册\nv. 预订, 登记",
    });
    dictionary.close();
  });

  it("resolves inflected forms through the lemma", () => {
    const dictionary = createFixtureDictionary();
    expect(lookupWord(dictionary, "wrote")).toEqual({
      word: "wrote",
      lemma: "write",
      ipa: "roʊt",
      pos: "v.",
      translation: "v. 写, 作曲, 写信",
    });
    // "books" has its own American IPA entry, so the plural keeps /s/.
    expect(lookupWord(dictionary, "books")).toMatchObject({
      lemma: "book",
      ipa: "bʊks",
    });
    dictionary.close();
  });

  it("sees through pointer-only inflected entries to the lemma entry", () => {
    const dictionary = createFixtureDictionary();
    expect(lookupWord(dictionary, "went")).toEqual({
      word: "went",
      lemma: "go",
      ipa: "wɛnt",
      pos: "v. n.",
      translation: "v. 去, 走, 驶\nn. 轮到的机会",
    });
    dictionary.close();
  });

  it("normalizes case and curly apostrophes before looking up", () => {
    const dictionary = createFixtureDictionary();
    expect(lookupWord(dictionary, "Books")).toMatchObject({ word: "books" });
    expect(lookupWord(dictionary, "WRITES")).toMatchObject({
      lemma: "write",
    });
    dictionary.close();
  });

  it("returns null for words no source knows", () => {
    const dictionary = createFixtureDictionary();
    expect(lookupWord(dictionary, "iguana")).toBeNull();
    expect(lookupWord(dictionary, "   ")).toBeNull();
    dictionary.close();
  });
});

describe("parseExchangeRanked: ECDICT exchange field to ranked pairs", () => {
  // Ranks matter to the importer: explicit `0:` mappings insert first and
  // win INSERT OR IGNORE over another entry's inferred forms (audit
  // 2026-10-23 — first-wins let "has" resolve to "ha").
  it("maps a base word's tense and plural forms back to the base word, inferred", () => {
    expect(
      parseExchangeRanked(
        "perceive",
        "d:perceived/p:perceived/3:perceives/i:perceiving"
      )
    ).toEqual({
      explicit: [],
      inferred: [
        ["perceived", "perceive"],
        ["perceives", "perceive"],
        ["perceiving", "perceive"],
      ],
    });
  });

  it("maps an inflected entry to its lemma via the 0: field, explicit", () => {
    expect(parseExchangeRanked("books", "1:s3/0:book")).toEqual({
      explicit: [["books", "book"]],
      inferred: [],
    });
  });

  it("skips type codes, self references, and garbage parts", () => {
    // 1: holds a transformation type code (s3, pd), not a word.
    expect(parseExchangeRanked("travelled", "0:travel/1:pd")).toEqual({
      explicit: [["travelled", "travel"]],
      inferred: [],
    });
    // A lemma entry pointing at itself carries no information.
    expect(parseExchangeRanked("lay", "0:lay/i:laying")).toEqual({
      explicit: [],
      inferred: [["laying", "lay"]],
    });
    expect(parseExchangeRanked("fast", "r:faster/t:fastest")).toEqual({
      explicit: [],
      inferred: [
        ["faster", "fast"],
        ["fastest", "fast"],
      ],
    });
    expect(parseExchangeRanked("word", "")).toEqual({
      explicit: [],
      inferred: [],
    });
    expect(parseExchangeRanked("word", "weird-part-without-colon")).toEqual({
      explicit: [],
      inferred: [],
    });
  });
});

describe("tokenizeWords", () => {
  it("extracts letter words, keeping internal hyphens and apostrophes", () => {
    expect(tokenizeWords("He wrote 12 well-written books!")).toEqual([
      "He",
      "wrote",
      "well-written",
      "books",
    ]);
    expect(tokenizeWords("don’t stop")).toEqual(["don’t", "stop"]);
    expect(tokenizeWords("1984.")).toEqual([]);
  });
});

describe("buildIpaLine: per-word IPA slots", () => {
  it("joins each word's American IPA with single spaces", () => {
    const dictionary = createFixtureDictionary();
    expect(buildIpaLine(dictionary, "He wrote books!")).toBe("hi roʊt bʊks");
    dictionary.close();
  });

  it("falls back to the ECDICT phonetic when ipa-dict has no entry", () => {
    const dictionary = createFixtureDictionary();
    expect(buildIpaLine(dictionary, "zebra wrote books")).toBe(
      "zebrə roʊt bʊks"
    );
    dictionary.close();
  });

  it("leaves an empty slot for unknown words without losing the rest", () => {
    const dictionary = createFixtureDictionary();
    // A middle slot stays empty (two spaces) so each IPA keeps its word.
    expect(buildIpaLine(dictionary, "zebra xqzzz wrote books")).toBe(
      "zebrə  roʊt bʊks"
    );
    // Trailing empties are trimmed away.
    expect(buildIpaLine(dictionary, "He wrote xqzzz.")).toBe("hi roʊt");
    expect(buildIpaLine(dictionary, "xqzzz qqqq.")).toBe("");
    dictionary.close();
  });
});
