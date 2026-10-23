import { describe, expect, it } from "vitest";
import { findDeepSeekEnvDrift } from "../../src/translate/env-guard.js";

describe("findDeepSeekEnvDrift", () => {
  it("flags a variable the shell overrides away from its .env value", () => {
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_API_KEY: "sk-shell" },
      "HOST=0.0.0.0\nDEEPSEEK_API_KEY=sk-file\n"
    );
    expect(drift.shadowed).toEqual(["DEEPSEEK_API_KEY"]);
    expect(drift.dirty).toEqual([]);
  });

  it("stays quiet when shell and .env agree, or the file is absent", () => {
    const agree = findDeepSeekEnvDrift(
      { DEEPSEEK_API_KEY: "sk-test" },
      "DEEPSEEK_API_KEY=sk-test\n"
    );
    expect(agree.shadowed).toEqual([]);
    expect(
      findDeepSeekEnvDrift({ DEEPSEEK_API_KEY: "sk-test" }, null).shadowed
    ).toEqual([]);
  });

  it("flags wire values carrying non-ASCII bytes, glued comments included", () => {
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_BASE_URL: "https://api.deepseek.com可选" },
      null
    );
    expect(drift.dirty).toEqual(["DEEPSEEK_BASE_URL"]);
  });

  it("leaves the Chinese style prompt out of the dirty check", () => {
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_TRANSLATION_PROMPT: "自然意译的简体中文" },
      null
    );
    expect(drift.dirty).toEqual([]);
  });

  it("parses quoted values, comments, and blank lines", () => {
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_API_KEY: "sk-a" },
      '# 译文行配置\n\nDEEPSEEK_API_KEY="sk-b"\n'
    );
    expect(drift.shadowed).toEqual(["DEEPSEEK_API_KEY"]);
  });

  it("strips unquoted inline comments like Node's own parser", () => {
    // The file value parses to "sk-file" — same as the shell value — so
    // nothing is shadowed (audit 2026-10-23: the hand-rolled splitter kept
    // the comment in the value and reported a false shadow).
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_API_KEY: "sk-file" },
      "DEEPSEEK_API_KEY=sk-file # inline comment\n"
    );
    expect(drift.shadowed).toEqual([]);
  });

  it("reads export-prefixed lines like Node's own parser", () => {
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_API_KEY: "sk-shell" },
      "export DEEPSEEK_API_KEY=sk-file\n"
    );
    expect(drift.shadowed).toEqual(["DEEPSEEK_API_KEY"]);
  });

  it("reports an empty shell value as shadowing the file value", () => {
    // Presence, not truthiness: --env-file never overrides an existing
    // variable, so an empty shell value wins and the file key is inert
    // (audit 2026-10-23 — the old expectation endorsed the blind spot).
    const drift = findDeepSeekEnvDrift(
      { DEEPSEEK_API_KEY: "  " },
      "DEEPSEEK_API_KEY=sk-file\n"
    );
    expect(drift.shadowed).toEqual(["DEEPSEEK_API_KEY"]);
  });
});
