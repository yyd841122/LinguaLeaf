import { defineConfig } from "vitest/config";

// The harness's pure logic (fixture book, dist-freshness decision) rides
// the repo's normal `npm test`; the browser half stays a manual worked
// example (ticket browser-e2e-harness: build artifacts + chromium are
// deliberately out of the gates).
export default defineConfig({
  test: {
    include: ["**/*.test.mjs"],
  },
});
