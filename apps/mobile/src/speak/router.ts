import { Capacitor } from "@capacitor/core";
import { speakWord as kernelBrowserSpeak } from "virtual:lingualeaf-kernel-speak";
import { createNativeSpeaker, type NativeSpeaker } from "./native-tts";
import { isSpeakRejection, type SpeakFailure } from "./speak-failure";

// Ticket 09's speak router: the ONE module the kernel popup's speak button
// ends up calling inside the mobile app (the wrapper's capture-phase seam
// hands the click here — the kernel itself stays untouched, mobile-app
// spec's hard boundary). Dispatch is by host: on the Capacitor native
// platform speech goes through the native TTS plugin (WebView's
// window.speechSynthesis is silent there — ticket 02's real-device
// finding); on a plain browser host the kernel's browser speakWord keeps
// its documented semantics.
//
// The router also owns the outcome story: every speak lands as either a
// success or a classified failure on the onSpeakOutcome channel — the
// reader-facing flag renders failures, and a fresh success retires the
// previous failure's flag (the settle-channel rule: the last state must
// not outlive its credibility). Scoped honestly: on the native path both
// failure kinds (engine missing, synthesis failed) are classified by the
// adapter; on the browser path only a synchronous throw surfaces — the
// kernel's own silent no-op where the speech API is missing stays kernel
// semantics, and async utterance errors have no channel there.
// The kernel popup itself stays fire-and-forget — speakWord stays void,
// so the outcome rides the event channel rather than a return value.

export type SpeakOutcome = SpeakFailure | { kind: "success" };

export type SpeakOutcomeListener = (outcome: SpeakOutcome) => void;

export interface SpeakRouter {
  speakWord(word: string): void;
  onSpeakOutcome(listener: SpeakOutcomeListener): () => void;
}

export interface SpeakRouterDeps {
  nativeHost: boolean;
  /** The native plugin speaker; consulted only when nativeHost. */
  native: NativeSpeaker | null;
  /** The kernel's browser speakWord, for plain browser hosts. */
  browser: (word: string) => void;
}

export function createSpeakRouter(deps: SpeakRouterDeps): SpeakRouter {
  const listeners = new Set<SpeakOutcomeListener>();
  const emit = (outcome: SpeakOutcome) => {
    for (const listener of [...listeners]) listener(outcome);
  };
  const readKind = (cause: unknown): SpeakFailure["kind"] =>
    isSpeakRejection(cause) ? cause.kind : "synthesis-failed";
  return {
    speakWord(word: string): void {
      if (deps.nativeHost && deps.native) {
        void deps.native
          .speak(word, "en-US")
          .then(() => emit({ kind: "success" }))
          .catch((cause: unknown) => {
            emit({ kind: readKind(cause) });
          });
        return;
      }
      try {
        deps.browser(word);
        emit({ kind: "success" });
      } catch {
        emit({ kind: "synthesis-failed" });
      }
    },
    onSpeakOutcome(listener: SpeakOutcomeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The app-wide binding: the wrapper's capture seam hands every popup speak
// click to this module's speakWord. Injected as parameters so tests drive
// fakes; the real wiring probes the platform once — a WebView does not
// stop being native mid-session.
const nativeHost = Capacitor.isNativePlatform();

export const speakRouter: SpeakRouter = createSpeakRouter({
  nativeHost,
  native: nativeHost ? createNativeSpeaker() : null,
  browser: kernelBrowserSpeak,
});

export function speakWord(word: string): void {
  speakRouter.speakWord(word);
}

export function onSpeakOutcome(listener: SpeakOutcomeListener): () => void {
  return speakRouter.onSpeakOutcome(listener);
}
