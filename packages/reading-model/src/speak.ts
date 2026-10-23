// Browser speech synthesis for the popup's word (GLOSSARY: 发音). Silent
// no-op where the API is missing or partial — an unsupported environment
// must never turn a click into an error. Repeated clicks restart from
// silence: the previous utterance is cancelled first. Whether any sound
// comes out offline depends on the device's local voices.
export function speakWord(word: string): void {
  const synthesis = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return;
  synthesis.cancel();
  const utterance = new Utterance(word);
  utterance.lang = "en-US";
  synthesis.speak(utterance);
}
