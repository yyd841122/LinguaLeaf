import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import {
  normalizeLookupToken,
  type WordLookup,
} from "@lingualeaf/reading-model";

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

// The lookup-key fold and the entry shape live in the reading model
// (packages/reading-model) — the annotated book file's popups fold clicked
// tokens with the same code. Re-exported here so the server's importers and
// tests keep one import site.
export {
  normalizeToken,
  normalizeLookupToken,
  type WordLookup,
} from "@lingualeaf/reading-model";

// The word shapes both importers keep: a single lower-case letter run,
// possibly joined inside by apostrophes or hyphens. Phrases ("give up"),
// digit words ("3D"), and lone punctuation stay out of the dictionary.
const WORD_SHAPE = /^[a-z]+(?:['-][a-z]+)*$/;

export function isSingleWordForm(token: string): boolean {
  return WORD_SHAPE.test(token);
}

// On-disk location of the server-local dictionary, under a runtime root:
// the .data directory next to the book database. DICTIONARY_PATH overrides
// the default (absolute paths pass through resolve untouched), and both the
// server and the importer CLIs resolve through this one function.
export function dictionaryPathUnder(root: string): string {
  return resolve(
    root,
    process.env.DICTIONARY_PATH ?? ".data/dictionary.sqlite"
  );
}

// Importers run from source via tsx, so the repository root is four levels
// up from this file (src/dict -> src -> apps/server -> apps -> root).
export function defaultDictionaryPath(): string {
  return dictionaryPathUnder(resolve(import.meta.dirname, "../../../.."));
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

// One prepared statement per (handle, SQL): resolveIpa otherwise recompiles
// the same queries for every token of every block — 100k lookups spent ~3x
// the CPU re-preparing (audit 2026-10-23).
const preparedStatements = new WeakMap<Dictionary, Map<string, unknown>>();
function cachedGet<T>(
  dictionary: Dictionary,
  sql: string,
  ...params: unknown[]
): T | undefined {
  let bySql = preparedStatements.get(dictionary);
  if (!bySql) {
    bySql = new Map();
    preparedStatements.set(dictionary, bySql);
  }
  if (!bySql.has(sql)) {
    bySql.set(sql, dictionary.prepare(sql));
  }
  return (bySql.get(sql) as { get(...params: unknown[]): unknown }).get(
    ...params
  ) as T | undefined;
}

function findEntry(dictionary: Dictionary, word: string): EntryRow | undefined {
  return cachedGet<EntryRow>(
    dictionary,
    "SELECT phonetic, translation FROM dict_words WHERE word = ?",
    word
  );
}

function lemmaOf(dictionary: Dictionary, word: string): string | null {
  const inflection = cachedGet<{ lemma: string }>(
    dictionary,
    "SELECT lemma FROM dict_inflections WHERE form = ?",
    word
  );
  return inflection ? inflection.lemma : null;
}

// One column list for the ipa_us read, interpolated by both call sites
// (CODING_STANDARDS: one table, one column list).
const IPA_US_BY_WORD_SQL = "SELECT ipa FROM dict_ipa_us WHERE word = ?";

// American IPA first (the IPA line's primary source), ECDICT's phonetic as
// the fallback, resolved through the inflection index when the exact form
// has nothing. Tokens come in raw from text; normalization happens here so
// every caller shares one entry shape. Returns null when no source knows it.
export function resolveIpa(
  dictionary: Dictionary,
  token: string
): string | null {
  const word = normalizeLookupToken(token);
  const fromIpaUs = cachedGet<{ ipa: string }>(
    dictionary,
    IPA_US_BY_WORD_SQL,
    word
  );
  if (fromIpaUs) return fromIpaUs.ipa;
  const lemma = lemmaOf(dictionary, word);
  if (lemma) {
    const fromLemma = cachedGet<{ ipa: string }>(
      dictionary,
      IPA_US_BY_WORD_SQL,
      lemma
    );
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

// The lookup contract is the spec's "词形还原后的…释义": whenever the
// inflection index knows the lemma and the lemma has an entry, the response
// shows the lemma's senses and part of speech — ECDICT's own entries for
// inflected forms are thin (bare "be的过去式" pointers or a sense recap plus
// "（book的复数）"), so they never win over the lemma. The IPA stays the
// surface form's own (how THIS spelling is read, /ˈbʊks/ not /ˈbʊk/).
export function lookupWord(
  dictionary: Dictionary,
  token: string
): WordLookup | null {
  const word = normalizeLookupToken(token);
  if (!word) return null;
  const lemma = lemmaOf(dictionary, word);
  const lemmaEntry = lemma ? findEntry(dictionary, lemma) : undefined;
  const entry = (lemmaEntry ?? findEntry(dictionary, word)) as
    EntryRow | undefined;
  if (!entry) return null;
  return {
    word,
    lemma: lemma ?? null,
    ipa: resolveIpa(dictionary, word),
    pos: posFromTranslation(entry.translation),
    translation: entry.translation,
  };
}
