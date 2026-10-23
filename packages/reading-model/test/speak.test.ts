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
    // One ordered event log: cancel must precede speak — speaking before
    // cancelling lets the new pronunciation be cut off (audit 2026-10-23 —
    // call counts alone passed either order).
    const events: string[] = [];
    const spoken: { text: string; lang: string }[] = [];
    vi.stubGlobal("speechSynthesis", {
      cancel: () => {
        events.push("cancel");
      },
      speak: (utterance: unknown) => {
        const fake = utterance as FakeUtterance;
        events.push("speak");
        spoken.push({ text: fake.text, lang: fake.lang });
      },
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    speakWord("books");
    expect(events).toEqual(["cancel", "speak"]);
    expect(spoken).toEqual([{ text: "books", lang: "en-US" }]);
  });

  it("stays a silent no-op where the API is missing", () => {
    // jsdom does not implement speech synthesis.
    expect(() => speakWord("books")).not.toThrow();
  });
});
