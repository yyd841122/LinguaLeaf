import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// A CSS or popup-constant edit must reach the committed style embedded in
// every annotated book file. The failure names the regeneration command.
it("style.generated.ts is fresh against its CSS sources and popup constants", () => {
  const script = fileURLToPath(
    new URL("../scripts/build-export-style.mjs", import.meta.url)
  );
  const result = spawnSync(process.execPath, [script, "--check"], {
    encoding: "utf8",
  });
  expect(
    result.status,
    `freshness gate failed:\n${result.stderr}${result.stdout}`
  ).toBe(0);
});
