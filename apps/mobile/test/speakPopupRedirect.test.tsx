import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WordLookupPopup } from "../src/reader/WordLookupPopup";
import type { VocabularyStore } from "../src/store/vocabulary-store";
import { onSpeakOutcome, speakWord } from "../src/speak/router";

// The binding catcher for ticket 09's seam: the kernel popup's speak button
// must land in the MOBILE router (the wrapper's capture-phase handler
// intercepts the click before the kernel's own browser speakWord runs). The
// stub makes the two paths distinguishable — the router catches a synthesis
// throw and raises the failure flag; the kernel's own speakWord would let
// it fly uncaught and no flag would rise. The same catcher pins the
// accessible name the interception matches on: if the kernel re-words its
// speak button, this fails loudly instead of the seam dying silently.
const throwSpeak = vi.fn((utterance: { text: string }) => {
  throw new Error(`synthesis exploded for: ${utterance.text}`);
});

function stubSpeech(): void {
  class FakeUtterance {
    lang = "";
    constructor(public text: string) {}
  }
  Object.defineProperty(window, "speechSynthesis", {
    value: { cancel: vi.fn(), speak: throwSpeak },
    configurable: true,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
  });
}

const store: VocabularyStore = {
  stateKey: (word) => word,
  lookup: async () => null,
  setStatus: async () => undefined,
  statesFor: async () => new Map(),
};

describe("kernel popup speaks through the mobile router", () => {
  it("a synthesis failure inside the kernel popup raises the mobile flag", () => {
    stubSpeech();
    const outcomes: string[] = [];
    const stop = onSpeakOutcome((outcome) => outcomes.push(outcome.kind));
    render(
      <WordLookupPopup
        store={store}
        click={{ word: "runs", point: { x: 10, y: 10 } }}
        onClose={() => undefined}
        onStatusApplied={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "发音" }));
    stop();
    // The click ends at the stub with the word spoken — via the router's
    // kernel fallback the utterance object carries it.
    expect(throwSpeak).toHaveBeenCalledTimes(1);
    expect(throwSpeak.mock.calls[0]?.[0].text).toBe("runs");
    expect(outcomes).toEqual(["synthesis-failed"]);
    // The router's module-level speakWord is the same function the popup
    // ended up holding — one speak story per app, not two.
    expect(speakWord).toBeDefined();
  });
});
