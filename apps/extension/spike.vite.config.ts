import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The spike's own build: separate outDir so the release dist (manifest +
// reader + service worker) stays clean of the verification page.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: "dist-spike",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        spike: fileURLToPath(new URL("./spike.html", import.meta.url)),
      },
    },
  },
});
