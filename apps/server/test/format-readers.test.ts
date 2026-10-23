import { describe, expect, it } from "vitest";
import {
  readUpload,
  UNSUPPORTED_FORMAT,
} from "../src/import/format-readers.js";
import {
  REJECTION_STATUS,
  UploadRejected,
} from "../src/import/upload-rejection.js";

// The registry's two data surfaces, pinned: the reason → status table is
// what a bad upload costs the client, in one place, and readUpload's
// rejections carry wire reasons — never a format's native error classes.
// Per-family bodies and statuses on the real wire are the contract
// suite's territory (contract.test.ts); this file pins the registry
// itself.

describe("REJECTION_STATUS (the one reason → status table)", () => {
  it("pairs every wire reason with the status family the shelf was built on", () => {
    expect(REJECTION_STATUS).toEqual({
      "unsupported-format": 415,
      "invalid-epub": 400,
      "invalid-pdf": 400,
      "encrypted-pdf": 400,
      "scanned-pdf": 422,
      "file-too-large": 413,
    });
  });
});

describe("readUpload (the upload front half's interface)", () => {
  it("rejects an unknown extension as unsupported-format with the registry's prose", async () => {
    await expect(
      readUpload("notes.txt", Buffer.from("just some notes"))
    ).rejects.toMatchObject({
      reason: "unsupported-format",
      message: UNSUPPORTED_FORMAT.error,
    });
  });

  it("rejects a broken EPUB as invalid-epub, never as a native error class", async () => {
    const rejection = readUpload("broken.epub", Buffer.from("not a zip"));
    await expect(rejection).rejects.toBeInstanceOf(UploadRejected);
    await expect(rejection).rejects.toMatchObject({
      reason: "invalid-epub",
      message: "invalid EPUB: not a valid EPUB (ZIP) file",
    });
  });

  it("rejects broken PDF bytes as invalid-pdf", async () => {
    await expect(
      readUpload("broken.pdf", Buffer.from("this is not a pdf"))
    ).rejects.toMatchObject({ reason: "invalid-pdf" });
  });
});
