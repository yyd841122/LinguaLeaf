import {
  WordLookupPopup as Popup,
  type WordLookupPopupProps,
} from "@lingualeaf/reading-model/react";
import type { VocabularyStore } from "../store/vocabulary-store";

type Props = Omit<WordLookupPopupProps, "gateway"> & { store: VocabularyStore };

export function WordLookupPopup({ store, ...props }: Props) {
  return <Popup {...props} gateway={store} />;
}
