import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";

// The server-local dictionary: ECDICT rows (trimmed to what lookups need)
// plus the American IPA table from ipa-dict and the inflection index the
// ECDICT importer derives from the exchange field. One SQLite file, filled
// by the two importer scripts; a fresh empty file behaves as "no dictionary"
// (every lookup misses, IPA lines stay blank).
export type Dictionary = Database.Database;

export function openDictionary(filename: string): Dictionary {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const dictionary = new DatabaseConstructor(filename);
  dictionary.pragma("journal_mode = WAL");
  dictionary.exec(`
    CREATE TABLE IF NOT EXISTS dict_words (
      word TEXT PRIMARY KEY,
      phonetic TEXT NOT NULL,
      translation TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dict_inflections (
      form TEXT PRIMARY KEY,
      lemma TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dict_ipa_us (
      word TEXT PRIMARY KEY,
      ipa TEXT NOT NULL
    );
  `);
  return dictionary;
}

export type WordLookup = {
  word: string;
  lemma: string | null;
  ipa: string | null;
  pos: string | null;
  translation: string | null;
};

// Import-time normalization: pure folding only — lower case, curly
// apostrophes, trimmed. No edge stripping: a source entry that only becomes
// a word after stripping ("3D" -> "d") must stay out of the dictionary.
export function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replaceAll("’", "'");
}

// Lookup-time normalization for tokens that arrive as clicked text: the
// import fold, plus the punctuation clinging to the edges ("book,",
// "'book'"). Internal apostrophes and hyphens survive ("don't",
// "well-known").
export function normalizeLookupToken(token: string): string {
  return normalizeToken(token).replace(/^[^a-z']+|[^a-z']+$/g, "");
}

// The word shapes both importers keep: a single lower-case letter run,
// possibly joined inside by apostrophes or hyphens. Phrases ("give up"),
// digit words ("3D"), and lone punctuation stay out of the dictionary.
const WORD_SHAPE = /^[a-z]+(?:['-][a-z]+)*$/;

export function isSingleWordForm(token: string): boolean {
  return WORD_SHAPE.test(token);
}

// Default on-disk location of the server-local dictionary: the .data
// directory next to the book database at the repository root. Overridable
// through ECDICT_PATH, which main.ts honors the same way.
export function defaultDictionaryPath(): string {
  if (process.env.ECDICT_PATH) return process.env.ECDICT_PATH;
  // src/dict -> src -> apps/server -> apps -> repository root
  return resolve(import.meta.dirname, "../../../..", ".data/ecdict.sqlite");
}

// ECDICT's `pos` column holds corpus frequency codes (n:96/v:4) that are not
// fit for display; the translation lines already carry reader-facing markers
// ("n. 书\nv. 预订"), so the part of speech shown to users is the distinct
// set of those markers in order.
export function posFromTranslation(translation: string): string | null {
  const tags: string[] = [];
  for (const line of translation.split("\n")) {
    const match = /^\s*([a-z]+)\s*\./.exec(line);
    if (!match || !match[1]) continue;
    const tag = `${match[1]}.`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.length > 0 ? tags.join(" ") : null;
}

type EntryRow = { phonetic: string; translation: string };

function findEntry(dictionary: Dictionary, word: string): EntryRow | undefined {
  return dictionary
    .prepare("SELECT phonetic, translation FROM dict_words WHERE word = ?")
    .get(word) as EntryRow | undefined;
}

function lemmaOf(dictionary: Dictionary, word: string): string | null {
  const inflection = dictionary
    .prepare("SELECT lemma FROM dict_inflections WHERE form = ?")
    .get(word) as { lemma: string } | undefined;
  return inflection ? inflection.lemma : null;
}

// ECDICT fills entries for inflected forms it has no senses for with a bare
// pointer line ("be的过去式", "pl. man的复数") instead of real senses. Such
// an entry carries nothing a reader needs — no part of speech, no meaning —
// so the lookup sees through it to the lemma's entry. Entries whose
// translation contains any real sense line ("gone": "a. 离去的…\ngo的过去分词")
// are kept as they are.
const POINTER_LINE =
  /^[a-z.]*\s*[\w'-]*的(?:过去式|过去分词|现在分词|复数|第三人称单数|比较级|最高级)$/;

function isInflectionPointer(translation: string): boolean {
  const lines = translation.split("\n").filter((line) => line.trim());
  return (
    lines.length > 0 && lines.every((line) => POINTER_LINE.test(line.trim()))
  );
}

// American IPA first (the IPA line's primary source), ECDICT's phonetic as
// the fallback, resolved through the inflection index when the exact form
// has nothing. Tokens come in raw from text; normalization happens here so
// every caller shares one entry shape. Returns null when no source knows it.
export function resolveIpa(
  dictionary: Dictionary,
  token: string
): string | null {
  const word = normalizeLookupToken(token);
  const fromIpaUs = dictionary
    .prepare("SELECT ipa FROM dict_ipa_us WHERE word = ?")
    .get(word) as { ipa: string } | undefined;
  if (fromIpaUs) return fromIpaUs.ipa;
  const lemma = lemmaOf(dictionary, word);
  if (lemma) {
    const fromLemma = dictionary
      .prepare("SELECT ipa FROM dict_ipa_us WHERE word = ?")
      .get(lemma) as { ipa: string } | undefined;
    if (fromLemma) return fromLemma.ipa;
  }
  const fromEcdict = findEntry(dictionary, word);
  if (fromEcdict?.phonetic) return fromEcdict.phonetic;
  if (lemma) {
    const fromLemmaEntry = findEntry(dictionary, lemma);
    if (fromLemmaEntry?.phonetic) return fromLemmaEntry.phonetic;
  }
  return null;
}

export function lookupWord(
  dictionary: Dictionary,
  token: string
): WordLookup | null {
  const word = normalizeLookupToken(token);
  if (!word) return null;
  let entry = findEntry(dictionary, word);
  let lemma: string | null = null;
  if (entry && isInflectionPointer(entry.translation)) {
    // The exact entry is a bare "X的过去式" style pointer: show the lemma's
    // real entry instead, keeping the pointer entry only as a fallback.
    const resolved = lemmaOf(dictionary, word);
    const lemmaEntry = resolved ? findEntry(dictionary, resolved) : undefined;
    if (resolved && lemmaEntry) {
      entry = lemmaEntry;
      lemma = resolved;
    }
  }
  if (!entry) {
    lemma = lemmaOf(dictionary, word);
    if (lemma) entry = findEntry(dictionary, lemma);
  }
  if (!entry) return null;
  return {
    word,
    lemma: lemma ?? null,
    ipa: resolveIpa(dictionary, word),
    pos: posFromTranslation(entry.translation),
    translation: entry.translation,
  };
}
