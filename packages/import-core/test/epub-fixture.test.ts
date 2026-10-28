import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSampleEpub } from "../src/testing/epub-fixture.js";

// The committed binary exists as a stable sample book; this keeps it from
// drifting away from the builder that documents its structure.
describe("committed sample fixture", () => {
  it("sample-book.epub is byte-identical to the builder output", async () => {
    const committed = readFileSync(
      fileURLToPath(new URL("./fixtures/sample-book.epub", import.meta.url))
    );
    const built = await createSampleEpub();
    const identical =
      committed.byteLength === built.byteLength &&
      committed.every((byte, index) => byte === built[index]);
    expect(identical).toBe(true);
  });
});
