import { describe, expect, expectTypeOf, it } from "vitest";
import {
  applyStatusToBlocks,
  type StatusApplied,
  type StatusJoinBlock,
  type WordStatus,
} from "../src/index.js";

function sentence(
  originalText: string,
  wordStatuses: (WordStatus | null)[],
  ipaSlots: string[] | null = null
) {
  return { kind: "sentence", originalText, ipaSlots, wordStatuses };
}

const applied: StatusApplied = {
  word: "woke",
  lemma: "wake",
  status: "known",
};

describe("applyStatusToBlocks", () => {
  it("updates every exact surface match across sentences and preserves other statuses", () => {
    const blocks = [
      sentence(
        "Mr. Gupta woke early, woke.",
        [null, null, null, "ignored", "learning"],
        ["", "ˈɡʊptə", "ˈwoʊk", "ˈɝːli", "ˈwoʊk"]
      ),
      sentence("They woke.", ["learning", "ignored"]),
    ];

    const result = applyStatusToBlocks(blocks, applied);

    expect(result.map((block) => block.wordStatuses)).toEqual([
      [null, null, "known", "ignored", "known"],
      ["learning", "known"],
    ]);
  });

  it("updates exact lemma matches while leaving other inflections alone", () => {
    const blocks = [sentence("wake waking woke", [null, "learning", null])];

    expect(applyStatusToBlocks(blocks, applied)[0]?.wordStatuses).toEqual([
      "known",
      "learning",
      "known",
    ]);
  });

  it("uses only the surface string when the lemma is null", () => {
    const blocks = [sentence("wake woke null", ["learning", null, "ignored"])];

    expect(
      applyStatusToBlocks(blocks, {
        ...applied,
        lemma: null,
        status: "ignored",
      })[0]?.wordStatuses
    ).toEqual(["learning", "ignored", "ignored"]);
  });

  it("does not fold the case of either the surface word or lemma", () => {
    const blocks = [
      sentence("Woke woke Wake wake", [null, null, "learning", null]),
    ];

    expect(applyStatusToBlocks(blocks, applied)[0]?.wordStatuses).toEqual([
      null,
      "known",
      "learning",
      "known",
    ]);
  });

  it.each(["code", "raw", "image"])(
    "passes %s blocks through by reference",
    (kind) => {
      const block: StatusJoinBlock = {
        kind,
        originalText: "woke wake",
        wordStatuses: ["learning", null],
      };

      expect(applyStatusToBlocks([block], applied)[0]).toBe(block);
      expect(block.wordStatuses).toEqual(["learning", null]);
    }
  );

  it("passes a sentence without wordStatuses through by reference", () => {
    const block = { kind: "sentence", originalText: "woke" };

    expect(applyStatusToBlocks([block], applied)[0]).toBe(block);
  });

  it("keeps the input array, blocks, status arrays, and IPA slots immutable", () => {
    const block = {
      ...sentence("woke", ["learning"], ["ˈwoʊk"]),
      position: 7,
      translationText: "醒来了",
    };
    Object.freeze(block.wordStatuses);
    Object.freeze(block.ipaSlots);
    Object.freeze(block);
    const blocks = Object.freeze([block]);

    const result = applyStatusToBlocks(blocks, applied);

    expectTypeOf(result).toEqualTypeOf<(typeof block)[]>();
    expect(result).not.toBe(blocks);
    expect(result[0]).not.toBe(block);
    expect(result[0]?.wordStatuses).not.toBe(block.wordStatuses);
    expect(result[0]).toEqual({ ...block, wordStatuses: ["known"] });
    expect(result[0]?.ipaSlots).toBe(block.ipaSlots);
    expect(blocks).toEqual([
      {
        kind: "sentence",
        originalText: "woke",
        ipaSlots: ["ˈwoʊk"],
        wordStatuses: ["learning"],
        position: 7,
        translationText: "醒来了",
      },
    ]);
  });

  it("joins by word position with null IPA slots despite punctuation and non-word gaps", () => {
    const blocks = [
      sentence("123 — woke, wake! early.", [null, "learning", "ignored"], null),
    ];

    expect(applyStatusToBlocks(blocks, applied)[0]?.wordStatuses).toEqual([
      "known",
      "known",
      "ignored",
    ]);
  });

  it("also joins when IPA slots are omitted from the minimal block shape", () => {
    const block: StatusJoinBlock = {
      kind: "sentence",
      originalText: "woke early",
      wordStatuses: [null, "ignored"],
    };

    expect(applyStatusToBlocks([block], applied)[0]?.wordStatuses).toEqual([
      "known",
      "ignored",
    ]);
  });

  // Pin the existing mismatch behavior, not a validation policy. Change
  // these cases if the positional contract deliberately gains validation.
  it("preserves statuses beyond the word count", () => {
    const blocks = [sentence("woke", [null, "ignored", "learning"])];

    expect(applyStatusToBlocks(blocks, applied)[0]?.wordStatuses).toEqual([
      "known",
      "ignored",
      "learning",
    ]);
  });

  it("does not add statuses for words beyond the status count", () => {
    const blocks = [sentence("early woke wake", ["ignored"])];

    expect(applyStatusToBlocks(blocks, applied)[0]?.wordStatuses).toEqual([
      "ignored",
    ]);
  });
});
