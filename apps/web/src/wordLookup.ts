import { ApiError, fetchJson } from "./api";

// What GET /api/lookup/:word returns for a known word. `lemma` is non-null
// for inflected forms; `ipa`, `pos`, and `translation` are nullable because
// thin dictionary entries really are thin. The IPA is the surface form's own
// (how THIS spelling is read); the senses belong to the lemma.
export type WordLookup = {
  word: string;
  lemma: string | null;
  ipa: string | null;
  pos: string | null;
  translation: string | null;
};

// A 404 reads as null — the word is simply not in the dictionary, which the
// popup reports as 未收录. Any other failure throws: a server hiccup must
// not masquerade as a missing word.
export async function fetchWordLookup(
  word: string
): Promise<WordLookup | null> {
  try {
    return await fetchJson<WordLookup>(
      `/api/lookup/${encodeURIComponent(word)}`
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

// Browser speech synthesis (ticket 06: 发音按钮用浏览器语音合成朗读该词).
// Silent no-op where the API is missing or partial — an unsupported
// environment must never turn a click into an error. Repeated clicks restart
// from silence: the previous utterance is cancelled first.
export function speakWord(word: string): void {
  const synthesis = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return;
  synthesis.cancel();
  const utterance = new Utterance(word);
  utterance.lang = "en-US";
  synthesis.speak(utterance);
}
