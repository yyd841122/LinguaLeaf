// Reconciles chrome.* API usage in src/ against manifest.json permissions.
// Born from ticket 07's review: storage/tabs were missing from the manifest
// while every automated gate stayed green — the smoke's chrome stub masked
// it, and only real load-unpacked could fail. This check is the mechanical
// gate that catches it at build time.
//
// Rule: every chrome.<namespace> referenced in src must either be in the
// permission-free set below or covered by manifest permissions. Usage is
// read off the TypeScript AST (audit 2026-10-30): comments and strings
// never count, string-literal computed access (chrome["storage"]) and
// window.chrome.<ns> / chrome?.<ns> forms do. Binding chrome (or
// window.chrome) to a variable, or indexing it with a non-literal key, is
// rejected outright — an aliased or dynamic handle evades every static
// rule, so it fails the gate loudly instead of passing silently.
//
// Permissions with no chrome.<namespace> counterpart (host patterns,
// quota flags) are exempt from the unused-permission direction via
// DECLARATION_ONLY_PERMISSIONS / NAMESPACELESS below; namespaces whose
// permission needs diverge from the namespace name get an explicit entry
// in EXTRA_REQUIRED_PERMISSIONS rather than a silent 1:1 assumption.
//
// Requirements are per OPERATION, not per namespace: an operation listed
// in OPERATION_REQUIREMENTS replaces the namespace default entirely, so
// e.g. tabs.sendMessage needs nothing while tabs.query keeps "tabs"
// (its result fields are redacted without that permission and this
// extension reads them).
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// TypeScript resolves from the repo root's hoisted node_modules. Under
// plain node the module URL is file: and the root is three levels up; under
// vitest's jsdom environment import.meta.url is rewritten, so fall back to
// a cwd anchor (module resolution walks up to the same root from there).
const ts = (() => {
  try {
    return createRequire(
      join(fileURLToPath(new URL("../../..", import.meta.url)), "package.json")
    )("typescript");
  } catch {
    return createRequire(join(process.cwd(), "package.json"))("typescript");
  }
})();

// Namespaces the browser grants without a manifest permission.
const PERMISSION_FREE = new Set([
  "action",
  "runtime",
  "windows",
  "events",
  "i18n",
  "test",
]);

// Namespace -> every listed permission must be declared for it. Empty
// today; add entries as the extension grows instead of assuming 1:1.
const EXTRA_REQUIRED_PERMISSIONS = new Map([]);

// Manifest permissions that grant no chrome.<namespace> surface at all.
const DECLARATION_ONLY_PERMISSIONS = new Set(["unlimitedStorage"]);
// Host patterns: origin patterns carry "://" and/or "*", and the match-all
// special "<all_urls>" is angle-wrapped with no star at all.
const NAMESPACELESS = /[:*]|^<.+>$/;

// Operation-level requirement overrides: ns -> { method -> groups }. Each
// method entry is a list of requirement groups; every group lists
// alternative satisfiers (a permission name, or "hostAccess" for any
// host-pattern permission), and ALL groups must be met. A mapped method
// replaces the namespace default entirely; unmapped methods keep it.
// Seed entries (audit 2026-10-30 finding 3):
//  - tabs.sendMessage is callable with no permission at all.
//  - tabs.query CALLS without "tabs" but redacts url/title in the result
//    and this extension reads those fields — keep "tabs" required.
//  - scripting.* needs "scripting" PLUS host access (any host pattern, or
//    activeTab for the engaged tab).
const OPERATION_REQUIREMENTS = {
  tabs: {
    sendMessage: [],
    query: [["tabs"]],
  },
  scripting: {
    executeScript: [["scripting"], ["activeTab", "hostAccess"]],
    insertCSS: [["scripting"], ["activeTab", "hostAccess"]],
  },
};

// Requirement groups for one API operation, or null when the namespace
// default applies.
const requirementMet = (token, declared) =>
  token === "hostAccess"
    ? [...declared].some((permission) => NAMESPACELESS.test(permission))
    : declared.has(token);

const operationRequirements = (ns, method) => {
  const table = OPERATION_REQUIREMENTS[ns];
  // hasOwn, not `in`: a src file writing chrome.tabs.constructor must fall
  // through to the namespace default, never match an inherited key.
  if (!table || !method || !Object.hasOwn(table, method)) return null;
  return table[method];
};

// "ns" for namespace-level references, "ns.op" for operation-level ones.
const usageKey = (ns, method) => (method ? `${ns}.${method}` : ns);

// Reads every chrome-namespace reference off one source file's AST.
// Returns usage records { ns, method, path } in first-use order — method
// is the deepest chain segment (chrome.storage.local.get -> "get") — plus
// problems for usages no static rule can decide (aliased handles,
// non-literal computed access).
function scanSource(path, text) {
  const kind = path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".ts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  const records = [];
  const seen = new Set();
  const problems = [];

  // Flattens a member chain into { root, parts, dynamic }: root is the
  // leading identifier's name (null for non-chains like call results),
  // parts are the property names, dynamic marks a non-literal [] link.
  const chainOf = (expr) => {
    if (ts.isParenthesizedExpression(expr)) return chainOf(expr.expression);
    if (ts.isIdentifier(expr))
      return { root: expr.text, parts: [], dynamic: false };
    if (ts.isPropertyAccessExpression(expr)) {
      const base = chainOf(expr.expression);
      return { ...base, parts: [...base.parts, expr.name.text] };
    }
    if (ts.isElementAccessExpression(expr)) {
      const base = chainOf(expr.expression);
      if (
        expr.argumentExpression &&
        ts.isStringLiteral(expr.argumentExpression)
      ) {
        return {
          ...base,
          parts: [...base.parts, expr.argumentExpression.text],
        };
      }
      return { ...base, dynamic: true };
    }
    return { root: null, parts: [], dynamic: false };
  };

  // Chrome-API anchor slots in a flattened chain: the `chrome` segment must
  // BE the root or hang directly off the global object (window/globalThis/
  // self). other.chrome.x and other.window.chrome.x are unrelated
  // properties, not the extension API.
  // Slot ROOT_SLOT (-1) encodes "chrome is the root segment"; slots >= 0
  // index into parts.
  const ROOT_SLOT = -1;
  const chromeSlots = (chain) => {
    const slots = [];
    if (chain.root === "chrome") slots.push(ROOT_SLOT);
    if (
      (chain.root === "window" ||
        chain.root === "globalThis" ||
        chain.root === "self") &&
      chain.parts[0] === "chrome"
    )
      slots.push(0);
    return slots;
  };

  // Only the outermost link of a chain reports, so each chain counts once.
  const noteChain = (node) => {
    const parent = node.parent;
    if (
      ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)
    )
      return;
    const chain = chainOf(node);
    const slots = chromeSlots(chain);
    if (slots.length === 0) return;
    if (chain.dynamic) {
      problems.push(
        `${path}: non-literal computed access on chrome is not analyzable — use a literal namespace`
      );
      return;
    }
    for (const slot of slots) {
      const ns = chain.parts[slot + 1];
      // `chrome` / `window.chrome` referenced bare claims no namespace.
      if (ns === undefined || ns === "chrome") continue;
      // The operation is the deepest segment (chrome.storage.local.get ->
      // "get"); a chain stopping at the namespace has no method.
      const method =
        chain.parts.length > slot + 2
          ? chain.parts[chain.parts.length - 1]
          : null;
      const key = usageKey(ns, method);
      if (!seen.has(key)) {
        seen.add(key);
        records.push({ ns, method, path });
      }
    }
  };

  // const x = chrome / x = window.chrome / const s = chrome.storage /
  // const { storage } = chrome: any binding holding (part of) the chrome
  // handle lets later code evade the scan, so it is rejected instead of
  // guessed at. Destructuring binds each declared name to the same handle.
  const noteBinding = (name, init) => {
    const chain = chainOf(init);
    if (chromeSlots(chain).length > 0) {
      problems.push(
        `${path}: "${name}" is bound to chrome — aliased chrome usage is not analyzable, reference chrome.<ns> inline`
      );
    }
  };
  const notePattern = (pattern, init) => {
    if (ts.isIdentifier(pattern)) {
      noteBinding(pattern.text, init);
    } else if (
      ts.isObjectBindingPattern(pattern) ||
      ts.isArrayBindingPattern(pattern)
    ) {
      for (const element of pattern.elements) {
        if (!ts.isBindingElement(element)) continue;
        const bound = ts.isIdentifier(element.name)
          ? element.name.text
          : "<nested pattern>";
        noteBinding(bound, init);
      }
    } else if (ts.isObjectLiteralExpression(pattern)) {
      // Destructuring assignment: ({ storage } = chrome). Object literals
      // carry their members on .properties (unlike binding patterns).
      // EVERY member of a chrome-bound literal is a bound alias — named,
      // spread ({...rest}), or computed ({[key]: x)}) — so each one is
      // rejected by label rather than silently skipped.
      for (const element of pattern.properties) {
        let bound = "<unresolved member>";
        if (ts.isPropertyAssignment(element)) {
          bound = ts.isIdentifier(element.name)
            ? element.name.text
            : "<computed key>";
        } else if (ts.isShorthandPropertyAssignment(element)) {
          bound = element.name.text;
        } else if (
          ts.isSpreadElement(element) &&
          ts.isIdentifier(element.expression)
        ) {
          bound = element.expression.text;
        }
        noteBinding(bound, init);
      }
    } else if (ts.isArrayLiteralExpression(pattern)) {
      for (const element of pattern.elements) {
        const bound = ts.isIdentifier(element)
          ? element.text
          : "<unresolved element>";
        noteBinding(bound, init);
      }
    }
  };

  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      noteChain(node);
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      notePattern(node.name, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      notePattern(node.left, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { records, problems };
}

export function reconcilePermissions({ manifest, files }) {
  const declared = new Set(manifest.permissions ?? []);
  const used = new Map(); // namespace -> first file
  const usages = new Map(); // "ns" or "ns.op" -> first usage record
  const problems = [];
  for (const file of files) {
    const { records, problems: fileProblems } = scanSource(
      file.path,
      file.text
    );
    for (const record of records) {
      if (!used.has(record.ns)) used.set(record.ns, file.path);
      const key = usageKey(record.ns, record.method);
      if (!usages.has(key)) usages.set(key, record);
    }
    problems.push(...fileProblems);
  }

  const describeGroup = (group) =>
    group.length === 1 ? group[0] : `[${group.join(" | ")}]`;
  const offenders = [...problems];
  for (const [key, { ns, method, path }] of usages) {
    const groups = operationRequirements(ns, method);
    if (groups) {
      // A mapped operation replaces the namespace default entirely.
      const unmet = groups.filter(
        (group) => !group.some((token) => requirementMet(token, declared))
      );
      if (unmet.length > 0) {
        offenders.push(
          `chrome.${key} used in ${path} but its requirements ${unmet
            .map(describeGroup)
            .join(" + ")} are not met by manifest permissions`
        );
      }
      continue;
    }
    if (PERMISSION_FREE.has(ns)) continue;
    if (declared.has(ns)) continue;
    const extra = EXTRA_REQUIRED_PERMISSIONS.get(ns);
    if (extra && extra.every((permission) => declared.has(permission)))
      continue;
    offenders.push(
      extra
        ? `chrome.${ns} used in ${path} but its permissions [${extra.join(", ")}] are not fully in manifest permissions`
        : `chrome.${ns} used in ${path} but "${ns}" is not in manifest permissions`
    );
  }
  // Permissions consumed by used operations' requirement groups (e.g.
  // activeTab for scripting.executeScript) count as used for the
  // declared-permission direction below.
  const usedRequirementTokens = new Set(
    [...usages.values()].flatMap(({ ns, method }) => {
      const groups = operationRequirements(ns, method);
      return groups ? groups.flat() : [];
    })
  );
  const extraValues = new Set([...EXTRA_REQUIRED_PERMISSIONS.values()].flat());
  for (const permission of declared) {
    if (used.has(permission)) continue;
    if (usedRequirementTokens.has(permission)) continue;
    if (PERMISSION_FREE.has(permission)) continue;
    if (extraValues.has(permission)) continue;
    if (DECLARATION_ONLY_PERMISSIONS.has(permission)) continue;
    if (NAMESPACELESS.test(permission)) continue;
    offenders.push(
      `manifest declares "${permission}" but no src file uses chrome.${permission}`
    );
  }
  return { offenders, used: [...used.keys()] };
}

// ---- CLI: same contract as before — exit 1 with offender lines, or the ----
// ---- OK summary on stdout. Import-safe: nothing below runs on import. ----
function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(
    readFileSync(join(root, "public/manifest.json"), "utf8")
  );
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name)) sources.push(path);
    }
  };
  walk(join(root, "src"));

  const { offenders, used } = reconcilePermissions({
    manifest,
    files: sources.map((path) => ({ path, text: readFileSync(path, "utf8") })),
  });

  if (offenders.length > 0) {
    console.error("manifest permission reconciliation failed:");
    for (const line of offenders) console.error("  - " + line);
    process.exit(1);
  }
  console.log(
    `manifest permissions OK: used [${used.join(", ")}], ` +
      `declared [${(manifest.permissions ?? []).join(", ")}]`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
