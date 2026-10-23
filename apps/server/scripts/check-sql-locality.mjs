// Gate check for CODING_STANDARDS.md, "One table, one column list": every
// SQL statement over the four book tables lives in book-store.ts, which
// owns the single column list per table. schema.ts is the deliberate
// DDL/migration exception (it runs before the store's shapes exist); test
// files may build or break what the store reads and are checked by their
// own suites. Any other hit is the drift the standard names — this script
// fails the build on it. Wired into the root `verify` chain and the
// pre-commit hook.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED = new Set(["book-store.ts", "schema.ts"]);
const BOOK_TABLE_SQL =
  /\b(?:from|into|update|join)\s+(?:books|chapters|blocks|reading_progress)\b/i;

const offenders = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (entry.name.endsWith(".ts") && !ALLOWED.has(entry.name)) {
      // Whitespace-collapsed whole-file scan: a table name after a newline
      // (FROM\n  books) or inside a JOIN is the same drift as a plain FROM.
      const collapsed = readFileSync(path, "utf8").replace(/\s+/g, " ");
      const hit = collapsed.match(BOOK_TABLE_SQL);
      if (hit) {
        offenders.push(`${path}: ${hit[0]}`);
      }
    }
  }
};
walk(srcDir);

if (offenders.length > 0) {
  console.error(
    [
      "SQL over the book tables found outside book-store.ts — see",
      'CODING_STANDARDS.md, "One table, one column list": it belongs in the',
      "store (schema.ts DDL/migrations and test fixtures are the only",
      "exceptions).",
      ...offenders,
    ].join("\n")
  );
  process.exitCode = 1;
}
