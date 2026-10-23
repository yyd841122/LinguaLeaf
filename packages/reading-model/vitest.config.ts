import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "reading-model",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
