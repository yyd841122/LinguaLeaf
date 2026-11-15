// Mobile browser acceptance: chapter switch must land at the chapter TOP
// (mobile-md-import 真机 round 1 regression). The md book's tall chapter 1
// exposed a face-wide hole: goChapter wrote blockIndex 0 to the seam but
// never reset the window scroll, so the reader landed mid-chapter at the
// old offset (short chapters hid it behind the bottom clamp — the EPUB
// control arm of the diagnosis loop landed at 0 only because one block
// cannot out-scroll the viewport). jsdom cannot see this: window.scrollY
// is always 0 there. This scenario is the only seam that reads the real
// viewport, so it runs per ticket by hand, like the web acceptance:
//
//   node scripts/browser-e2e/mobile-md-chapter-scroll.mjs
//
// Deliberately NOT wired into pre-commit/verify (needs built dist +
// Chromium), same standing as reading-bookmarks-04.mjs. Serves the BUILT
// mobile dist statically — rebuilding it if stale against src — never the
// dev server, and never the user's device.
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  clickWithoutScroll,
  createCheckLedger,
  launchBrowser,
  REPO_ROOT,
  RUN_ROOT,
  waitForScrollSettle,
} from "./harness.mjs";

const MOBILE_DIR = join(REPO_ROOT, "apps", "mobile");
const DIST = join(MOBILE_DIR, "dist");
const SRC = join(MOBILE_DIR, "src");
const PORT = 4179;
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".md": "text/markdown",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

// Freshness in the distIsFresh spirit: any src file newer than the built
// index rebuilds the dist (the scenario reads the built app, so a stale
// dist would test yesterday's fix).
function distIsStale() {
  const distTime = statSync(join(DIST, "index.html")).mtimeMs;
  const newest = (dir) => {
    let newestTime = statSync(dir).mtimeMs;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      newestTime = Math.max(
        newestTime,
        entry.isDirectory() ? newest(path) : statSync(path).mtimeMs
      );
    }
    return newestTime;
  };
  return newest(SRC) > distTime;
}

// The fixture mirrors the shape that went red on the phone: chapter 1
// tall enough to out-scroll several viewports, chapter 2 tall enough that
// the inherited offset lands MID-chapter instead of clamping to the
// bottom (the clamp is what masked this for short EPUB chapters).
const FIXTURE_MD = [
  "# Scroll Fixture",
  "",
  ...Array.from(
    { length: 80 },
    (_, i) =>
      `Chapter one paragraph ${i}. The tall first chapter is the trigger: the reader must forget its scroll offset when the chapter changes, not inherit it.`
  ),
  "",
  "## Second",
  "",
  ...Array.from(
    { length: 30 },
    (_, i) =>
      `Chapter two paragraph ${i}. If the switch lands here mid-chapter the regression is back.`
  ),
  "",
].join("\n");

async function main() {
  const ledger = createCheckLedger({ label: "mobile-md-chapter-scroll" });
  const runDir = join(RUN_ROOT, "mobile-md-chapter-scroll");
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  const bookPath = join(runDir, "scroll-fixture.md");
  writeFileSync(bookPath, FIXTURE_MD);

  if (distIsStale()) {
    console.log("[mobile-md-chapter-scroll] dist stale — rebuilding");
    execSync("npm run build -w @lingualeaf/mobile", {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }

  // Port discipline (docs/agents/browser-e2e.md §1): the orphan from a
  // crashed run otherwise answers every probe.
  execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { shell: "/bin/bash" });
  await sleep(1000);

  const server = createServer((req, res) => {
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    try {
      const body = readFileSync(join(DIST, path));
      res.writeHead(200, {
        "content-type": MIME[extname(path)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("no");
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  const browser = await launchBrowser();
  let failed = false;
  try {
    const page = await browser.newPage({
      viewport: { width: 412, height: 915 },
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.setInputFiles('input[type="file"]', bookPath);
    await page.waitForSelector("h1.reader-title", { timeout: 15000 });
    ledger.check(
      "import renders chapter 1",
      (await page.textContent("h1.reader-title")) === "Scroll Fixture"
    );

    // The stimulus: read deep into chapter 1, held to the harness
    // completeness standard — assert the offset actually landed.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await waitForScrollSettle(page);
    const deep = await page.evaluate(() => window.scrollY);
    ledger.check(
      "deep scroll stimulus landed",
      deep > 2000,
      `scrollY=${Math.round(deep)}`
    );

    // The chapter switch. The fixed handler scrolls ON PURPOSE, so the
    // click carries handlerMayScroll; the DOM-level click still runs no
    // driver actionability (docs/agents/browser-e2e.md §3 discipline).
    await clickWithoutScroll(page.getByRole("button", { name: "下一章" }), {
      label: "下一章",
      handlerMayScroll: true,
    });
    await waitForScrollSettle(page);

    const after = await page.evaluate(() => {
      const vh = window.innerHeight;
      let topmost = null;
      for (const el of document.querySelectorAll("[data-block-index]")) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < vh) {
          topmost = {
            index: el.getAttribute("data-block-index"),
            top: Math.round(rect.top),
          };
          break;
        }
      }
      return {
        scrollY: Math.round(window.scrollY),
        position: document.querySelector(".reader-position")?.textContent,
        topmost,
      };
    });
    ledger.check(
      "chapter switch lands at the chapter top",
      after.scrollY <= 2,
      `scrollY=${after.scrollY}`
    );
    ledger.check(
      "first block of the new chapter is the topmost visible",
      after.topmost?.index === "0" &&
        after.topmost.top >= 0 &&
        after.topmost.top < 460,
      JSON.stringify(after.topmost)
    );
    ledger.check(
      "position reads chapter 2 of 2",
      after.position === "2 / 2",
      `position=${after.position}`
    );
    failed = ledger.failures.length > 0;
  } finally {
    await browser.close();
    server.close();
    // Free the port behind the server, harness discipline.
    execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, {
      shell: "/bin/bash",
    });
    await sleep(300);
  }
  if (failed) process.exit(1);
  console.log("[mobile-md-chapter-scroll] all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
