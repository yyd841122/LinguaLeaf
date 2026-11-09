import { Capacitor } from "@capacitor/core";
import { speakWord as kernelBrowserSpeak } from "virtual:lingualeaf-kernel-speak";
import { createNativeSpeaker, type NativeSpeaker } from "./native-tts";
import { isSpeakRejection, type SpeakFailure } from "./speak-failure";

// Ticket 09's speak router: the ONE module the kernel popup's speak button
// ends up calling inside the mobile app (the speak-redirect Vite plugin
// rebinds the kernel's speak.js import here — the kernel itself stays
// untouched, mobile-app spec's hard boundary). Dispatch is by host: on the
// Capacitor native platform speech goes through the native TTS plugin
// (WebView's window.speechSynthesis is silent there — ticket 02's real-
// device finding); on a plain browser host the kernel's browser speakWord
// keeps its documented semantics.
//
// The router also owns the failure story: whatever the path, a speak that
// cannot produce sound raises a classified failure to onSpeakFailure
// listeners (the reader-facing flag), instead of failing silently. The
// kernel popup itself stays fire-and-forget — speakWord stays void, so
// the flag rides the event channel rather than a return value.

export type SpeakFailureListener = (failure: SpeakFailure) => void;

export interface SpeakRouter {
  speakWord(word: string): void;
  onSpeakFailure(listener: SpeakFailureListener): () => void;
}

export interface SpeakRouterDeps {
  nativeHost: boolean;
  /** The native plugin speaker; consulted only when nativeHost. */
  native: NativeSpeaker | null;
  /** The kernel's browser speakWord, for plain browser hosts. */
  browser: (word: string) => void;
}

export function createSpeakRouter(deps: SpeakRouterDeps): SpeakRouter {
  const listeners = new Set<SpeakFailureListener>();
  const fail = (failure: SpeakFailure) => {
    for (const listener of [...listeners]) listener(failure);
  };
  const readKind = (cause: unknown): SpeakFailure["kind"] =>
    isSpeakRejection(cause) ? cause.kind : "synthesis-failed";
  return {
    speakWord(word: string): void {
      if (deps.nativeHost && deps.native) {
        void deps.native.speak(word, "en-US").catch((cause: unknown) => {
          fail({ kind: readKind(cause) });
        });
        return;
      }
      try {
        deps.browser(word);
      } catch {
        fail({ kind: "synthesis-failed" });
      }
    },
    onSpeakFailure(listener: SpeakFailureListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The app-wide binding: the redirect points every kernel speak import at
// this module's speakWord. Injected as parameters so tests drive fakes;
// the real wiring probes the platform once — a WebView does not stop being
// native mid-session.
const nativeHost = Capacitor.isNativePlatform();

export const speakRouter: SpeakRouter = createSpeakRouter({
  nativeHost,
  native: nativeHost ? createNativeSpeaker() : null,
  browser: kernelBrowserSpeak,
});

export function speakWord(word: string): void {
  speakRouter.speakWord(word);
}

export function onSpeakFailure(listener: SpeakFailureListener): () => void {
  return speakRouter.onSpeakFailure(listener);
}
