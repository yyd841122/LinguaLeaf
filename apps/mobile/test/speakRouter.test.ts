import { describe, expect, it, vi } from "vitest";
import { createSpeakRouter } from "../src/speak/router";
import { SpeakRejectionError } from "../src/speak/speak-failure";

// The router's dispatch story (ticket 09): on the native host speech goes
// to the plugin speaker and every classified rejection reaches the failure
// listeners; on a plain browser host the kernel's browser speakWord keeps
// its documented semantics. Fakes stand in for both backends — the real
// wiring lives in the app binding, the real click path is covered by the
// catcher test (speakPopupRedirect.test.tsx).
// Fresh spies per test — a shared backend would leak calls across cases.
const okNative = () => ({ speak: vi.fn(async () => undefined) });

describe("createSpeakRouter", () => {
  it("on the native host the word goes to the plugin speaker", () => {
    const native = okNative();
    const failures: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    const stop = router.onSpeakFailure((f) => failures.push(f.kind));
    router.speakWord("runs");
    stop();
    expect(native.speak).toHaveBeenCalledWith("runs", "en-US");
    expect(failures).toEqual([]);
  });

  it("a missing engine raises an engine-missing failure", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new SpeakRejectionError("engine-missing");
      }),
    };
    const failures: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    router.onSpeakFailure((f) => failures.push(f.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(failures).toEqual(["engine-missing"]));
  });

  it("a failed synthesis on a working engine raises a synthesis failure", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new SpeakRejectionError("synthesis-failed");
      }),
    };
    const failures: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    router.onSpeakFailure((f) => failures.push(f.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(failures).toEqual(["synthesis-failed"]));
  });

  it("an unclassified native rejection still reads as a synthesis failure", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new Error("bridge exploded");
      }),
    };
    const failures: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    router.onSpeakFailure((f) => failures.push(f.kind));
    router.speakWord("runs");
    await vi.waitFor(() => expect(failures).toEqual(["synthesis-failed"]));
  });

  it("on a plain browser host the browser backend speaks and the plugin stays idle", () => {
    const native = okNative();
    const browser = vi.fn();
    const failures: string[] = [];
    const router = createSpeakRouter({ nativeHost: false, native, browser });
    const stop = router.onSpeakFailure((f) => failures.push(f.kind));
    router.speakWord("runs");
    stop();
    expect(browser).toHaveBeenCalledWith("runs");
    expect(native.speak).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  it("a listener that unsubscribed hears no further failures", async () => {
    const native = {
      speak: vi.fn(async () => {
        throw new SpeakRejectionError("engine-missing");
      }),
    };
    const failures: string[] = [];
    const router = createSpeakRouter({
      nativeHost: true,
      native,
      browser: vi.fn(),
    });
    const stop = router.onSpeakFailure((f) => failures.push(f.kind));
    stop();
    router.speakWord("runs");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual([]);
  });
});
