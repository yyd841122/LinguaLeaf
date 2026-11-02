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

export type SettleHarness = {
  // Start exactly one adjudicated op through the real station and leave it
  // in flight; the returned handles settle it and await the station's
  // adjudication flush.
  arm(): Promise<{
    resolve: (value?: unknown) => Promise<void>;
    reject: () => Promise<void>;
  }>;
  // The channel flag as the station exposes it (failed / startFailed /
  // outage — the station's own name for it).
  failed: () => boolean;
  // Make every ticket the station has minted so far stale, the station's
  // own way (its real invalidate point — identity-key change, public
  // invalidate, teardown).
  invalidate: () => void | Promise<void>;
};

// Hosts own rendering, jsdom, and transport fakes (same discipline as
// wordLookupRaceSuite above): this factory registers the four universal
// adjudication claims against whatever real station mount the host hands
// it. The landed/null-ticket scenarios stay kernel-level (apps/web/test/
// useSettle.test.tsx) until settle-channel 02's flushSave and popup adopt
// those hooks. Flag expectations are phrased as no-change across a stale
// landing: a station whose invalidate point also clears the flag (an
// arm-side clear) keeps that policy, and the suite must not assume
// otherwise.
export function settleRaceSuite(suite: {
  createHarness(): SettleHarness | Promise<SettleHarness>;
}): void {
  describe("shared settle adjudication races", () => {
    it("raises the flag on a fresh failure", async () => {
      const harness = await suite.createHarness();
      const before = harness.failed();
      await (await harness.arm()).reject();
      expect(before).toBe(false);
      expect(harness.failed()).toBe(true);
    });

    it("clears the flag when a fresh success lands after a failure", async () => {
      const harness = await suite.createHarness();
      await (await harness.arm()).reject();
      expect(harness.failed()).toBe(true);
      await (await harness.arm()).resolve();
      expect(harness.failed()).toBe(false);
    });

    it("leaves the flag untouched when a stale success lands late", async () => {
      const harness = await suite.createHarness();
      const pending = await harness.arm();
      await harness.invalidate();
      const before = harness.failed();
      await pending.resolve();
      expect(harness.failed()).toBe(before);
    });

    it("writes nothing when a stale failure arrives late", async () => {
      const harness = await suite.createHarness();
      const pending = await harness.arm();
      await harness.invalidate();
      const before = harness.failed();
      await pending.reject();
      expect(harness.failed()).toBe(before);
    });
  });
}
