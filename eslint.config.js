import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".output/**",
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
      "**/vite.config.ts",
      "**/vitest.config.ts",
      "*.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "apps/web/test/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  }
);
