import { describe, expect, it } from "vitest";
import type { ContentItem } from "../src/extract-html.js";
import { tokenizeWords, type IpaLookup } from "../src/ipa-line.js";
import { walkChapterBlocks } from "../src/blocks.js";

// ext-reuse-convergence: the annotation dispatch is one code path for both
// hosts. The pin lives beside the dispatch — sentence items split and pair
// one slot per word (the word-pairing truth source), image/code/raw pass
// through verbatim in reading position. The hosts pin their own output
// mappings on top of this.
const everyToken: IpaLookup = () => "X";

describe("walkChapterBlocks", () => {
  it("pairs each sentence word with a slot and passes plain items through in position", () => {
    const items: ContentItem[] = [
      { kind: "paragraph", text: "Mr. Gupta woke early. The sea was calm." },
      { kind: "image", text: "cover alt" },
      { kind: "code", text: "npm i" },
      { kind: "raw", text: "<br>" },
    ];
    const blocks = walkChapterBlocks(items, everyToken, {
      sentence: (text, ipaSlots) => ({
        kind: "sentence" as const,
        text,
        ipaSlots,
      }),
      plain: (kind, text) => ({ kind, text }),
    });
    expect(blocks).toEqual([
      {
        kind: "sentence",
        text: "Mr. Gupta woke early.",
        ipaSlots: tokenizeWords("Mr. Gupta woke early.").map(() => "X"),
      },
      {
        kind: "sentence",
        text: "The sea was calm.",
        ipaSlots: tokenizeWords("The sea was calm.").map(() => "X"),
      },
      { kind: "image", text: "cover alt" },
      { kind: "code", text: "npm i" },
      { kind: "raw", text: "<br>" },
    ]);
  });

  it("lets the host callbacks own the output shape and forwards only tokens", () => {
    // The dictionary binding stays host-side: the walk forwards tokens to
    // the lookup it was given (null leaves the slot empty) and returns
    // whatever the callbacks produce.
    const nullLookup: IpaLookup = () => null;
    const blocks = walkChapterBlocks(
      [{ kind: "paragraph", text: "One line." }],
      nullLookup,
      {
        sentence: (text, ipaSlots) => `${text}|${ipaSlots.join(",")}`,
        plain: (kind) => `plain:${kind}`,
      }
    );
    // Literal, not tokenizer-derived: a tokenizer shape change must fail
    // this pin, not satisfy it (Standards axis, ext-reuse-convergence).
    expect(blocks).toEqual(["One line.|,"]);
  });
});
