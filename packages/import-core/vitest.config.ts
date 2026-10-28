import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "import-core",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
