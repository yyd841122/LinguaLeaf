import {
  WordLookupPopup as Popup,
  type WordLookupPopupProps,
} from "@lingualeaf/reading-model/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { VocabularyStore } from "../store/vocabulary-store";
import { speakWord } from "../speak/router";

type Props = Omit<WordLookupPopupProps, "gateway"> & { store: VocabularyStore };

// Ticket 09's seam: the kernel popup's speak button keeps its browser
// speakWord onClick — the kernel stays untouched (mobile-app spec's hard
// boundary), and on the device that handler is never reached. This
// wrapper's capture-phase handler intercepts the 发音 button first and
// hands the word to the mobile speak router: native TTS through the
// Capacitor plugin on the device (WebView's window.speechSynthesis is
// silent there — ticket 02's real-device finding), the kernel's browser
// speak on a plain browser host. The button is matched by its accessible
// name; speakPopupRedirect.test.tsx pins that name so a kernel markup
// change fails loudly instead of silently reviving the silent synthesis.
export function WordLookupPopup({ store, ...props }: Props) {
  const interceptSpeak = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('button[aria-label="发音"]')) return;
    event.stopPropagation();
    speakWord(props.click.word);
  };
  return (
    <div onClickCapture={interceptSpeak}>
      <Popup {...props} gateway={store} />
    </div>
  );
}
