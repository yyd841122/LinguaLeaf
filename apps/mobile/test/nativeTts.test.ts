import { describe, expect, it, vi } from "vitest";
import {
  createNativeSpeaker,
  type NativeTtsPlugin,
} from "../src/speak/native-tts";
import {
  isSpeakRejection,
  SpeakRejectionError,
} from "../src/speak/speak-failure";

// The adapter owns the plugin conversation (ticket 09): probe the engine
// before speaking, and classify every rejection for the reader — an
// engine that is missing or cannot speak the language is a different
// failure than a synthesis attempt that blew up (CODING_STANDARDS: missing
// and failed read differently). The fake plugin stands in for the
// Capacitor boundary; the real one is injected at the app wiring.
function fakePlugin(overrides: Partial<NativeTtsPlugin> = {}): NativeTtsPlugin {
  return {
    isLanguageSupported: vi.fn(async () => ({ supported: true })),
    speak: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("createNativeSpeaker", () => {
  it("speaks the word through the plugin in the requested language", async () => {
    const plugin = fakePlugin();
    await createNativeSpeaker(plugin).speak("runs", "en-US");
    expect(plugin.speak).toHaveBeenCalledWith({ text: "runs", lang: "en-US" });
  });

  it("an engine without the language is a missing engine, not a failed synthesis", async () => {
    const plugin = fakePlugin({
      isLanguageSupported: async () => ({ supported: false }),
    });
    try {
      await createNativeSpeaker(plugin).speak("runs", "en-US");
      expect.unreachable("speak should have rejected");
    } catch (error) {
      expect(isSpeakRejection(error)).toBe(true);
      expect((error as SpeakRejectionError).kind).toBe("engine-missing");
    }
  });

  it("a probe that will not answer means no usable engine", async () => {
    const plugin = fakePlugin({
      isLanguageSupported: async () => {
        throw new Error("bridge dead");
      },
    });
    try {
      await createNativeSpeaker(plugin).speak("runs", "en-US");
      expect.unreachable("speak should have rejected");
    } catch (error) {
      expect(isSpeakRejection(error)).toBe(true);
      expect((error as SpeakRejectionError).kind).toBe("engine-missing");
    }
  });

  it("a speak attempt that fails on a working engine is a synthesis failure", async () => {
    const plugin = fakePlugin({
      speak: async () => {
        throw new Error("engine choked mid-utterance");
      },
    });
    try {
      await createNativeSpeaker(plugin).speak("runs", "en-US");
      expect.unreachable("speak should have rejected");
    } catch (error) {
      expect(isSpeakRejection(error)).toBe(true);
      expect((error as SpeakRejectionError).kind).toBe("synthesis-failed");
    }
  });
});
