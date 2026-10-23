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
