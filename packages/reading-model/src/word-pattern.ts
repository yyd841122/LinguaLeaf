// A word is a run of letters, possibly joined inside by apostrophes or
// hyphens ("don't", "well-written"). Numbers and standalone punctuation are
// not words. One pattern, three consumers: the server's tokenizer fills IPA
// slots in token order, and both reading frontends walk the same matches to
// pair each word with its slot — slot i belongs to the i-th match of this
// pattern in the sentence.
export const WORD_PATTERN = /\p{L}+(?:['’-]\p{L}+)*/gu;
