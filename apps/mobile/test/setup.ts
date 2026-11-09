import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { webcrypto } from "node:crypto";

// jsdom provides crypto.getRandomValues, but not the browser's SubtleCrypto
// (book fingerprints digest over it — same seam as the extension's setup).
Object.defineProperty(globalThis.crypto, "subtle", {
  value: webcrypto.subtle,
  configurable: true,
});

afterEach(cleanup);
