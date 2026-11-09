import { fileURLToPath } from "node:url";

// Shared by vite.config.ts and vitest.config.ts so the kernel dist anchor
// lives in one place (review 2026-11-09: the two configs duplicated it).
// This module runs in Node context only — both configs load there — and
// must never be imported from src, where jsdom rewrites import.meta.url
// away from the file scheme.
export const kernelSpeakPath = fileURLToPath(
  new URL("../../packages/reading-model/dist/speak.js", import.meta.url)
);
