import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { kernelSpeakPlugin } from "./src/speak/kernel-speak";
import { kernelSpeakPath } from "./kernel-speak-paths";

// The mobile speak router reuses the kernel's browser speakWord through
// the virtual id (ticket 09); the plugin maps that one specifier to the
// kernel's built module. The kernel popup itself needs no build wiring —
// its speak click is intercepted at the wrapper's capture phase
// (apps/mobile/src/reader/WordLookupPopup.tsx), which is plain runtime.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), kernelSpeakPlugin({ kernelSpeakPath })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
