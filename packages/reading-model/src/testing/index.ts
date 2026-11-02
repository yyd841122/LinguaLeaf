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
  // The channel flag as the station exposes it (failed / saveFailed /
  // startFailed / outage — the station's own name for it).
  failed: () => boolean;
  // What the station has applied through its fresh successes so far (the
  // merged rows, the patched state, the landed ticks). The suite uses it
  // to prove a stale round applied nothing — flag silence alone cannot
  // tell "discarded" from "cleared" (review Q2). A station whose fresh
  // success has no visible application surface (flushSave's write lives
  // server-side) returns whatever constant it likes and declares
  // applies: false — the suite then reads no signal that cannot move.
  applied: () => unknown[];
  // Make every ticket the station has minted so far stale, the station's
  // own way (its real invalidate point — identity-key change, public
  // invalidate, teardown).
  invalidate: () => void | Promise<void>;
  // Stations wiring the onLanded hook additionally report what landed:
  // the facts that reach the host regardless of freshness (the popup's
  // onStatusApplied stream). Required when the suite declares landed.
  landed?: () => unknown[];
};

// Hosts own rendering, jsdom, and transport fakes (same discipline as
// wordLookupRaceSuite above): this factory registers the universal
// adjudication claims against whatever real station mount the host hands
// it. The landed/null-ticket scenarios stay kernel-level
// (apps/web/test/useSettle.test.tsx) except the stale-landing claim a
// landed station mounts below (settle-channel 02's popup). Flag
// expectations are phrased as no-change across a stale landing: a station
// whose invalidate point also clears the flag (an arm-side clear) keeps
// that policy, and the suite must not assume otherwise.
export function settleRaceSuite(suite: {
  createHarness(): SettleHarness | Promise<SettleHarness>;
  // The station's fresh success has no visible application surface — the
  // suite then drops the applied() assertions (a constant array is not
  // evidence) and pins the flag claims alone. flushSave mounts this way.
  applies?: boolean;
  // The station can hold at most one fresh arm at a time (the popup:
  // savingKeys serializes the writes per word, and a word change both
  // clears the flag and stales the previous arm), so the double-arm
  // recovery claim has no mountable precondition there — the attempt's
  // own arm-side clear is that station's recovery by design, and the
  // claim is registered as skipped rather than forced green vacuously.
  serialArms?: boolean;
  // The station wires the onLanded hook (the popup): mount the
  // stale-landing claim, which reads harness.landed().
  landed?: boolean;
}): void {
  describe("shared settle adjudication races", () => {
    it("raises the flag on a fresh failure", async () => {
      const harness = await suite.createHarness();
      const before = harness.failed();
      await (await harness.arm()).reject();
      expect(before).toBe(false);
      expect(harness.failed()).toBe(true);
    });

    (suite.serialArms ? it.skip : it)(
      "clears the flag and applies when a fresh success lands after a failure",
      async () => {
        const harness = await suite.createHarness();
        // Two arms before either settles: the recovery must come from the
        // success's own verdict, not from an arm-side clear that an
        // interleaved start performs anyway (review Q2).
        const loser = await harness.arm();
        const winner = await harness.arm();
        await loser.reject();
        expect(harness.failed()).toBe(true);
        if (suite.applies !== false) expect(harness.applied()).toEqual([]);
        await winner.resolve();
        expect(harness.failed()).toBe(false);
        if (suite.applies !== false)
          expect(harness.applied().length).toBeGreaterThan(0);
      }
    );

    it("leaves flag and application untouched when a stale success lands late", async () => {
      const harness = await suite.createHarness();
      const stale = await harness.arm();
      await harness.invalidate();
      // A fresh failure of the current owner lights the flag first: only
      // then can "a stale success cleared it" be caught red-handed
      // (review Q2 — from a dark flag the mutant stays green).
      await (await harness.arm()).reject();
      expect(harness.failed()).toBe(true);
      const appliedBefore = harness.applied();
      await stale.resolve();
      expect(harness.failed()).toBe(true);
      if (suite.applies !== false)
        expect(harness.applied()).toEqual(appliedBefore);
    });

    it("writes nothing when a stale failure arrives late", async () => {
      const harness = await suite.createHarness();
      const pending = await harness.arm();
      await harness.invalidate();
      const before = harness.failed();
      await pending.reject();
      expect(harness.failed()).toBe(before);
      if (suite.applies !== false) expect(harness.applied()).toEqual([]);
    });

    if (suite.landed) {
      it("reports a stale landing while the lit flag stays lit", async () => {
        const harness = await suite.createHarness();
        if (!harness.landed)
          throw new Error("a landed host must expose landed()");
        const stale = await harness.arm();
        await harness.invalidate();
        // The current arm's fresh failure lights the flag: only a lit
        // flag can catch a landing that clears what it must not.
        await (await harness.arm()).reject();
        expect(harness.failed()).toBe(true);
        const landedBefore = harness.landed().length;
        await stale.resolve();
        // The landed report is unconditional (GLOSSARY 落回裁决's
        // 「先落页、后验陈旧」 variant): the fact reaches the host even
        // though this round lost the verdict…
        expect(harness.landed().length).toBeGreaterThan(landedBefore);
        // …while the stale verdict itself writes nothing: the flag stays
        // lit and no fresh application appears.
        expect(harness.failed()).toBe(true);
        expect(harness.applied()).toEqual([]);
      });
    }
  });
}
