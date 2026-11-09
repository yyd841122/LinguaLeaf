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
  speak(options: { text: string; lang: string }): Promise<void>;
}

// What the router (and, later, the read-aloud layer) needs from a native
// speaker. One word or sentence per call, en-US by the caller's choice.
export interface NativeSpeaker {
  speak(text: string, lang: string): Promise<void>;
}

// The reader-facing classification lives here, at the plugin boundary: a
// probe that cannot answer or answers "no" means no usable engine — there
// is nothing to hear and trying would only masquerade as synthesis. A
// rejection after a positive probe is a synthesis failure.
export function createNativeSpeaker(
  plugin: NativeTtsPlugin = TextToSpeech
): NativeSpeaker {
  return {
    async speak(text: string, lang: string): Promise<void> {
      let supported: boolean;
      try {
        supported = (await plugin.isLanguageSupported({ lang })).supported;
      } catch (detail) {
        throw new SpeakRejectionError("engine-missing", detail);
      }
      if (!supported) throw new SpeakRejectionError("engine-missing");
      try {
        await plugin.speak({ text, lang });
      } catch (detail) {
        throw new SpeakRejectionError("synthesis-failed", detail);
      }
    },
  };
}
