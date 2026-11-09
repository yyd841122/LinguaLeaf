import { describe, expect, it, vi } from "vitest";
import { createSpeakRouter } from "../src/speak/router";
import { SpeakRejectionError } from "../src/speak/speak-failure";

// The router's dispatch story (ticket 09): on the native host speech goes
// to the plugin speaker and every outcome — success or classified failure
// — reaches the listeners; on a plain browser host the kernel's browser
// speakWord keeps its documented semantics. Fakes stand in for both
// backends — the real wiring lives in the app binding, the real click
// path is covered by the catcher test (speakPopupRedirect.test.tsx).
// Fresh spies per test — a shared backend would leak calls across cases.
const okNative = () => ({ speak: vi.fn(async () => undefined) });

describe("createSpeakRouter", () => {
  it("on the native host the word goes to the plugin speaker, and success lands", async () => {
    const native = okNative();
    const outcomes: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    const stop = router.onSpeakOutcome((o) => outcomes.push(o.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(outcomes).toEqual(["success"]));
    stop();
    expect(native.speak).toHaveBeenCalledWith("runs", "en-US");
  });

  it("a missing engine raises an engine-missing failure", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new SpeakRejectionError("engine-missing");
      }),
    };
    const outcomes: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    router.onSpeakOutcome((o) => outcomes.push(o.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(outcomes).toEqual(["engine-missing"]));
  });

  it("a failed synthesis on a working engine raises a synthesis failure", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new SpeakRejectionError("synthesis-failed");
      }),
    };
    const outcomes: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    router.onSpeakOutcome((o) => outcomes.push(o.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(outcomes).toEqual(["synthesis-failed"]));
  });

  it("an unclassified native rejection still reads as a synthesis failure", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new Error("bridge exploded");
      }),
    };
    const outcomes: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    router.onSpeakOutcome((o) => outcomes.push(o.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(outcomes).toEqual(["synthesis-failed"]));
  });

  it("on a plain browser host the browser backend speaks and the plugin stays idle", () => {
    const native = okNative();
    const browser = vi.fn();
    const outcomes: string[] = [];
    const router = createSpeakRouter({ nativeHost: false, native, browser });
    const stop = router.onSpeakOutcome((o) => outcomes.push(o.kind));
    router.speakWord("runs");
    stop();
    expect(browser).toHaveBeenCalledWith("runs");
    expect(native.speak).not.toHaveBeenCalled();
    expect(outcomes).toEqual(["success"]);
  });

  it("a listener that unsubscribed hears no further outcomes", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new SpeakRejectionError("engine-missing");
      }),
    };
    const outcomes: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    const stop = router.onSpeakOutcome((o) => outcomes.push(o.kind));
    stop();
    router.speakWord("runs");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes).toEqual([]);
  });
});
