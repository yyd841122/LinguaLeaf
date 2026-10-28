import { normalizeLookupToken } from "@lingualeaf/reading-model";

// The baked offline asset's shape (scripts/bake-dictionary.ts writes it):
// American IPA per word form, the inflection index (form → lemma), and the
// ECDICT entries baked only for IPA-covered words (phonetic + translation
// feed the popup; ticket 04 consumes `entries`, the slots only need IPA).
export type BakedDictionary = {
  ipa: Record<string, string>;
  inflections: Record<string, string>;
  entries: Record<string, { p: string; t: string }>;
};

// Where a transcription came from: the surface form itself, or its lemma
// (runs reads via run). The popup must disclose lemma answers, never pass
// them off as the form's own reading (spec: 词元回退不冒充词形读音).
export type IpaSource = "form" | "lemma";

export type IpaResolution = { ipa: string; source: IpaSource };

// The offline dictionary (GLOSSARY): IPA lookups resolve locally, never
// through network or service. Resolution order mirrors the server's
// resolveIpa over the baked tables — American IPA for the form, then via
// the inflection index for the lemma, then the baked phonetic (form, then
// lemma). A word no table knows resolves to null: its slot stays empty
// (缺词一律留空).
export class OfflineDictionary {
  constructor(private readonly data: BakedDictionary) {}

  resolveIpa(token: string): IpaResolution | null {
    const word = normalizeLookupToken(token);
    if (!word) return null;
    const direct = this.data.ipa[word];
    if (direct) return { ipa: direct, source: "form" };
    const lemma = this.data.inflections[word];
    if (lemma) {
      const viaLemma = this.data.ipa[lemma];
      if (viaLemma) return { ipa: viaLemma, source: "lemma" };
    }
    const phonetic = this.data.entries[word]?.p;
    if (phonetic) return { ipa: phonetic, source: "form" };
    if (lemma) {
      const lemmaPhonetic = this.data.entries[lemma]?.p;
      if (lemmaPhonetic) return { ipa: lemmaPhonetic, source: "lemma" };
    }
    return null;
  }

  // The slot builder's lookup shape (@lingualeaf/import-core): the raw
  // token in, the transcription (or null) out — provenance is dropped, the
  // slots are the pairing truth source, not the popup.
  ipaLookup(): (token: string) => string | null {
    return (token) => this.resolveIpa(token)?.ipa ?? null;
  }
}

// The reader page loads the baked asset once per mount. A missing or
// broken asset behaves as an empty dictionary — every lookup misses, IPA
// lines stay blank — the server's fresh-empty-file contract, browser-side;
// reading must not die for lack of a dictionary.
export async function loadOfflineDictionary(
  url: string
): Promise<OfflineDictionary> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    return new OfflineDictionary((await response.json()) as BakedDictionary);
  } catch {
    return new OfflineDictionary({ ipa: {}, inflections: {}, entries: {} });
  }
}
