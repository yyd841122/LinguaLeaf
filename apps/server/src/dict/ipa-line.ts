import type { Dictionary } from "./dictionary.js";
import { resolveIpa } from "./dictionary.js";
import {
  buildIpaSlots as sharedBuildIpaSlots,
  buildIpaLine as sharedBuildIpaLine,
  type IpaLookup,
} from "@lingualeaf/import-core";

// The slot builder itself is the shared import chain's
// (packages/import-core, extension-reader ticket 03); the server keeps this
// adapter so its call sites and tests keep the (dictionary, sentence)
// signature while the algorithm stays one code path for both hosts.
export { tokenizeWords } from "@lingualeaf/import-core";

export const ipaLookupOf = (dictionary: Dictionary): IpaLookup => {
  // One resolveIpa closure per call: re-prepared statements live in the
  // dictionary module's WeakMap cache, so the closure is free past the
  // first token.
  return (token) => resolveIpa(dictionary, token);
};

export function buildIpaSlots(dictionary: Dictionary, sentence: string) {
  return sharedBuildIpaSlots(ipaLookupOf(dictionary), sentence);
}

export function buildIpaLine(dictionary: Dictionary, sentence: string) {
  return sharedBuildIpaLine(ipaLookupOf(dictionary), sentence);
}
