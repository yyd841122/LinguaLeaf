import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { kernelSpeakPlugin } from "./src/speak/kernel-speak";
import { kernelSpeakPath } from "./kernel-speak-paths";

// The mobile speak router reuses the kernel's browser speakWord through
// the virtual id (ticket 09); the plugin maps that one specifier to the
// kernel's built module. The kernel popup itself needs no build wiring —
// its speak click is intercepted at the wrapper's capture phase
// (apps/mobile/src/reader/WordLookupPopup.tsx), which is plain runtime.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  plugins: [kernelSpeakPlugin({ kernelSpeakPath })],
  test: {
    name: "mobile",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
