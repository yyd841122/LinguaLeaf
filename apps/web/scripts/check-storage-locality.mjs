// Gate check for the web preference seam (.scratch/per-book-toggles/
// issues/01-per-book-toggles.md): device persistence flows through
// prefs.ts, whose keys are book-scoped (`book:<id>:<pref>`) with the
// global-key era read back once as a migration fallback. A second module
// reaching localStorage directly — the global-key disease ticket 05's
// prefs.ts cured, and per-book keys make worse, since a second key
// regime forks the migration story — fails the build outside prefs.ts.
// A differently spelled accessor slips past this fingerprint; the
// code-review cadence is the net for that. Wired into the root `verify`
// chain and the pre-commit hook.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED = new Set(["prefs.ts"]);
const STORAGE_FINGERPRINT = /\blocalStorage\b/;

const offenders = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !ALLOWED.has(entry.name)) {
      const hit = readFileSync(path, "utf8").match(STORAGE_FINGERPRINT);
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
      "localStorage use outside apps/web/src/prefs.ts — put the",
      "preference on prefs.ts's book-scoped API instead: it owns the",
      "book:<id>:<pref> key layout, the legacy-key fallback, and the",
      "broken-storage guard, and a second accessor splits those again.",
      ...offenders,
    ].join("\n")
  );
  process.exitCode = 1;
}
