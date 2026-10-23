import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// The committed generated file must match a fresh compile of the entry:
// an export-front.ts edit without a regenerate would otherwise ship a
// stale script inside every export. Same ergonomics as the sql-locality
// gate — the failure message names the command that fixes it.
it("file-script.generated.ts is fresh against export-front.ts", () => {
  const script = fileURLToPath(
    new URL("../scripts/build-file-script.mjs", import.meta.url)
  );
  const result = spawnSync(process.execPath, [script, "--check"], {
    encoding: "utf8",
  });
  expect(
    result.status,
    `freshness gate failed:\n${result.stderr}${result.stdout}`
  ).toBe(0);
});

it("carries no ES2021-only methods the es2017 target will not polyfill", () => {
  // esbuild lowers syntax, not methods: a replaceAll in shared source would
  // reach old browsers inside the generated script and throw on every word
  // click (audit 2026-10-23). Line comments stripped first — the ban is on
  // call sites, not prose.
  const stripLineComments = (text: string): string =>
    text.replace(/\/\/.*$/gm, "");
  const generated = stripLineComments(
    readFileSync(
      fileURLToPath(
        new URL("../src/export/file-script.generated.ts", import.meta.url)
      ),
      "utf8"
    )
  );
  expect(generated).not.toContain("replaceAll");
  const sharedSource = stripLineComments(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../packages/reading-model/src/lookup-fold.ts",
          import.meta.url
        )
      ),
      "utf8"
    )
  );
  expect(sharedSource).not.toContain("replaceAll");
});
