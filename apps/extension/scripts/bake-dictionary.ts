// Build-time baking: the server's SQLite dictionary → the extension's
// offline asset. Node-side only (better-sqlite3); the browser gets the JSON
// and never knows SQLite existed (ADR-0006). Coverage decision measured
// 2026-10-28 against the real .data dictionary (1.3M ECDICT words):
//   - dict_ipa_us baked whole (125k forms, 2.6MB) — the American IPA source
//   - dict_inflections baked whole (167k, 3.8MB) — lemma fallback and the
//     popup's lemma display key on it
//   - ECDICT entries baked ONLY for IPA-covered words (101k, 2.1MB —
//     translations are terse, ~21 chars): the popup's 中译/词性 and the
//     last-resort phonetic. The long tail outside ipa-dict coverage stays
//     unbaked — those words' slots stay blank (缺词一律留空), and UK-style
//     phonetics do not sneak into a 美式-locked reader.
// Usage: npm run bake:dictionary -- [--db <sqlite>] [--out <json>]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// apps/extension/scripts → repo root is three levels up.
const repoRoot = resolve(import.meta.dirname, "../../..");
const dbPath = resolve(
  arg("db") ?? resolve(repoRoot, ".data/dictionary.sqlite")
);
const outPath = resolve(
  arg("out") ?? resolve(import.meta.dirname, "../public/dictionary.json")
);

const db = new Database(dbPath, { readonly: true });

const ipa: Record<string, string> = {};
for (const row of db
  .prepare("SELECT word, ipa FROM dict_ipa_us")
  .iterate() as IterableIterator<{ word: string; ipa: string }>) {
  ipa[row.word] = row.ipa;
}

const inflections: Record<string, string> = {};
for (const row of db
  .prepare("SELECT form, lemma FROM dict_inflections")
  .iterate() as IterableIterator<{ form: string; lemma: string }>) {
  inflections[row.form] = row.lemma;
}

// Entries ride the IPA join: a word the IPA tables do not cover has no
// baked entry (see the coverage note above).
const entries: Record<string, { p: string; t: string }> = {};
for (const row of db
  .prepare(
    `SELECT w.word AS word, w.phonetic AS p, w.translation AS t
     FROM dict_words w JOIN dict_ipa_us i ON i.word = w.word`
  )
  .iterate() as IterableIterator<{ word: string; p: string; t: string }>) {
  entries[row.word] = { p: row.p, t: row.t };
}
db.close();

const asset = { ipa, inflections, entries };
const json = JSON.stringify(asset);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, json);
const mb = (bytes: number) => (bytes / 1048576).toFixed(1) + "MB";
console.log(
  `baked ${outPath}: ${mb(Buffer.byteLength(json))} total — ` +
    `ipa ${Object.keys(ipa).length}, ` +
    `inflections ${Object.keys(inflections).length}, ` +
    `entries ${Object.keys(entries).length}`
);
