import { describe, expect, it } from "vitest";
import type { WordStatus } from "../word-lookup.js";

// Test inputs are independent of the React entry. Hosts own JSX, status
// adapters, and event dispatch; this suite owns the shared DOM contract.
export type AnnotatedBlocksFixture = (
  | {
      kind: "sentence";
      text: string;
      ipaSlots: string[] | null;
      ipaText?: string | null;
      translationText?: string | null;
      statuses: (WordStatus | null)[];
    }
  | { kind: "code" | "raw" | "image"; text: string }
) & { position?: number };

type Click = { word: string; point: { x: number; y: number } };
export type AnnotatedBlocksScenario = {
  blocks: AnnotatedBlocksFixture[];
  showIpa?: boolean;
  showTranslation?: boolean;
  onWordClick?: (click: Click) => void;
  onStatusRead?: (word: string, index: number) => void;
};
type Suite = {
  statusSource: "positional" | "lookup";
  render(scenario: AnnotatedBlocksScenario): {
    container: HTMLElement;
    rerender(scenario: AnnotatedBlocksScenario): void;
  };
  click(target: Element, point: { x: number; y: number }): void;
  keyDown(target: Element, key: string): KeyboardEvent;
};

const sentence = (
  patch: Partial<Extract<AnnotatedBlocksFixture, { kind: "sentence" }>> = {}
): AnnotatedBlocksFixture => ({
  kind: "sentence",
  text: "One, Two!",
  ipaSlots: ["wʌn", ""],
  statuses: ["known", "learning"],
  ...patch,
});
const words = (scope: ParentNode) => [
  ...scope.querySelectorAll<HTMLElement>("[data-word]"),
];

export function annotatedBlocksSuite(suite: Suite): void {
  describe(`shared annotated blocks (${suite.statusSource})`, () => {
    it("preserves interleaved blocks and reads each word once with sentence-local indexes", () => {
      const reads: [string, number][] = [];
      const { container } = suite.render({
        blocks: [
          sentence(),
          { kind: "code", text: "const Three = 3;" },
          { kind: "raw", text: "Raw words" },
          { kind: "image", text: "Caption" },
          sentence({
            text: "Three Four.",
            ipaSlots: null,
            statuses: ["ignored", null],
          }),
        ],
        onStatusRead: (word, index) => reads.push([word, index]),
      });
      const section = container.querySelector("section")!;
      expect([...section.children].map((el) => el.tagName)).toEqual([
        "DIV",
        "PRE",
        "P",
        "FIGURE",
        "DIV",
      ]);
      expect(section.querySelector("code")?.textContent).toBe(
        "const Three = 3;"
      );
      expect(section.querySelector(".raw-block")?.textContent).toBe(
        "Raw words"
      );
      expect(section.querySelector("figcaption")?.textContent).toBe("Caption");
      expect(
        section.querySelector(".image-placeholder")?.getAttribute("aria-hidden")
      ).toBe("true");
      expect(words(section).map((word) => word.className)).toEqual([
        "ipa-word word-settled",
        "lookup-word",
        "lookup-word word-settled",
        "lookup-word",
      ]);
      expect(reads).toEqual([
        ["One", 0],
        ["Two", 1],
        ["Three", 0],
        ["Four", 1],
      ]);
    });

    it("writes position zero on each original root and omits absent positions", () => {
      const blocks: AnnotatedBlocksFixture[] = [
        sentence(),
        { kind: "code", text: "code" },
        { kind: "raw", text: "raw" },
        { kind: "image", text: "" },
      ];
      const { container } = suite.render({
        blocks: blocks.flatMap((block) => [{ ...block, position: 0 }, block]),
      });
      const roots = [...container.querySelector("section")!.children];
      expect(roots.map((el) => el.getAttribute("data-position"))).toEqual([
        "0",
        null,
        "0",
        null,
        "0",
        null,
        "0",
        null,
      ]);
      expect(roots.map((el) => el.tagName)).toEqual([
        "DIV",
        "DIV",
        "PRE",
        "PRE",
        "P",
        "P",
        "FIGURE",
        "FIGURE",
      ]);
      expect(container.querySelectorAll("figcaption")).toHaveLength(0);
    });

    it("distinguishes omitted, empty, and populated annotation rows without inventing extension rows", () => {
      const view = suite.render({
        blocks: [
          sentence({ ipaSlots: null }),
          sentence({ ipaSlots: null, ipaText: null, translationText: null }),
          sentence({
            ipaSlots: ["wrong length"],
            ipaText: "flat IPA",
            translationText: "译文",
          }),
          sentence({
            ipaText: "must not render paired fallback",
            translationText: "paired 译文",
          }),
          sentence({ ipaSlots: null, ipaText: "IPA only" }),
          sentence({ ipaSlots: null, translationText: "译文 only" }),
        ],
      });
      const blocks = view.container.querySelectorAll(".sentence-block");
      const annotations = (index: number) =>
        [
          ...blocks[index]!.querySelectorAll(".ipa-line, .translation-line"),
        ].map((el) => [el.className, el.textContent]);
      expect(annotations(0)).toEqual([]);
      expect(annotations(1)).toEqual([
        ["ipa-line", ""],
        ["translation-line", ""],
      ]);
      expect(annotations(2)).toEqual([
        ["ipa-line", "flat IPA"],
        ["translation-line", "译文"],
      ]);
      expect(annotations(3)).toEqual([["translation-line", "paired 译文"]]);
      expect(annotations(4)).toEqual([["ipa-line", "IPA only"]]);
      expect(annotations(5)).toEqual([["translation-line", "译文 only"]]);
      expect(blocks[0]!.querySelectorAll(".ipa-word")).toHaveLength(0);
      expect(blocks[2]!.querySelectorAll(".ipa-word")).toHaveLength(0);
      expect(blocks[3]!.querySelectorAll(".ipa-word")).toHaveLength(1);
    });

    it("keeps words accessible and original text content free of IPA, including blank slots", () => {
      const { container } = suite.render({
        blocks: [
          sentence({
            text: "  One, Two! <tag>",
            ipaSlots: ["wʌn", "", "tæɡ"],
            statuses: [null, "learning", "ignored"],
          }),
        ],
      });
      expect(container.querySelector(".original-line")?.textContent).toBe(
        "  One, Two! <tag>"
      );
      expect(container.querySelectorAll("tag")).toHaveLength(0);
      const targets = words(container);
      expect(targets.map((el) => el.className)).toEqual([
        "ipa-word",
        "lookup-word",
        "ipa-word word-settled",
      ]);
      for (const target of targets) {
        expect(target.getAttribute("role")).toBe("button");
        expect(target.tabIndex).toBe(0);
      }
      const transcriptions = [...container.querySelectorAll(".ipa-word-ipa")];
      expect(transcriptions.map((el) => el.getAttribute("data-ipa"))).toEqual([
        "wʌn",
        "tæɡ",
      ]);
      expect(transcriptions.map((el) => el.childNodes.length)).toEqual([0, 0]);
    });

    it("honors independent toggles and restores the same words and transcriptions", () => {
      const blocks = [
        sentence({ translationText: "译文" }),
        sentence({
          ipaSlots: null,
          ipaText: "flat IPA",
          translationText: null,
        }),
      ];
      const view = suite.render({ blocks });
      const original = words(view.container).map((el) => el.textContent);
      view.rerender({ blocks, showIpa: false });
      expect(
        view.container.querySelectorAll(".ipa-word-ipa, .ipa-line")
      ).toHaveLength(0);
      expect(view.container.querySelectorAll(".translation-line")).toHaveLength(
        2
      );
      expect(words(view.container).map((el) => el.textContent)).toEqual(
        original
      );
      view.rerender({ blocks, showTranslation: false });
      expect(view.container.querySelectorAll(".translation-line")).toHaveLength(
        0
      );
      expect(view.container.querySelectorAll(".ipa-word-ipa")).toHaveLength(1);
      expect(view.container.querySelector(".ipa-line")?.textContent).toBe(
        "flat IPA"
      );
      view.rerender({ blocks, showIpa: false, showTranslation: false });
      expect(
        view.container.querySelectorAll(
          ".ipa-word-ipa, .ipa-line, .translation-line"
        )
      ).toHaveLength(0);
      expect(words(view.container).map((el) => el.textContent)).toEqual(
        original
      );
    });

    it("keeps the host's positional or lookup semantics for repeated surface forms", () => {
      const { container } = suite.render({
        blocks: [
          sentence({ text: "One, One!", statuses: ["known", "learning"] }),
        ],
      });
      expect(
        words(container).map((el) => el.classList.contains("word-settled"))
      ).toEqual(
        suite.statusSource === "positional" ? [true, false] : [false, false]
      );
    });

    it("reads new status closures on rerender for both IPA and plain words", () => {
      const view = suite.render({ blocks: [sentence()] });
      expect(
        words(view.container).map((el) => el.classList.contains("word-settled"))
      ).toEqual([true, false]);
      view.rerender({ blocks: [sentence({ statuses: [null, "ignored"] })] });
      expect(
        words(view.container).map((el) => el.classList.contains("word-settled"))
      ).toEqual([false, true]);
      view.rerender({ blocks: [sentence({ statuses: ["ignored", "known"] })] });
      expect(
        words(view.container).map((el) => el.classList.contains("word-settled"))
      ).toEqual([true, true]);
      view.rerender({ blocks: [sentence({ statuses: ["learning", null] })] });
      expect(
        words(view.container).map((el) => el.classList.contains("word-settled"))
      ).toEqual([false, false]);
    });

    it("delegates nested clicks with pointer coordinates and leaves non-word targets inert", () => {
      const clicks: Click[] = [];
      const { container } = suite.render({
        blocks: [
          sentence({ translationText: "译文" }),
          { kind: "raw", text: "inert" },
        ],
        onWordClick: (click) => clicks.push(click),
      });
      suite.click(container.querySelector(".ipa-word-text")!, { x: 73, y: 81 });
      expect(clicks).toEqual([{ word: "One", point: { x: 73, y: 81 } }]);
      suite.click(container.querySelector(".translation-line")!, {
        x: 1,
        y: 2,
      });
      suite.click(container.querySelector(".raw-block")!, { x: 3, y: 4 });
      suite.click(container.querySelector(".original-line")!, { x: 5, y: 6 });
      expect(clicks).toHaveLength(1);
      suite.click(words(container)[1]!, { x: 7, y: 8 });
      expect(clicks[1]).toEqual({ word: "Two", point: { x: 7, y: 8 } });
    });

    it("prevents Enter and Space only on words and anchors on the actual nested target", () => {
      const clicks: Click[] = [];
      const { container } = suite.render({
        blocks: [sentence({ translationText: "译文" })],
        onWordClick: (click) => clicks.push(click),
      });
      const target = container.querySelector<HTMLElement>(".ipa-word-text")!;
      target.getBoundingClientRect = () =>
        ({ left: 32, width: 40, bottom: 91 }) as DOMRect;
      target.parentElement!.getBoundingClientRect = () =>
        ({ left: 500, width: 200, bottom: 900 }) as DOMRect;
      for (const key of ["Enter", " "]) {
        expect(suite.keyDown(target, key).defaultPrevented).toBe(true);
      }
      expect(clicks).toEqual([
        { word: "One", point: { x: 52, y: 91 } },
        { word: "One", point: { x: 52, y: 91 } },
      ]);
      expect(suite.keyDown(target, "Escape").defaultPrevented).toBe(false);
      expect(
        suite.keyDown(container.querySelector(".translation-line")!, " ")
          .defaultPrevented
      ).toBe(false);
      expect(
        suite.keyDown(container.querySelector(".original-line")!, "Enter")
          .defaultPrevented
      ).toBe(false);
      expect(clicks).toHaveLength(2);
      const plain = words(container)[1]!;
      plain.getBoundingClientRect = () =>
        ({ left: 4, width: 6, bottom: 13 }) as DOMRect;
      expect(suite.keyDown(plain, "Enter").defaultPrevented).toBe(true);
      expect(clicks[2]).toEqual({ word: "Two", point: { x: 7, y: 13 } });
    });

    it("does not attach handlers without a callback, including after removing a live callback", () => {
      const blocks = [sentence()];
      const view = suite.render({ blocks });
      expect(
        suite.keyDown(words(view.container)[0]!, " ").defaultPrevented
      ).toBe(false);
      const clicks: Click[] = [];
      view.rerender({ blocks, onWordClick: (click) => clicks.push(click) });
      expect(
        suite.keyDown(words(view.container)[0]!, " ").defaultPrevented
      ).toBe(true);
      expect(clicks).toHaveLength(1);
      view.rerender({ blocks });
      for (const key of ["Enter", " "]) {
        expect(
          suite.keyDown(words(view.container)[0]!, key).defaultPrevented
        ).toBe(false);
      }
      suite.click(words(view.container)[0]!, { x: 1, y: 2 });
      expect(clicks).toHaveLength(1);
    });
  });
}
