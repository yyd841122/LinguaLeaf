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

describe("dark follow (ticket 06, static)", () => {
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
  ];

  it("the palette is tokenized — no hardcoded light hexes remain", () => {
    const root = ruleBody(readerCss, ":root");
    for (const token of TOKENS) {
      expect(root).toContain(`--${token}: #`);
    }
    // The declarations reference tokens, not literals (the shadow's
    // #0003 alpha is the one deliberate exception).
    const leftovers = readerCss.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    const outsideRootDark = readerCss
      .replace(ruleBody(readerCss, ":root"), "")
      .replace(/--[\w-]+: #[0-9a-fA-F]{3,6};/g, "");
    expect(
      (outsideRootDark.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).filter(
        (hex) => hex !== "#0003"
      )
    ).toEqual([]);
    expect(leftovers.length).toBeGreaterThan(0);
  });

  it("the dark block re-voices every token under the system scheme", () => {
    const mediaAt = readerCss.indexOf("@media (prefers-color-scheme: dark)");
    expect(mediaAt).toBeGreaterThanOrEqual(0);
    const dark = readerCss.slice(mediaAt);
    for (const token of TOKENS) {
      expect(dark).toContain(`--${token}: #`);
    }
  });

  it("the kernel-shared popup surfaces are re-voiced app-side, not in the kernel sheet", () => {
    const mediaAt = readerCss.indexOf("@media (prefers-color-scheme: dark)");
    const dark = readerCss.slice(mediaAt);
    expect(dark).toMatch(/\.lookup-popup\s*\{[^}]*background: var\(--card\)/);
    expect(dark).toMatch(
      /\.lookup-word:hover,\s*\.ipa-word:hover\s*\{[^}]*background: var\(--tint\)/
    );
  });
  it("the kernel sheet's every light surface is re-voiced (review P2)", () => {
    const mediaAt = readerCss.indexOf("@media (prefers-color-scheme: dark)");
    const dark = readerCss.slice(mediaAt);
    // Accent lines, muted texts, hover tint, code/image blocks — one
    // dropped selector leaves a light patch glowing in the dark face.
    for (const selector of [
      ".ipa-line",
      ".lookup-ipa",
      ".lookup-pos",
      ".lookup-head-actions button:hover",
      ".code-block",
      ".raw-block",
      ".image-placeholder",
    ]) {
      const at = dark.indexOf(selector);
      expect(at, `${selector} not re-voiced`).toBeGreaterThanOrEqual(0);
      const open = dark.indexOf("{", at);
      const body = dark.slice(open, dark.indexOf("}", open));
      expect(body, `${selector} not re-voiced`).toContain("var(--");
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
