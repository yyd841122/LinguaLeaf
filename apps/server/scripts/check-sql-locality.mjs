// Gate check for CODING_STANDARDS.md, "One table, one column list": every
// SQL statement over the tracked tables lives in its owning store — books,
// chapters, blocks, reading_progress in book-store.ts, word_states in
// vocab-store.ts (vocabulary-states ticket 01) — and each store owns the
// single column list per table. schema.ts is the deliberate DDL/migration
// exception (it runs before the stores' shapes exist); test files may
// build or break what the stores read and are checked by their own
// suites. Any other hit is the drift the standard names — this script
// fails the build on it. Wired into the root `verify` chain and the
// pre-commit hook.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

// One table, one owner: SQL over a table may appear only in its store's
// file (or schema.ts's DDL/migrations, skipped below).
const TABLE_OWNERS = new Map([
  ["books", "book-store.ts"],
  ["chapters", "book-store.ts"],
  ["blocks", "book-store.ts"],
  ["reading_progress", "book-store.ts"],
  ["word_states", "vocab-store.ts"],
]);
const tableSql = (table) =>
  new RegExp(`\\b(?:from|into|update|join)\\s+${table}\\b`, "i");

const offenders = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (entry.name.endsWith(".ts") && entry.name !== "schema.ts") {
      // Whitespace-collapsed whole-file scan: a table name after a newline
      // (FROM\n  books) or inside a JOIN is the same drift as a plain FROM.
      const collapsed = readFileSync(path, "utf8").replace(/\s+/g, " ");
      for (const [table, owner] of TABLE_OWNERS) {
        if (entry.name === owner) continue;
        const hit = collapsed.match(tableSql(table));
        if (hit) {
          offenders.push(`${path}: ${hit[0]} (belongs in ${owner})`);
        }
      }
    }
  }
};
walk(srcDir);

if (offenders.length > 0) {
  console.error(
    [
      "SQL over a tracked table found outside its owning store — see",
      'CODING_STANDARDS.md, "One table, one column list": it belongs in',
      "the table's owner (schema.ts DDL/migrations and test fixtures are",
      "the only exceptions).",
      ...offenders,
    ].join("\n")
  );
  process.exitCode = 1;
}
