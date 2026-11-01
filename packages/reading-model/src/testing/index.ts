import { describe, expect, it } from "vitest";
import type { WordStatus } from "../word-lookup.js";

type Applied = { word: string; lemma: string | null; status: WordStatus };

type RaceHarness<Gateway> = {
  gateway: Gateway;
  // Finish only the explicit save started from this surface word.
  settle(word: string): Promise<void>;
  dispose(): void;
};

type RaceSuite<Gateway> = {
  createHarness(): RaceHarness<Gateway>;
  renderPopup(
    gateway: Gateway,
    word: string,
    onStatusApplied: (applied: Applied) => void
  ): { open(word: string): Promise<void> };
  button(status: WordStatus): HTMLButtonElement;
  click(button: HTMLButtonElement): void;
  waitFor(assertion: () => void): Promise<unknown>;
};

// Hosts own rendering, jsdom, and transport fakes. This sub-entry imports
// neither React nor Testing Library, and never belongs on the root barrel.
// Each host runs the same three claims against its real gateway adapter.
export function wordLookupRaceSuite<Gateway>(suite: RaceSuite<Gateway>): void {
  describe("shared word lookup races", () => {
    it("retires only the settled key while another save remains in flight", async () => {
      const harness = suite.createHarness();
      const applied: Applied[] = [];
      try {
        const popup = suite.renderPopup(harness.gateway, "woke", (fact) =>
          applied.push(fact)
        );
        await popup.open("woke");
        suite.click(suite.button("known"));
        expect(suite.button("known").disabled).toBe(true);
        expect(suite.button("learning").disabled).toBe(true);
        await popup.open("book");
        expect(suite.button("known").disabled).toBe(false);
        suite.click(suite.button("learning"));
        await harness.settle("woke");
        await suite.waitFor(() =>
          expect(applied).toEqual([
            expect.objectContaining({ word: "woke", status: "known" }),
          ])
        );
        expect(suite.button("learning").disabled).toBe(true);
        expect(suite.button("known").disabled).toBe(true);
        await harness.settle("book");
        await suite.waitFor(() =>
          expect(suite.button("learning").disabled).toBe(false)
        );
        expect(suite.button("learning").getAttribute("aria-pressed")).toBe(
          "true"
        );
      } finally {
        harness.dispose();
      }
    });

    it("keeps A→B→A re-entry disabled until A's pending save lands", async () => {
      const harness = suite.createHarness();
      try {
        const popup = suite.renderPopup(harness.gateway, "woke", () => {});
        await popup.open("woke");
        suite.click(suite.button("known"));
        await popup.open("book");
        expect(suite.button("known").disabled).toBe(false);
        await popup.open("woke");
        expect(suite.button("known").disabled).toBe(true);
        expect(suite.button("learning").disabled).toBe(true);
        await harness.settle("woke");
        await suite.waitFor(() =>
          expect(suite.button("known").disabled).toBe(false)
        );
        // Characterization, not endorsement: useOwner compares the current
        // key, so a save ticket revives on re-entry. Flip this only when
        // deliberately changing that rule; lookup cancellation is separate.
        expect(suite.button("known").getAttribute("aria-pressed")).toBe("true");
      } finally {
        harness.dispose();
      }
    });

    it("shares one in-flight key across forms without patching the other form", async () => {
      const harness = suite.createHarness();
      const applied: Applied[] = [];
      try {
        const popup = suite.renderPopup(harness.gateway, "runs", (fact) =>
          applied.push(fact)
        );
        await popup.open("runs");
        suite.click(suite.button("known"));
        await popup.open("run");
        expect(suite.button("known").disabled).toBe(true);
        expect(suite.button("learning").disabled).toBe(true);
        await harness.settle("runs");
        await suite.waitFor(() =>
          expect(suite.button("known").disabled).toBe(false)
        );
        expect(suite.button("learning").getAttribute("aria-pressed")).toBe(
          "true"
        );
        expect(applied).toEqual([
          { word: "runs", lemma: "run", status: "known" },
        ]);
      } finally {
        harness.dispose();
      }
    });
  });
}
