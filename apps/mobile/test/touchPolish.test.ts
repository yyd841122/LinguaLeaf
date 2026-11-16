import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Ticket 06's static half: touch floor, safe-area insets, dark-follow
// tokens and the keyboard manifest are CSS/XML facts jsdom cannot
// compute — they are reconciled against their declarations (the smoke
// rule's static-check form). Each line has a behavioral partner: the
// dark tokens carry the reader suites' rendering, the hit areas and
// floor carry the interaction suites, the keyboard belt lives in
// noteEditor.test.tsx.

const here = dirname(fileURLToPath(import.meta.url));
const readerCss = readFileSync(
  resolve(here, "../src/reader/reader.css"),
  "utf8"
);
const shellCss = readFileSync(resolve(here, "../src/style.css"), "utf8");
const manifestPath = resolve(
  here,
  "../android/app/src/main/AndroidManifest.xml"
);
const manifest = existsSync(manifestPath)
  ? readFileSync(manifestPath, "utf8")
  : "";

// Comments stripped BEFORE any rule lookup: a bare indexOf can match a
// selector named inside prose (the review's probe flipped the button
// rule to `a` and the pin still passed on the word "buttons" in a
// comment).
const bare = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const ruleBody = (css: string, selector: string): string => {
  const at = bare(css).indexOf(selector);
  expect(at, `${selector} missing`).toBeGreaterThanOrEqual(0);
  const open = bare(css).indexOf("{", at);
  const close = bare(css).indexOf("}", open);
  return bare(css).slice(open + 1, close);
};

describe("stylesheet integrity (ticket 06 review)", () => {
  it("the shared kernel sheet imports FIRST — nothing precedes @import", () => {
    const stripped = bare(readerCss);
    const at = stripped.indexOf("@import");
    expect(at).toBeGreaterThanOrEqual(0);
    // No rule or :root before the import: postcss-import drops the WHOLE
    // import otherwise (the review's P1 — the shared popup/IPA rules
    // vanished from dist).
    expect(stripped.slice(0, at).trim()).toBe("");
  });
});

describe("touch floor (ticket 06, static)", () => {
  it("every control clears a 44px minimum height", () => {
    expect(ruleBody(shellCss, "button")).toContain("min-height: 44px");
    expect(ruleBody(shellCss, "input")).toContain("min-height: 44px");
  });

  it("the in-text pens are exempt from the floor and grow hit areas instead", () => {
    const pens = ruleBody(readerCss, ".block-note-button,\n.pdf-note-button");
    expect(pens).toContain("min-height: 0");
    const hit = ruleBody(
      readerCss,
      ".lookup-word::after,\n.ipa-word::after,\n.block-note-button::after"
    );
    expect(hit).toContain('content: ""');
    expect(hit).toMatch(/inset:\s*-0\.3em -0\.25em/);
    // The hit-area host rule must NOT unseat the canvas pen's absolute
    // positioning (same-specificity later rule wins): the host selector
    // excludes the canvas pen (the review's P1 — pens drifted off their
    // lines).
    expect(readerCss).toMatch(
      /\.block-note-button:not\(\.pdf-note-button\)\s*\{\s*position: relative/
    );
    expect(ruleBody(readerCss, ".pdf-note-button")).toContain(
      "position: absolute"
    );
  });
});

describe("safe areas (ticket 06, static)", () => {
  it("the reading surfaces pad by the insets, floor-guarded", () => {
    expect(ruleBody(readerCss, ".reader")).toContain(
      "max(1.5rem, env(safe-area-inset-top))"
    );
    expect(ruleBody(readerCss, ".reader")).toContain(
      "max(4rem, env(safe-area-inset-bottom))"
    );
    expect(ruleBody(readerCss, ".reader-shell")).toContain(
      "max(0.5rem, env(safe-area-inset-top))"
    );
    expect(ruleBody(readerCss, ".reader-shell")).toContain(
      "max(1rem, env(safe-area-inset-bottom))"
    );
    expect(ruleBody(readerCss, ".overlay-card")).toContain(
      "padding-bottom: max(1.25rem, env(safe-area-inset-bottom))"
    );
  });
});

// The named CSS color keywords worth guarding (the classic set —
// anything a literal color could hide behind). Matched only inside a
// declaration value (after a colon, before the next ;/{/}), so selector
// text like `.pdf-stage canvas` never trips it.
const namedColorInDeclaration =
  /:[^;{}]*\b(red|orange|yellow|green|cyan|blue|purple|magenta|pink|brown|black|white|gray|grey|silver|gold|ivory|beige|teal|navy|maroon|olive|lime|aqua|fuchsia)\b/;

// Strip the three theme blocks from bare css by exact spans — anything
// between them and after the last one must be literal-free. (Removing
// per-declaration instead would bless a token re-declared anywhere.)
const withoutThemeBlocks = (css: string): string => {
  const bareCss = bare(css);
  const selectors = [
    ":root",
    ':root[data-theme="white"]',
    ':root[data-theme="night"]',
  ];
  let cursor = 0;
  let rest = "";
  for (const selector of selectors) {
    const at = bareCss.indexOf(selector, cursor);
    expect(at, `${selector} missing`).toBeGreaterThanOrEqual(0);
    const close = bareCss.indexOf("}", bareCss.indexOf("{", at));
    expect(close, `${selector} close brace`).toBeGreaterThan(at);
    rest += bareCss.slice(cursor, at);
    cursor = close + 1;
  }
  return rest + bareCss.slice(cursor);
};

const sourceFiles = (): string[] =>
  readdirSync(resolve(here, "../src"), { recursive: true })
    .filter((name): name is string => typeof name === "string")
    .filter(
      (name) =>
        (name.endsWith(".ts") || name.endsWith(".tsx")) &&
        !name.endsWith(".d.ts")
    )
    .map((name) => resolve(here, "../src", name));

describe("theme tokens (redesign 01, static)", () => {
  const TOKENS = [
    "accent",
    "accent-fill",
    "card",
    "edge",
    "danger",
    "muted",
    "tint",
    "card-edge",
    "ink",
    "paper",
    "paper-ink",
    "ok-tint",
    "ok-tint-soft",
    "note-pen",
    "ok-strong",
    "ok",
    "ok-2",
    "scrim",
    "shadow-color",
  ];

  it("every theme block re-voices the full palette — paper is the bare default", () => {
    for (const token of TOKENS) {
      expect(ruleBody(readerCss, ":root")).toContain(`--${token}: #`);
      expect(ruleBody(readerCss, ':root[data-theme="white"]')).toContain(
        `--${token}: #`
      );
      expect(ruleBody(readerCss, ':root[data-theme="night"]')).toContain(
        `--${token}: #`
      );
    }
    // The blocks own the scheme hint: light themes read light, night
    // reads dark — UA canvas colors follow the resolved theme.
    expect(ruleBody(readerCss, ":root")).toContain("color-scheme: light");
    expect(ruleBody(readerCss, ':root[data-theme="white"]')).toContain(
      "color-scheme: light"
    );
    expect(ruleBody(readerCss, ':root[data-theme="night"]')).toContain(
      "color-scheme: dark"
    );
    // The shell sheet no longer declares a scheme — reader.css's theme
    // blocks own it (style.css loads after reader.css in the bundle, so
    // a scheme there would smother the manual themes).
    expect(bare(shellCss)).not.toContain("color-scheme");
  });

  it("the accent is brick — the phonetic purple is retired everywhere", () => {
    expect(ruleBody(readerCss, ":root")).toContain("--accent: #c5322a");
    expect(ruleBody(readerCss, ':root[data-theme="white"]')).toContain(
      "--accent: #c5322a"
    );
    // 夜间砖红提亮: night's accent differs from the light brick (a
    // literal #c5322a on the dark ground is unreadable).
    const night = ruleBody(readerCss, ':root[data-theme="night"]');
    expect(night).toContain("--accent:");
    expect(night).not.toContain("--accent: #c5322a");
    // The annotation IPA reads warm gray, not accent (音标紫退役).
    expect(bare(readerCss)).not.toContain("#6a4fa3");
    expect(bare(readerCss)).toMatch(
      /\.ipa-word-ipa,\s*\.ipa-line\s*\{[^}]*color: var\(--muted\)/
    );
  });

  it("the palette is the single color source — no scattered literals of any syntax, in either app stylesheet", () => {
    // Strip EXACTLY the three theme blocks, then nothing color-shaped
    // may remain anywhere. Stripping every `--x: #hex` line instead (the
    // first cut) left two gaps the Codex review's probe walked through:
    // a component-local token re-declaration, and rgb()/named-keyword
    // literals the declaration regex never listed.
    const rest = withoutThemeBlocks(readerCss);
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(
      rest.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) ?? []
    ).toEqual([]);
    // Named keyword colors ride the reskin's retirement too (gray
    // borders/text, the scheme-following canvas ground became tokens).
    // "transparent" stays allowed — absence of color, not a color value.
    expect(rest).not.toMatch(namedColorInDeclaration);
    // The shell sheet carries no color of its own either.
    const shellRest = bare(shellCss);
    expect(shellRest.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(shellRest).not.toMatch(namedColorInDeclaration);
    // And no source file smuggles a literal in through inline styles
    // (6/8-digit hex or functional colors in TS/TSX).
    for (const file of sourceFiles()) {
      const ts = readFileSync(file, "utf8");
      expect(
        ts.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g) ?? [],
        file
      ).toEqual([]);
      expect(ts.match(/\b(?:rgba?|hsla?)\(/g) ?? [], file).toEqual([]);
    }
  });

  it("the page ground rides tokens — body and the masking bands follow the theme", () => {
    const body = ruleBody(readerCss, "body");
    expect(body).toContain("background: var(--paper)");
    expect(body).toContain("color: var(--ink)");
    expect(ruleBody(readerCss, ".reader-head")).toContain(
      "background: var(--paper)"
    );
    expect(ruleBody(readerCss, ".reader-tools-fixed")).toContain(
      "background: var(--paper)"
    );
  });

  it("kernel-shared surfaces are re-voiced app-side for every theme, not behind a media query", () => {
    const css = bare(readerCss);
    // The manual mechanism replaced prefers-color-scheme CSS: the app
    // resolves the theme in JS and stamps data-theme — no media block
    // remains to fight it.
    expect(css).not.toContain("@media (prefers-color-scheme");
    for (const selector of [
      ".lookup-popup",
      ".lookup-word:hover",
      ".lookup-ipa",
      ".lookup-pos",
      ".lookup-head-actions button:hover",
      ".code-block",
      ".raw-block",
      ".image-placeholder",
    ]) {
      const at = css.indexOf(selector);
      expect(at, `${selector} not re-voiced`).toBeGreaterThanOrEqual(0);
      const body = css.slice(at, css.indexOf("}", at));
      expect(body, `${selector} not re-voiced`).toContain("var(--");
    }
  });

  it("the PDF original page is white paper in every theme (纸就是纸)", () => {
    // The whole page-anchored group, defined once on :root — never
    // re-voiced or even mentioned by a theme block, so no theme can
    // bleed onto the canvas page or its overlays. (The first cut pinned
    // only --pdf-page-paper; the Codex review's probe re-declared
    // --pdf-ipa-ink inside night and stayed green.)
    const root = ruleBody(readerCss, ":root");
    const PAGE_ANCHORED = [
      "--pdf-page-paper",
      "--pdf-word-tint",
      "--pdf-ipa-chip",
      "--pdf-ipa-chip-soft",
      "--pdf-ipa-ink",
    ];
    for (const token of PAGE_ANCHORED) {
      expect(root).toContain(`${token}:`);
      for (const block of [
        ':root[data-theme="white"]',
        ':root[data-theme="night"]',
      ]) {
        expect(ruleBody(readerCss, block), token).not.toContain(token);
      }
    }
    expect(root).toContain("--pdf-page-paper: #ffffff");
    expect(ruleBody(readerCss, ".pdf-stage canvas")).toContain(
      "background: var(--pdf-page-paper)"
    );
    // The canvas overlays key to the page, not the theme: the IPA chip
    // reads its own page-anchored ink on its own page-anchored chip.
    expect(ruleBody(readerCss, ".pdf-ipa")).toContain(
      "color: var(--pdf-ipa-ink)"
    );
    expect(ruleBody(readerCss, ".pdf-ipa")).toContain(
      "background: var(--pdf-ipa-chip)"
    );
  });

  it("the scale tokens land for later tickets (4px base)", () => {
    const root = ruleBody(readerCss, ":root");
    for (const token of [
      "--space-1: 0.25rem",
      "--space-2: 0.5rem",
      "--space-3: 0.75rem",
      "--space-4: 1rem",
      "--space-5: 1.5rem",
      "--text-s: 0.85rem",
      "--text-m: 1rem",
      "--radius-s: 0.25rem",
      "--radius-m: 0.5rem",
    ]) {
      expect(root).toContain(token);
    }
  });
});

describe("keyboard (ticket 06, static)", () => {
  it("the Android activity resizes with the IME", () => {
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
  });

  it("the settings card scrolls inside itself", () => {
    const card = ruleBody(readerCss, ".overlay-card");
    expect(card).toMatch(/overflow(-y)?: auto/);
  });
});

describe("EPUB head + 听书 compact row (mobile-ipa-buttons 02, static)", () => {
  it("the EPUB head stacks its rows — the single-line flex squeezed the title and pushed the 听书 group off-screen", () => {
    expect(ruleBody(readerCss, ".reader-head")).toContain(
      "flex-direction: column"
    );
  });

  it("the 听书 buttons sit below the floor visually and grow hit areas (the pens' exemption pattern)", () => {
    const bar = ruleBody(readerCss, ".readaloud-bar button");
    expect(bar).toContain("min-height: 0");
    expect(bar).toContain("font-size: 0.85rem");
    expect(bar).toContain("position: relative");
    const hit = ruleBody(readerCss, ".readaloud-bar button::after");
    expect(hit).toContain('content: ""');
    expect(hit).toMatch(/inset:\s*-0\.35em -0\.35em/);
  });

  it("the popup's 生词本 pills return to their pre-floor size (vertical-only hit bleed)", () => {
    const pill = ruleBody(readerCss, ".lookup-vocab-option");
    expect(pill).toContain("min-height: 0");
    expect(pill).toContain("position: relative");
    const hit = ruleBody(readerCss, ".lookup-vocab-option::after");
    expect(hit).toContain('content: ""');
    // Vertical only: a horizontal bleed would cross the row's 0.25rem
    // gaps and pit neighbouring pills against each other.
    expect(hit).toMatch(/inset:\s*-0\.35em 0/);
  });

  it("the pager's flippers go compact with a both-axis hit area (mobile-ipa-buttons 04)", () => {
    const flipper = ruleBody(readerCss, ".reader-pager button");
    expect(flipper).toContain("min-height: 0");
    expect(flipper).toContain("font-size: 0.85rem");
    expect(flipper).toContain("position: relative");
    const hit = ruleBody(readerCss, ".reader-pager button::after");
    expect(hit).toContain('content: ""');
    expect(hit).toMatch(/inset:\s*-0\.35em -0\.35em/);
  });

  it("the 听书 bar renders directly under the title, before the tools row (书名下方)", () => {
    const epub = readFileSync(
      resolve(here, "../src/reader/EpubReader.tsx"),
      "utf8"
    );
    const header = epub.indexOf('<header className="reader-head">');
    const bar = epub.indexOf('className="readaloud-bar"', header);
    const tools = epub.indexOf(
      '{toolbarPosition === "top" ? toolsRow : null}',
      header
    );
    expect(header).toBeGreaterThanOrEqual(0);
    expect(bar, "听书 bar must live inside the header").toBeGreaterThan(header);
    expect(tools, "tools row must live inside the header").toBeGreaterThan(
      header
    );
    expect(bar).toBeLessThan(tools);
  });
});

describe("built-artifact integrity (mobile-ipa-buttons 01, static)", () => {
  // The transcription glyphs are painted ONLY by the kernel sheet's
  // `.ipa-word-ipa::before { content: attr(data-ipa) }` — the span body
  // is empty. A build that loses the kernel stylesheet (postcss-import
  // drops the whole @import when any rule precedes it) ships a reader
  // whose 音标 toggle silently shows nothing. The android assets once
  // carried exactly that broken CSS while dist was already fixed (cap
  // sync never re-run after the fix), so the marker is demanded of every
  // built stylesheet, in both output locations, wherever they exist.
  const CSS_DIRS = [
    resolve(here, "../dist/assets"),
    resolve(here, "../android/app/src/main/assets/public/assets"),
  ];
  const presentDirs = CSS_DIRS.filter((dir) => existsSync(dir));

  it.skipIf(presentDirs.length === 0)(
    "every built stylesheet carries the kernel IPA marker",
    () => {
      // Per directory: present → it must hold at least one stylesheet
      // (a present-but-css-less directory is a broken build), and every
      // stylesheet must carry the marker (a present css without it is
      // the historical silent drop). Both dirs absent → skipped above:
      // a fresh clone runs the suite before any build — root verify's
      // build step lands after its test phase.
      const files: string[] = [];
      for (const dir of presentDirs) {
        const css = readdirSync(dir).filter((name) => name.endsWith(".css"));
        expect(css, `${dir} exists but holds no stylesheet`).not.toHaveLength(
          0
        );
        files.push(...css.map((name) => join(dir, name)));
      }
      for (const file of files) {
        expect(readFileSync(file, "utf8"), file).toContain(
          "content:attr(data-ipa)"
        );
      }
    }
  );
});
