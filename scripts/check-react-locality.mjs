// Keep the reading-model root usable by the server and annotated book
// file: React dependencies belong only to src/react.ts(x) or src/react/.
// Check every other source file, so an indirect barrel cannot bypass the
// boundary. Wired into root verify and the pre-commit hook.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const srcDir = fileURLToPath(
  new URL("../packages/reading-model/src", import.meta.url)
);
const isReactSource = (path) => /^react(?:\.[cm]?[jt]sx?$|\/)/.test(path);
const offenders = [];

const check = (path) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const checkSpecifier = (node) => {
    if (!node || !ts.isStringLiteralLike(node)) return;
    const specifier = node.text;
    const target = specifier.startsWith(".")
      ? relative(srcDir, resolve(dirname(path), specifier))
      : specifier;
    if (
      /^react(?:\/|$)/.test(specifier) ||
      /^@lingualeaf\/reading-model\/react(?:\/|$)/.test(specifier) ||
      isReactSource(target) ||
      target === "react"
    ) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source)
      );
      offenders.push(`${relative(srcDir, path)}:${line + 1}: ${specifier}`);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkSpecifier(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      checkSpecifier(node.moduleReference.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      checkSpecifier(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      checkSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
};

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (isReactSource(relative(srcDir, path))) continue;
    if (entry.isDirectory()) walk(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) check(path);
  }
};
walk(srcDir);

if (offenders.length > 0) {
  console.error(
    [
      "React dependencies outside reading-model's React entry — keep them in",
      "src/react.ts(x) or src/react/ and do not re-export them from the root:",
      ...offenders,
    ].join("\n")
  );
  process.exitCode = 1;
}
