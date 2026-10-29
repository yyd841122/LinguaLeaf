// Reconciles chrome.* API usage in src/ against manifest.json permissions.
// Born from ticket 07's review: storage/tabs were missing from the manifest
// while every automated gate stayed green — the smoke's chrome stub masked
// it, and only real load-unpacked could fail. This check is the mechanical
// gate that catches it at build time.
//
// Rule: every chrome.<namespace> referenced in src must either be in the
// permission-free set below or named in manifest permissions.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(
  readFileSync(join(root, "public/manifest.json"), "utf8")
);

// Namespaces the browser grants without a manifest permission.
const PERMISSION_FREE = new Set([
  "action",
  "runtime",
  "windows",
  "events",
  "i18n",
  "test",
]);

const declared = new Set(manifest.permissions ?? []);
const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) sources.push(path);
  }
};
walk(join(root, "src"));

const used = new Map(); // namespace -> first file
for (const path of sources) {
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) {
    const ns = match[1];
    if (!used.has(ns)) used.set(ns, path);
  }
}

const offenders = [];
for (const [ns, path] of used) {
  if (PERMISSION_FREE.has(ns)) continue;
  if (!declared.has(ns)) {
    offenders.push(
      `chrome.${ns} used in ${path} but "${ns}" is not in manifest permissions`
    );
  }
}
for (const permission of declared) {
  if (!used.has(permission) && !PERMISSION_FREE.has(permission)) {
    offenders.push(
      `manifest declares "${permission}" but no src file uses chrome.${permission}`
    );
  }
}

if (offenders.length > 0) {
  console.error("manifest permission reconciliation failed:");
  for (const line of offenders) console.error("  - " + line);
  process.exit(1);
}
console.log(
  `manifest permissions OK: used [${[...used.keys()].join(", ")}], ` +
    `declared [${[...declared].join(", ")}]`
);
