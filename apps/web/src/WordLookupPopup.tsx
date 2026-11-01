import {
  WordLookupPopup as Popup,
  type WordLookupGateway,
  type WordLookupPopupProps,
} from "@lingualeaf/reading-model/react";
import { fetchWordLookup, putWordStatus } from "./wordLookup";

export const wordLookupGateway: WordLookupGateway = {
  lookup: fetchWordLookup,
  setStatus: putWordStatus,
};

export function WordLookupPopup(props: Omit<WordLookupPopupProps, "gateway">) {
  return <Popup {...props} gateway={wordLookupGateway} />;
}
