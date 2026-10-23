import { parseEnv } from "node:util";

// Startup guard for the DeepSeek environment (ticket 04 retro): the two
// misconfiguration classes that cost a whole diagnosis round each — the
// shell overriding .env values, and editor-glued non-ASCII bytes on wire
// values — are mechanically detectable, so the server says so at boot
// instead of failing silently later (translations come back empty either
// way, by the tolerant Translator contract).

// The values that reach the wire. DEEPSEEK_TRANSLATION_PROMPT is exempt
// from the byte check: it is legitimately Chinese.
const WIRE_VARS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
] as const;

const SHADOW_VARS = [...WIRE_VARS, "DEEPSEEK_TRANSLATION_PROMPT"] as const;

export type DeepSeekEnvDrift = {
  // Set in both the shell environment and the .env file with different
  // values: the environment wins and the .env value is inert.
  shadowed: string[];
  // Effective values carrying non-ASCII bytes — most plausibly an inline
  // comment glued onto the value by an editor.
  dirty: string[];
};

// Node's own .env parser: --env-file and util.parseEnv share one format —
// inline comments, `export NAME=...`, and quoted values parse exactly as
// the runtime saw them (the hand-rolled splitter kept inline comments in
// values and missed export prefixes — audit 2026-10-23).
function parseEnvFile(content: string): Record<string, string | undefined> {
  return { ...parseEnv(content) };
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const printableAscii = /^[\x20-\x7E]*$/;

export function findDeepSeekEnvDrift(
  env: Record<string, string | undefined>,
  envFileContent: string | null
): DeepSeekEnvDrift {
  const fileValues: Record<string, string | undefined> =
    envFileContent === null ? {} : parseEnvFile(envFileContent);
  const shadowed: string[] = [];
  for (const name of SHADOW_VARS) {
    // Presence, not truthiness: an existing empty shell value also wins
    // over the file (--env-file never overrides existing variables), so it
    // shadows too (audit 2026-10-23).
    const fromShell = env[name]?.trim();
    const fromFile = fileValues[name]?.trim();
    if (
      fromShell !== undefined &&
      fromFile !== undefined &&
      fromShell !== fromFile
    ) {
      shadowed.push(name);
    }
  }
  const dirty: string[] = [];
  for (const name of WIRE_VARS) {
    const effective = clean(env[name]);
    if (effective && !printableAscii.test(effective)) {
      dirty.push(name);
    }
  }
  return { shadowed, dirty };
}
