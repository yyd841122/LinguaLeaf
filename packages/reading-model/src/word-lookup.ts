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
