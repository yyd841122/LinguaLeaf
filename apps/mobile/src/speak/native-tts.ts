import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeakRejectionError } from "./speak-failure";

// The Capacitor TTS plugin surface the adapter needs (ticket 09). The
// plugin's speak promise resolves when the utterance finishes and rejects
// on failure; its default queue strategy is Flush, so a new speak stops
// the previous one — the kernel popup's restart-from-silence semantics,
// upheld without an explicit stop round-trip.
export interface NativeTtsPlugin {
  isLanguageSupported(options: {
    lang: string;
  }): Promise<{ supported: boolean }>;
  speak(options: { text: string; lang: string; rate?: number }): Promise<void>;
  stop(): Promise<void>;
}

// What the router (ticket 09) and the read-aloud layer (ticket 07) need
// from a native speaker. One utterance per call, en-US by the caller's
// choice; speak resolves when the utterance FINISHES — the continuation
// primitive continuous reading chains on. stop flushes the in-flight
// utterance (pause/jump must not wait for a long sentence to land).
export interface NativeSpeaker {
  speak(text: string, lang: string, rate?: number): Promise<void>;
  stop(): Promise<void>;
}

// The reader-facing classification lives here, at the plugin boundary: a
// probe that cannot answer or answers "no" means no usable engine — there
// is nothing to hear and trying would only masquerade as synthesis. A
// rejection after a positive probe is a synthesis failure.
export function createNativeSpeaker(
  plugin: NativeTtsPlugin = TextToSpeech
): NativeSpeaker {
  // The cancellation epoch (ticket 07 review): stop() must invalidate a
  // speak that is still WAITING on the engine probe — the native stop
  // only flushes utterances already submitted, so a probe in flight
  // would otherwise land and SPEAK after the pause (the review's probe:
  // pause settles, the old probe returns, audio starts from a paused
  // walk). Each speak captures the epoch at entry; a stale epoch
  // resolves silently and never reaches the plugin.
  let epoch = 0;
  return {
    async speak(text: string, lang: string, rate?: number): Promise<void> {
      const mine = epoch;
      let supported: boolean;
      try {
        supported = (await plugin.isLanguageSupported({ lang })).supported;
      } catch (detail) {
        throw new SpeakRejectionError("engine-missing", detail);
      }
      if (epoch !== mine) return; // cancelled while probing — stay silent
      if (!supported) throw new SpeakRejectionError("engine-missing");
      try {
        await plugin.speak(
          rate === undefined ? { text, lang } : { text, lang, rate }
        );
      } catch (detail) {
        throw new SpeakRejectionError("synthesis-failed", detail);
      }
    },
    stop() {
      epoch += 1;
      return plugin.stop();
    },
  };
}
