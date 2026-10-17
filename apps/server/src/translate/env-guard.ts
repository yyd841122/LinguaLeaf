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

// A deliberately loose .env parser that mirrors what Node accepts: blank
// lines and comments skipped, whitespace trimmed, surrounding quotes
// stripped, first `=` splits name and value.
function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
    values[name] = value;
  }
  return values;
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
  const fileValues =
    envFileContent === null ? {} : parseEnvFile(envFileContent);
  const shadowed: string[] = [];
  for (const name of SHADOW_VARS) {
    const fromShell = clean(env[name]);
    const fromFile = clean(fileValues[name]);
    if (fromShell && fromFile && fromShell !== fromFile) {
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
