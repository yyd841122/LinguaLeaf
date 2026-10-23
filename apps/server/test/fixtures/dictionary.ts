import { openDictionary } from "../../src/dict/dictionary.js";

// Hand-written rows in the exact shapes the two importers produce from
// ECDICT and ipa-dict. Assertions in the tests repeat these values as
// literals on purpose: the fixture is the state under test's input, the
// literals are the independent source of truth.
export const FIXTURE_WORDS = {
  book: {
    phonetic: "bʊk",
    translation: "n. 书, 簿, 账册\nv. 预订, 登记",
    exchange: "s:books/p:booked/i:booking/3:books",
  },
  // Real ECDICT also carries entries for the inflected forms themselves —
  // thin ones (a sense recap plus a parenthetical pointer), not just bare
  // "X的过去式" pointers. The lookup must still reach the lemma's entry.
  books: {
    phonetic: "",
    translation: "n. 书（book的复数）",
    exchange: "1:s3/0:book",
  },
  write: {
    phonetic: "raɪt",
    translation: "v. 写, 作曲, 写信",
    exchange: "p:wrote/d:written/i:writing/3:writes",
  },
  he: {
    phonetic: "hi:",
    translation: "pron. 他",
    exchange: "",
  },
  zebra: {
    phonetic: "zebrə",
    translation: "n. 斑马",
    exchange: "",
  },
  // ECDICT writes pointer-only entries for inflected forms it has no senses
  // for; the lookup must see through them to the lemma's real entry.
  went: {
    phonetic: "",
    translation: "go的过去式",
    exchange: "",
  },
  go: {
    phonetic: "goʊ",
    translation: "v. 去, 走, 驶\nn. 轮到的机会",
    exchange: "p:went/d:gone/i:going/3:goes",
  },
  // Words ECDICT keeps with an internal apostrophe ("don't") — the lookup
  // fold must reach them from the curly-apostrophe surface form.
  "don't": {
    phonetic: "doʊnt",
    translation: "contr. = do not",
    exchange: "",
  },
} as const;

// Inflection pairs the ECDICT importer derives from the exchanges above
// (literals, not derived through parseExchange, so dictionary tests stay
// independent of the importer).
export const FIXTURE_INFLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["books", "book"],
  ["booked", "book"],
  ["booking", "book"],
  ["wrote", "write"],
  ["written", "write"],
  ["writing", "write"],
  ["writes", "write"],
  ["went", "go"],
];

// American IPA rows in the shape the ipa-dict importer produces (slashes
// stripped, first variant kept). The sample-book words let the API seam
// tests pin exact IPA lines; everything else in the sample stays unknown,
// which exercises the blank-slot contract. Words not listed here (Gupta,
// morning, ...) render as bare `lookup-word` spans — no ipa-word unit —
// in both the reading view and the exported file's HTML; assert against
// that shape, not verbatim sentence text.
export const FIXTURE_IPA_US = {
  book: "bʊk",
  books: "bʊks",
  write: "raɪt",
  wrote: "roʊt",
  went: "wɛnt",
  he: "hi",
  a: "ə",
  failing: "ˈfeɪlɪŋ",
  test: "test",
  first: "fɜːst",
  "don't": "doʊnt",
} as const;

export function createFixtureDictionary(): ReturnType<typeof openDictionary> {
  const dictionary = openDictionary(":memory:");
  const insertWord = dictionary.prepare(
    "INSERT INTO dict_words (word, phonetic, translation) VALUES (?, ?, ?)"
  );
  const insertInflection = dictionary.prepare(
    "INSERT INTO dict_inflections (form, lemma) VALUES (?, ?)"
  );
  const insertIpaUs = dictionary.prepare(
    "INSERT INTO dict_ipa_us (word, ipa) VALUES (?, ?)"
  );
  for (const [word, entry] of Object.entries(FIXTURE_WORDS)) {
    insertWord.run(word, entry.phonetic, entry.translation);
  }
  for (const [form, lemma] of FIXTURE_INFLECTIONS) {
    insertInflection.run(form, lemma);
  }
  for (const [word, ipa] of Object.entries(FIXTURE_IPA_US)) {
    insertIpaUs.run(word, ipa);
  }
  return dictionary;
}
