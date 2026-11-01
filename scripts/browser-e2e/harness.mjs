// The web browser-acceptance skeleton (ticket browser-e2e-harness, from the
// reading-bookmarks /retro 2026-11-01). Why this exists: viewport-sensitive
// acceptance burned one round on ticket 03 and three-plus-one rounds on 04
// — with the discipline written as warning prose in docs/agents/
// browser-e2e.md §3 sitting in context the whole time. Warnings do not
// transfer; code does. This file is the discipline, so the next acceptance
// extends a template instead of re-stepping the pits:
//
//   1. Chromium launch — playwright-core drives the cached browser
//      (executablePath into ~/.cache/ms-playwright, zero download),
//      --no-proxy-server so the WSL system proxy cannot answer for loopback.
//   2. Stimulus-complete clicks — every viewport-sensitive click is DOM
//      level (locator.evaluate(el => el.click()), which runs no
//      actionability checks and cannot scroll) with the invariant built in:
//      scrollY must be unchanged across the click, or the helper throws.
//      locator.click()'s pre-click auto-scroll fires inside its
//      actionability window even when the target is already in view — 04
//      pinned the 打书签 button at y≈1.6 and still watched captures read
//      017/023/24 off a page the driver had scrolled by up to 414px. There
//      is no in-view check that prevents this; only not using the
//      actionability path does. The same completeness applies to the
//      scroll stimulus itself: scrollBlockToViewportTop asserts the block
//      actually landed where the scenario commanded.
//   3. Fixture book — two chapters of numbered sentences whose zero-padded
//      numbers sit inside the first ENTRY_PREFIX_MAX_CHARS chars, so a deep
//      mark's panel prefix is distinguishable from the chapter start's
//      (04's fixture lesson: past the 20-char cut, 「Sentence 001 of…」 and
//      「Sentence 032 of…」 both cut to the same blind prefix).
//   4. Server discipline — free the port with fuser first (the orphan from
//      a crashed run otherwise answers every probe: bit 04 and 08), a
//      scratch database under /tmp (never the user's .data), kill by PID
//      with the port freed behind it, and skip `npm run build` when .output
//      is newer than every source dir (04's iteration loop rebuilt the
//      whole monorepo every round for nothing).
//
// The worked example — reading-bookmarks-04.mjs, nine assertions — is the
// regression pin: running it green proves the skeleton works and keeps 04's
// acceptance replayable as a repo asset instead of a session temp dir.
// Deliberately NOT wired into pre-commit/verify/CI: a browser acceptance
// needs build artifacts and Chromium, so it runs per ticket, by hand.
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const OUTPUT_DIR = join(REPO_ROOT, ".output");
export const DEFAULT_PORT = 3789;
export const RUN_ROOT = join(tmpdir(), "lingualeaf-browser-e2e");
// Mirrors ReadingPage.tsx's ENTRY_PREFIX_MAX_CHARS — the cut that decides
// whether a fixture number can show in a panel prefix at all.
export const ENTRY_PREFIX_MAX_CHARS = 20;

export const DEFAULT_BOOK = {
  chapters: [{ title: "Chapter One" }, { title: "Chapter Two" }],
  sentencesPerChapter: 50,
};

// ---- Piece 3: the fixture book. ------------------------------------------

// One sentence per paragraph — no mid-line periods, no abbreviation traps
// (sbd splits on both) — so the import's 1:1 paragraph→sentence-block
// mapping holds and block N is exactly sentence N.
export function buildBookMarkdown({ chapters, sentencesPerChapter }) {
  const sections = chapters.map((chapter) => {
    const subject = chapter.title.toLowerCase();
    const lines = [`# ${chapter.title}`];
    for (let n = 1; n <= sentencesPerChapter; n += 1) {
      const number = String(n).padStart(3, "0");
      // The number must live inside the first ENTRY_PREFIX_MAX_CHARS
      // chars: the panel cuts entries there, so 「Sentence 032 of chap…」
      // is the only form in which a deep mark reads as deep.
      lines.push(
        "",
        `Sentence ${number} of ${subject} tells how the old man woke before dawn.`
      );
    }
    return lines.join("\n");
  });
  return `${sections.join("\n\n")}\n`;
}

// ---- Piece 4 (first half): dist freshness. --------------------------------

// Newest file mtime under a file or directory; null when the path is
// missing. Files only — directory mtimes churn on unrelated creates.
export function newestMtimeUnder(target) {
  let rootStat;
  try {
    rootStat = statSync(target);
  } catch {
    return null;
  }
  if (rootStat.isFile()) return rootStat.mtimeMs;
  let newest = null;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile()) {
        const ms = statSync(child).mtimeMs;
        if (newest === null || ms > newest) newest = ms;
      }
    }
  };
  walk(target);
  return newest;
}

// Fresh = a dist exists and no source path is newer than its newest file.
export function distIsFresh({ sourcePaths, distDir }) {
  const distNewest = newestMtimeUnder(distDir);
  if (distNewest === null) return false;
  for (const source of sourcePaths) {
    const ms = newestMtimeUnder(source);
    if (ms !== null && ms > distNewest) return false;
  }
  return true;
}

// Everything that feeds `.output`: the server and web sources, the two
// shared packages their builds inline, and the web entry/config. (Root
// package.json dependency bumps are not watched — a dep change is a
// deliberate act; run `npm run build` or delete .output once.)
const APP_SOURCE_PATHS = [
  join(REPO_ROOT, "apps/server/src"),
  join(REPO_ROOT, "apps/web/src"),
  join(REPO_ROOT, "apps/web/index.html"),
  join(REPO_ROOT, "apps/web/vite.config.ts"),
  join(REPO_ROOT, "packages/reading-model/src"),
  join(REPO_ROOT, "packages/import-core/src"),
];

// Skip the full-monorepo build when .output already reflects the sources —
// 04's acceptance rebuilt every iteration round for nothing.
export async function rebuildIfStale() {
  if (distIsFresh({ sourcePaths: APP_SOURCE_PATHS, distDir: OUTPUT_DIR })) {
    console.log("[harness] .output is fresh — skipping build");
    return;
  }
  console.log("[harness] .output stale or missing — running npm run build…");
  execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });
}

// ---- Piece 4 (second half): the app server under discipline. --------------

function freePort(port) {
  try {
    execFileSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "fuser is not installed — the orphan-port discipline (docs/agents/browser-e2e.md) cannot run without it"
      );
    }
    // Non-zero exit with fuser present = nobody held the port. Good.
  }
}

// Free the port, start the built server on a scratch database, and probe
// readiness as child-alive AND health-route-ok — a foreign listener on the
// port must read as failure, never as readiness (local-e2e invariant 3).
// The port is the recipe's fixed 3789 by default: one harness run at a
// time — a second concurrent run's fuser -k kills the first's server
// mid-scenario, and the first's respawn wins the race instead (observed
// 2026-11-01 when a review ran the example while another run started).
export async function startAppServer({ port = DEFAULT_PORT, runDir }) {
  freePort(port);
  await sleep(1000);
  const dbPath = join(runDir, "books.sqlite");
  const logPath = join(runDir, "server.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    [join(OUTPUT_DIR, "server", "main.js")],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_PATH: dbPath,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
      stdio: ["ignore", logFd, logFd],
    }
  );
  closeSync(logFd);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `server exited early (code ${child.exitCode}) — log: ${logPath}`
      );
    }
    const healthy = await fetch(`${baseUrl}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return { child, baseUrl, logPath, dbPath };
    await sleep(200);
  }
  child.kill("SIGKILL");
  throw new Error(`server never became healthy within 30s — log: ${logPath}`);
}

// Kill by PID, not by faith — and free the port behind the kill, so even a
// wedged process cannot orphan the next run.
export async function stopAppServer(child, port = DEFAULT_PORT) {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    const deadline = Date.now() + 5000;
    while (child.exitCode === null && Date.now() < deadline) {
      await sleep(100);
    }
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  freePort(port);
}

// ---- Piece 1: the cached Chromium. ----------------------------------------

export function findChromeExe() {
  if (process.env.CHROME_EXE) return process.env.CHROME_EXE;
  const cache = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(cache)) {
    const candidates = readdirSync(cache)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const dir of candidates) {
      const exe = join(cache, dir, "chrome-linux64", "chrome");
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error(
    "no Chromium in ~/.cache/ms-playwright — set CHROME_EXE or run `npx playwright install chromium`"
  );
}

// playwright-core is a pure driver: with executablePath set it downloads
// nothing. Imported lazily so the unit seam (harness.test.mjs) does not pay
// the load. --no-sandbox mirrors the extension smoke's launch of the same
// cached Chromium (root/WSL sandboxes vary); --no-proxy-server keeps the
// WSL system proxy from answering for loopback.
export async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    executablePath: findChromeExe(),
    headless: true,
    args: ["--no-proxy-server", "--no-sandbox"],
  });
}

// ---- Piece 2: stimulus-complete interactions. -----------------------------

// The selector is named once here because the locator object (not the
// string) crosses into each evaluate callback — the string itself cannot
// be shared with page.evaluate bodies, which serialize without module scope.
const blockLocator = (page, position) =>
  page.locator(`.blocks [data-position="${position}"]`);

// Where a block's top edge sits in the viewport, in px (null-shaped reads
// belong to the stimulus helpers below).
export function blockTop(page, position) {
  return blockLocator(page, position).evaluate(
    (el) => el.getBoundingClientRect().top
  );
}

// The viewport-sensitive click. DOM level via locator.evaluate — evaluate
// runs no actionability checks, so playwright cannot inject its pre-click
// auto-scroll (04's three burned rounds happened with the target IN view;
// the injection lands inside the actionability window of locator.click()).
// The invariant is built in, not optional: if scrollY moves across the
// click, the stimulus is not viewport-clean and whatever the handler
// measured is untrustworthy — throw, naming the pitfall.
// `point` (viewport coords) is for click targets whose handler anchors
// something at the pointer (the word-lookup popup); without it the
// synthetic click reads 0/0 and the anchor clamps into the viewport.
// `handlerMayScroll` is for clicks whose handler scrolls ON PURPOSE — the
// bookmark jump entries, whose scrollIntoView IS the feature under test
// (04's record applies the invariant to the capture click, not the jump;
// the jump is verified by where the reader lands). evaluate dispatches no
// driver scroll in either case, so nothing can corrupt the click instant.
export async function clickWithoutScroll(
  locator,
  { label = "target", point = null, handlerMayScroll = false } = {}
) {
  const page = locator.page();
  const before = await page.evaluate(() => window.scrollY);
  await locator.evaluate((el, point) => {
    if (point) {
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
        })
      );
    } else {
      el.click();
    }
  }, point);
  const after = await page.evaluate(() => window.scrollY);
  if (before !== after && !handlerMayScroll) {
    throw new Error(
      `stimulus broken: scrollY moved ${before} → ${after} across the DOM-level click on ${label} — the handler measured a viewport the driver moved, not the reader's. ` +
        "(locator.click() injects pre-click auto-scroll inside its actionability window even when the target is in view; only the DOM-level click with this invariant is safe — docs/agents/browser-e2e.md §3.)"
    );
  }
  return { before, after };
}

// The scroll stimulus, held to the same completeness standard as the click:
// assert the block actually landed at the viewport top before the scenario
// trusts anything measured off that viewport (block 32 top at 0 is what
// makes topmostVisibleBlock read 32 — off by a pixel the wrong way and the
// capture reads the neighbor).
export async function scrollBlockToViewportTop(page, position) {
  const block = blockLocator(page, position);
  if ((await block.count()) === 0) {
    throw new Error(`no block at data-position="${position}"`);
  }
  const landed = await block.evaluate((el) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
    return el.getBoundingClientRect().top;
  });
  if (Math.abs(landed) > 0.75) {
    throw new Error(
      `stimulus broken: block ${position} landed at ${landed}px, not the viewport top — the scroll command did not take.`
    );
  }
  return landed;
}

// The in-view scroll stimulus, for positions too near the end of the
// chapter to reach the viewport top (the reading page renders one chapter
// at a time — 04's 起跳点 block 45 has only ~280px of content below it, so
// a top-edge scroll just clamps at max). Completeness invariant: the block
// must sit fully inside the viewport after the scroll, or the stimulus did
// not produce the state the scenario meant to produce.
export async function scrollBlockIntoView(
  page,
  position,
  { offsetFromTop = 100 } = {}
) {
  const block = blockLocator(page, position);
  if ((await block.count()) === 0) {
    throw new Error(`no block at data-position="${position}"`);
  }
  const visible = await block.evaluate((el, offsetFromTop) => {
    window.scrollTo(
      0,
      el.getBoundingClientRect().top + window.scrollY - offsetFromTop
    );
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      inView: rect.top >= 0 && rect.bottom <= window.innerHeight,
    };
  }, offsetFromTop);
  if (!visible.inView) {
    throw new Error(
      `stimulus broken: block ${position} not fully in view after the scroll (top ${visible.top}px).`
    );
  }
  return visible;
}

// A handler-induced scroll (the jump entries) changes scrollY synchronously
// but delivers its scroll events on the NEXT animation frame. A stimulus
// issued immediately after the jump races that delivery — the word-lookup
// popup, which dismisses on scroll, can mount, catch the jump's own late
// event, and unmount between two polls (observed as a one-off A9 timeout on
// 2026-11-01). Settled = no scroll event for a full quiet window; the
// timestamp watch is armed by runBrowserE2E's init script, so it survives
// reloads. Call this between a handlerMayScroll click and the next
// viewport-sensitive stimulus.
export async function waitForScrollSettle(page, { quietMs = 350 } = {}) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const idleFor = await page.evaluate(
      ({ quietMs }) => {
        const last = window.__harnessLastScrollAt;
        if (last === undefined) return quietMs; // watch not armed yet
        return performance.now() - last;
      },
      { quietMs }
    );
    if (idleFor >= quietMs) return;
    await sleep(50);
  }
  throw new Error(
    "stimulus broken: the page kept scrolling for 5s — a jump or restore never settled; do not trust viewport measurements made after it."
  );
}

// ---- The assertion ledger (the extension smoke's shape). ------------------

export function createCheckLedger({ label }) {
  const failures = [];
  const check = (name, ok, detail = "") => {
    console.log(
      `[${label}] ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`
    );
    if (!ok) failures.push(name);
  };
  return { check, failures };
}

// ---- The orchestrator. ----------------------------------------------------

// One call = one acceptance run: fresh scratch dir, build only when stale,
// server up, browser up, scenario checked, everything torn down whichever
// way the scenario ends. Exit code 0 only when every check passed.
export async function runBrowserE2E({ name, scenario, book = DEFAULT_BOOK }) {
  const runDir = join(RUN_ROOT, name);
  // A stale run's database must never leak into this one: wipe first, so
  // the scratch DB is always born empty.
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  console.log(`[${name}] artifacts → ${runDir}`);
  await rebuildIfStale();

  const fixturePath = join(runDir, "fixture-book.md");
  writeFileSync(fixturePath, buildBookMarkdown(book));

  const port = Number(process.env.BROWSER_E2E_PORT ?? DEFAULT_PORT);
  const ledger = createCheckLedger({ label: name });
  // One try/finally around everything that comes up (local-e2e invariant 2):
  // a launchBrowser/newContext failure after the server started must still
  // tear the server down, or this run manufactures the orphan that poisons
  // its own next run.
  let server = null;
  let browser = null;
  try {
    server = await startAppServer({ port, runDir });
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    // The scroll-settle watch (waitForScrollSettle): timestamps every scroll
    // event, installed before the app loads and reinstalled by the browser on
    // every navigation/reload.
    await page.addInitScript(() => {
      window.addEventListener(
        "scroll",
        () => {
          window.__harnessLastScrollAt = performance.now();
        },
        { passive: true }
      );
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    try {
      await scenario({
        page,
        baseUrl: server.baseUrl,
        runDir,
        fixturePath,
        check: ledger.check,
      });
      ledger.check(
        "no uncaught page errors",
        pageErrors.length === 0,
        pageErrors.join(" | ")
      );
    } catch (error) {
      ledger.check("scenario ran to completion", false, String(error));
    }
  } finally {
    if (browser) await browser.close();
    if (server) await stopAppServer(server.child, port);
  }

  const { failures } = ledger;
  if (failures.length === 0) {
    console.log(`[${name}] all checks passed — EXIT=0`);
  } else {
    console.error(
      `[${name}] FAILED: ${failures.length} — ${failures.join("; ")}`
    );
    process.exitCode = 1;
  }
}
