import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POPUP_WIDTH_PX,
  POPUP_MAX_HEIGHT_PX,
  POPUP_MARGIN_PX,
} from "@lingualeaf/reading-model";
import { describe, expect, it } from "vitest";

function topLevelBlocks(css: string): Map<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map<string, string>();
  // Rules start at column zero; semicolons exclude statements like @import.
  const headers = /^(\S[^{};]*?)\{/gm;
  let match: RegExpExecArray | null;
  while ((match = headers.exec(source))) {
    const bodyStart = headers.lastIndex;
    let end = bodyStart;
    let depth = 1;
    while (end < source.length && depth > 0) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    if (depth !== 0) throw new Error(`Unclosed CSS block: ${match[1]}`);
    const selector = match[1]!.replace(/\s+/g, " ").trim();
    blocks.set(selector, source.slice(bodyStart, end - 1));
    headers.lastIndex = end;
  }
  return blocks;
}

function declarationValue(body: string, property: string): string | undefined {
  return body
    .match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`))?.[1]
    ?.trim();
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appBlocks = topLevelBlocks(
  readFileSync(resolve(testDirectory, "../src/style.css"), "utf8")
);
const sharedBlocks = topLevelBlocks(
  readFileSync(
    resolve(
      testDirectory,
      "../../../packages/reading-model/src/annotated-shared.css"
    ),
    "utf8"
  )
);

describe("annotation style locality", () => {
  it("keeps shared selectors out of the app except the declared exceptions", () => {
    // Membership-level check (selector lists split on commas): re-adding a
    // whole shared group or any single constituent of one both turn this red.
    const declaredExceptions = new Set([
      // __POPUP_*__ tokens need export-side interpolation; the app keeps
      // resolved values per .scratch/annotated-style-source/issues/02-web-shared-import.md.
      ".lookup-popup",
      // The spec keeps this hook app-side on purpose: lifting the var() into
      // the shared .ipa-line, .translation-line group would make .ipa-line
      // follow --translation-size (a rendering change).
      ".translation-line",
    ]);
    const members = (selectors: Iterable<string>) =>
      new Set(
        [...selectors].flatMap((selector) =>
          selector.split(",").map((part) => part.trim())
        )
      );
    const sharedMembers = members(sharedBlocks.keys());
    const overlap = new Set(
      [...members(appBlocks.keys())].filter((member) =>
        sharedMembers.has(member)
      )
    );
    expect(overlap).toEqual(declaredExceptions);
  });

  it("pins the local popup box to the reading model's clamp constants", () => {
    const body = appBlocks.get(".lookup-popup");
    expect(body).toBeDefined();
    expect(declarationValue(body!, "width")).toBe(`${POPUP_WIDTH_PX / 16}rem`);
    expect(declarationValue(body!, "max-height")).toBe(
      `${POPUP_MAX_HEIGHT_PX / 16}rem`
    );
    expect(declarationValue(body!, "max-width")).toBe(
      `calc(100vw - ${(POPUP_MARGIN_PX * 2) / 16}rem)`
    );
    expect(body).toContain("box-sizing: border-box");
  });
});
