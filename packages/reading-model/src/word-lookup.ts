// What a word lookup returns — the HTTP lookup response's shape and the
// annotated book file's embedded-vocabulary entry shape, declared once so
// both tiers compile against one source. `lemma` is non-null for inflected
// forms; `ipa`, `pos`, and `translation` are nullable because thin
// dictionary entries really are thin. The IPA is the surface form's own
// (how THIS spelling is read); the senses belong to the lemma.
export type WordLookup = {
  word: string;
  lemma: string | null;
  ipa: string | null;
  pos: string | null;
  translation: string | null;
};

// The vocabulary's stored states (ADR-0005, 生词本四态): 'New' is a
// record's absence, never a stored value. The first lookup enrolls the
// lemma as 'learning'; explicit popup operations move it from there.
export type WordStatus = "learning" | "known" | "ignored";

// Where a transcription came from: the surface form itself, or its lemma
// (runs reads via run). The popup must disclose lemma answers, never pass
// them off as the form's own reading (spec: 词元回退不冒充词形读音).
export type IpaSource = "form" | "lemma";

// A found word carries the state settled by its host's lookup adapter.
// IPA provenance is optional because the web response does not supply it.
export type WordLookupResult = WordLookup & { status: WordStatus } & {
  ipaSource?: IpaSource | null;
};
