import { afterEach, describe, expect, it, vi } from "vitest";
import { speakWord } from "../src/speak.js";

// Minimal stand-in: speakWord only constructs one and sets .lang/.text
// (mirrors apps/web/test/wordLookup.test.tsx).
class FakeUtterance {
  text: string;
  lang = "";
  constructor(text: string) {
    this.text = text;
  }
}

describe("speakWord", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels any current utterance, then speaks the word in en-US", () => {
    const spoken: { text: string; lang: string }[] = [];
    let cancels = 0;
    vi.stubGlobal("speechSynthesis", {
      cancel: () => {
        cancels += 1;
      },
      speak: (utterance: unknown) => {
        const fake = utterance as FakeUtterance;
        spoken.push({ text: fake.text, lang: fake.lang });
      },
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    speakWord("books");
    expect(cancels).toBe(1);
    expect(spoken).toEqual([{ text: "books", lang: "en-US" }]);
  });

  it("stays a silent no-op where the API is missing", () => {
    // jsdom does not implement speech synthesis.
    expect(() => speakWord("books")).not.toThrow();
  });
});
