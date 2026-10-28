import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/reading-model/vitest.config.ts",
      "packages/import-core/vitest.config.ts",
      "apps/server/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "apps/extension/vitest.config.ts",
    ],
  },
});
