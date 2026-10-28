import reactHooks from "eslint-plugin-react-hooks";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Browser source must not touch Node-only names: tsc compiles with no-undef
// off, so they pass both lint and typecheck and fail only at runtime
// (audit 2026-10-23). Shared by the two browser blocks below.
const noNodeGlobalsInBrowser = {
  "no-restricted-globals": [
    "error",
    { name: "process", message: "browser code must not use Node APIs" },
    { name: "Buffer", message: "browser code must not use Node APIs" },
    { name: "require", message: "browser code must not use Node APIs" },
    { name: "module", message: "browser code must not use Node APIs" },
    { name: "global", message: "use globalThis instead" },
  ],
};

export default tseslint.config(
  {
    ignores: [
      ".output/**",
      "**/dist/**",
      "**/dist-spike/**",
      "apps/server/src/export/file-script.generated.ts",
      "apps/server/src/export/style.generated.ts",
      ".data/**",
      "**/node_modules/**",
      ".claude/**",
      ".agents/**",
      ".codex/**",
      ".cc-suite/**",
      ".scratch/**",
      "research/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node globals belong to server code and the config files that run in
    // Node. Flat config merges blocks, so scoping this block is what keeps
    // process/Buffer invalid inside web app source.
    files: [
      "apps/server/**/*.{js,mjs,ts,tsx}",
      "apps/web/scripts/**/*.{js,mjs}",
      "scripts/**/*.{js,mjs}",
      "**/vite.config.ts",
      "**/vitest.config.ts",
      "*.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "apps/web/test/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    rules: noNodeGlobalsInBrowser,
  },
  {
    // The reading-model and import-core packages are browser-oriented
    // shared code (their own vitest configs run under the node block
    // above).
    files: [
      "packages/reading-model/src/**/*.ts",
      "packages/reading-model/test/**/*.ts",
      "packages/import-core/src/**/*.ts",
      "packages/import-core/test/**/*.ts",
      "apps/extension/src/**/*.{ts,tsx}",
      "apps/extension/test/**/*.{ts,tsx}",
    ],
    languageOptions: { globals: globals.browser },
    rules: noNodeGlobalsInBrowser,
  },
  {
    // Hooks discipline is mechanical now that hooks are a core pattern:
    // rules-of-hooks (no conditional hooks) and exhaustive-deps (effect
    // deps complete). Deliberately narrow deps suppress it locally with a
    // justified disable, never by loosening the rule (retro 2026-10-24).
    files: [
      "apps/web/**/*.{ts,tsx}",
      "apps/extension/**/*.{ts,tsx}",
      "packages/reading-model/**/*.{ts,tsx}",
    ],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  }
);
