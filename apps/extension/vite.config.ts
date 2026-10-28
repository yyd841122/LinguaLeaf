import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  // Relative asset URLs: the reader page loads from the chrome-extension
  // origin, and relative paths keep the built page openable from file://
  // too (smoke tests, human previews) without a server.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        reader: fileURLToPath(new URL("./reader.html", import.meta.url)),
        "service-worker": fileURLToPath(
          new URL("./src/service-worker.ts", import.meta.url)
        ),
      },
      output: {
        // The manifest and the service worker's tab-opening reference fixed
        // paths: a hashed service-worker file name would break every build,
        // so the two entries keep stable names (shared chunks stay hashed).
        entryFileNames: (chunk) =>
          chunk.name === "service-worker"
            ? "service-worker.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
