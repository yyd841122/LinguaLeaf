import { pathToFileURL } from "node:url";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import {
  defaultDictionaryPath,
  isSingleWordForm,
  normalizeToken,
  openDictionary,
} from "./dictionary.js";

// ECDICT's exchange field is "/"-separated key:value pairs. Keys p/d/i/3/r/t/s
// list a base word's inflected forms (past, participle, -ing, third person,
// comparative, superlative, plural); key 0 on an inflected entry names its
// lemma; key 1 holds a transformation type code ("s3", "pd") — not a word.
// Both directions collapse to the same thing for lookup purposes: pairs of
// (form, lemma). Repeated forms within one entry (d and p often agree) are
// deduplicated here; collisions across entries are the importer's business.
const INFLECTION_KEYS = new Set(["p", "d", "i", "3", "r", "t", "s"]);

// The pairs split by authority: `explicit` is the entry's own `0:` lemma
// (the form declares what it derives from), `inferred` is derived from a
// base word's inflection list. The importer inserts explicit first, so an
// entry's own lemma always outranks another entry's derived form whichever
// row iterates first (audit 2026-10-23: first-wins let "has" resolve to
// "ha" via the interjection's third-person form).
export function parseExchangeRanked(
  word: string,
  exchange: string
): {
  explicit: Array<readonly [string, string]>;
  inferred: Array<readonly [string, string]>;
} {
  const explicit: Array<readonly [string, string]> = [];
  const inferred: Array<readonly [string, string]> = [];
  const lemmaCandidate = normalizeToken(word);
  for (const part of exchange.split("/")) {
    const colon = part.indexOf(":");
    if (colon < 1) continue;
    const key = part.slice(0, colon);
    const value = normalizeToken(part.slice(colon + 1));
    if (value === lemmaCandidate || !isSingleWordForm(value)) continue;
    if (key === "0") {
      explicit.push([lemmaCandidate, value]);
    } else if (INFLECTION_KEYS.has(key)) {
      inferred.push([value, lemmaCandidate]);
    }
  }
  // Dedupe by form within each rank, keeping the first pair.
  const dedupe = (
    pairs: Array<readonly [string, string]>
  ): Array<readonly [string, string]> => {
    const seen = new Set<string>();
    return pairs.filter(([form]) => {
      if (seen.has(form)) return false;
      seen.add(form);
      return true;
    });
  };
  return { explicit: dedupe(explicit), inferred: dedupe(inferred) };
}

type EcdictRow = {
  word: string;
  phonetic: string | null;
  translation: string | null;
  exchange: string | null;
};

// One pass over a stardict.db: keep the single-word entries (trimmed to
// phonetic + translation), derive the inflection index from the exchange
// field. INSERT OR IGNORE keeps re-runs and case-collapsed duplicates ("US"
// vs "us") harmless, so the import is repeatable by construction.
export function importEcdictDatabase(
  source: Database.Database,
  dictionary: ReturnType<typeof openDictionary>
): void {
  const insertWord = dictionary.prepare(
    "INSERT OR IGNORE INTO dict_words (word, phonetic, translation) VALUES (?, ?, ?)"
  );
  const insertInflection = dictionary.prepare(
    "INSERT OR IGNORE INTO dict_inflections (form, lemma) VALUES (?, ?)"
  );
  const selectEntries = source.prepare(
    "SELECT word, phonetic, translation, exchange FROM stardict"
  );
  dictionary.transaction(() => {
    // Pass one: words and every entry's own `0:` lemma mapping.
    for (const row of selectEntries.iterate() as IterableIterator<EcdictRow>) {
      const word = normalizeToken(row.word);
      if (!isSingleWordForm(word)) continue;
      insertWord.run(word, row.phonetic ?? "", row.translation ?? "");
      for (const [form, lemma] of parseExchangeRanked(
        row.word,
        row.exchange ?? ""
      ).explicit) {
        insertInflection.run(form, lemma);
      }
    }
    // Pass two: inferred mappings, after every explicit mapping has had its
    // shot at INSERT OR IGNORE (see parseExchangeRanked — audit 2026-10-23).
    for (const row of selectEntries.iterate() as IterableIterator<EcdictRow>) {
      const word = normalizeToken(row.word);
      if (!isSingleWordForm(word)) continue;
      for (const [form, lemma] of parseExchangeRanked(
        row.word,
        row.exchange ?? ""
      ).inferred) {
        insertInflection.run(form, lemma);
      }
    }
  })();
}

export function importEcdictFromPaths(
  sourcePath: string,
  targetPath: string
): void {
  const source = new DatabaseConstructor(sourcePath, { readonly: true });
  const dictionary = openDictionary(targetPath);
  try {
    importEcdictDatabase(source, dictionary);
    const words = (
      dictionary.prepare("SELECT COUNT(*) AS c FROM dict_words").get() as {
        c: number;
      }
    ).c;
    const inflections = (
      dictionary
        .prepare("SELECT COUNT(*) AS c FROM dict_inflections")
        .get() as {
        c: number;
      }
    ).c;
    console.log(
      `ECDICT import complete: dictionary now holds ${words} words, ${inflections} inflections at ${targetPath}`
    );
  } finally {
    source.close();
    dictionary.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error(
      "usage: npm run dict:import-ecdict -- <stardict.db> [target.sqlite]"
    );
    process.exitCode = 1;
  } else {
    importEcdictFromPaths(
      sourcePath,
      process.argv[3] ?? defaultDictionaryPath()
    );
  }
}
