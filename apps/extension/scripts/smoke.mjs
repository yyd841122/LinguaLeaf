// The extension's real-browser acceptance, committed so no session has to
// reinvent it (and so the stale-dist class of bug cannot happen: the build
// runs FIRST, every time). Drives the built reader page over CDP with a
// self-spawned cached Chromium — docs/agents/browser-e2e.md carries the
// recipe and its limits (the chrome.* stub here masks manifest-permission
// gaps; check-manifest-permissions.mjs is that class's gate).
//
// Usage: npm run smoke --workspace @lingualeaf/extension
//   CHROME_EXE overrides the Chromium binary; otherwise the playwright
//   cache glob picks the newest one.
import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("..", import.meta.url).pathname;
const repoRoot = new URL("../../..", import.meta.url).pathname;
const DIST = join(root, "dist");
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333);

// ---- Step 1: fresh build. The smoke always tests what the source says. --
console.log("[smoke] building extension (fresh dist)...");
execSync("npm run build", { cwd: root, stdio: "inherit" });
if (!existsSync(join(DIST, "dictionary.json"))) {
  console.error(
    "[smoke] dist/dictionary.json missing — run " +
      "`npm run bake:dictionary --workspace @lingualeaf/extension` first."
  );
  process.exit(1);
}

// ---- Step 2: fixtures. ---------------------------------------------------
const samplePdfPath = join(root, "spike/sample.pdf");
if (!existsSync(samplePdfPath)) {
  execSync(`npx tsx ${join(root, "scripts/make-spike-pdf.ts")}`, {
    cwd: root,
    stdio: "inherit",
  });
}
const samplePdf = readFileSync(samplePdfPath);
const { buildEpub } = await import("@lingualeaf/import-core/testing");
const epubBytes = Buffer.from(
  await buildEpub({
    title: "Smoke EPUB",
    docs: [
      {
        href: "text/c.xhtml",
        body: "<h1>Chapter</h1><p>The old man woke early.</p>",
      },
    ],
  })
);

// ---- Step 3: serve dist over loopback (module CORS) and spawn Chromium. --
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".pdf": "application/pdf",
};
const server = createServer(async (req, res) => {
  const path = normalize(
    decodeURIComponent(new URL(req.url, "http://x").pathname)
  );
  const name = path === "/" || path === "\\" ? "reader.html" : path.slice(1);
  try {
    const body = readFileSync(join(DIST, name));
    res.writeHead(200, {
      "content-type": MIME[extname(name)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

function findChrome() {
  if (process.env.CHROME_EXE) return process.env.CHROME_EXE;
  const cache = join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (existsSync(cache)) {
    const candidates = readdirSync(cache)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const dir of candidates) {
      const exe = join(cache, dir, "chrome-linux64", "chrome");
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error(
    "no Chromium found — set CHROME_EXE or run `npx playwright install chromium`"
  );
}
const chrome = findChrome();
// Free the port first (docs/agents/local-e2e.md invariant 1): an orphaned
// Chromium from an earlier run holds the DevTools port, the new one binds
// nothing and every readiness probe answers the ORPHAN.
try {
  execSync(`fuser -k ${CDP_PORT}/tcp 2>/dev/null || true`, { shell: true });
  await new Promise((r) => setTimeout(r, 500));
} catch {
  // Nothing held the port.
}
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-sandbox",
    "--no-first-run",
    "--no-proxy-server",
    `--user-data-dir=/tmp/lingualeaf-smoke-profile-${CDP_PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(
    `[smoke] ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`
  );
  if (!ok) failures.push(name);
};

try {
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    if (proc.exitCode !== null)
      throw new Error("chrome exited: " + proc.exitCode);
    ready = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      .then((r) => r.ok)
      .catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("CDP never became ready");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  await context.addInitScript(() => {
    // Minimal chrome.storage stub: outside the extension origin chrome.*
    // is absent. KNOWN LIMIT — this masks manifest-permission gaps;
    // scripts/check-manifest-permissions.mjs is that class's gate, and
    // the load-unpacked pass is the human acceptance.
    const bag = {};
    window.chrome = {
      storage: {
        local: {
          get: async (key) =>
            bag[key] !== undefined ? { [key]: bag[key] } : {},
          set: async (obj) => {
            Object.assign(bag, obj);
          },
        },
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- EPUB line: import, IPA pairing, popup, 查词即状态. ---------------
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', {
    name: "book.epub",
    mimeType: "application/epub+zip",
    buffer: epubBytes,
  });
  await page.waitForSelector("[data-word='woke']", { timeout: 60000 });
  check("EPUB: chapters render with word targets", true);
  // The transcription rides data-ipa and paints via ::before (pseudo-
  // element content never enters a text selection) — textContent is empty
  // BY DESIGN; the attribute is the value. The real baked dictionary's
  // answer is data, not a constant, so the contract is non-empty.
  const wokeIpa = await page.getAttribute(
    "[data-word='woke'] .ipa-word-ipa",
    "data-ipa"
  );
  check(
    "EPUB: IPA pairs with the word",
    typeof wokeIpa === "string" && wokeIpa.length > 0,
    wokeIpa ?? "absent"
  );
  await page.evaluate(() => {
    document
      .querySelector("[data-word='woke']")
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 200 })
      );
  });
  await page.waitForSelector(".lookup-vocab", { timeout: 15000 });
  check(
    "EPUB: popup enrolls first lookup as 学习中",
    (await page.textContent(".lookup-vocab-option[aria-pressed='true']")) ===
      "学习中"
  );
  await page.keyboard.press("Escape");

  // ---- PDF line: in-place overlay geometry, nav, toggle. ----------------
  await page.click(".reader-reopen");
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', {
    name: "sample.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf,
  });
  await page.waitForSelector("[data-pdf-word]", { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const ipa = document.querySelector("[data-word='The'] .pdf-ipa");
      return ipa && ipa.textContent && ipa.textContent.length > 0;
    },
    { timeout: 20000 }
  );
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector("canvas").getBoundingClientRect();
    const words = [...document.querySelectorAll("[data-pdf-word]")];
    let positioned = 0,
      chipped = 0,
      transparent = 0,
      noSelect = 0;
    for (const w of words) {
      const wb = w.getBoundingClientRect();
      if (
        wb.width > 0 &&
        wb.top >= canvas.top - 2 &&
        wb.left >= canvas.left - 2
      )
        positioned += 1;
      if (getComputedStyle(w).color === "rgba(0, 0, 0, 0)") transparent += 1;
      if (getComputedStyle(w).userSelect === "none") noSelect += 1;
      const ipa = w.querySelector(".pdf-ipa");
      if (!ipa) continue;
      const fontPx = parseFloat(getComputedStyle(w).fontSize);
      const ib = ipa.getBoundingClientRect();
      if (
        getComputedStyle(ipa).backgroundColor.startsWith(
          "rgba(255, 255, 255"
        ) &&
        ib.top >= wb.top + fontPx
      )
        chipped += 1;
    }
    return {
      words: words.length,
      positioned,
      chipped,
      transparent,
      noSelect,
      hidpiBacking: `${canvas.width}x${canvas.height}`,
    };
  });
  check(
    "PDF: overlay geometry (positioned/chipped/transparent/noSelect)",
    geometry.positioned === geometry.words &&
      geometry.chipped === geometry.words &&
      geometry.transparent === geometry.words &&
      geometry.noSelect === geometry.words,
    JSON.stringify(geometry)
  );
  await page.click(".reader-pager button:last-child");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-position")
        ?.textContent?.startsWith("2 /"),
    { timeout: 10000 }
  );
  await page.click(".reader-pager button:first-child");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".reader-position")
        ?.textContent?.startsWith("1 /"),
    { timeout: 10000 }
  );
  check("PDF: page navigation", true);
  await page.click(".reader-toggle");
  await page.waitForFunction(
    () => document.querySelectorAll(".pdf-ipa").length === 0,
    { timeout: 15000 }
  );
  await page.click(".reader-toggle");
  await page.waitForFunction(
    () => document.querySelectorAll(".pdf-ipa").length > 0,
    { timeout: 15000 }
  );
  check("PDF: IPA toggle", true);

  // ---- Scanned rejection. ------------------------------------------------
  const { createRequire } = await import("node:module");
  const pdfLib = createRequire(join(repoRoot, "package.json"))("pdf-lib");
  const scanned = await pdfLib.PDFDocument.create();
  scanned
    .addPage([612, 792])
    .drawRectangle({ x: 50, y: 400, width: 500, height: 300 });
  await page.click(".reader-reopen");
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', {
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await scanned.save()),
  });
  await page.waitForSelector(".reader-error", { timeout: 15000 });
  check(
    "PDF: scanned gets the 书-wording rejection",
    (await page.textContent(".reader-error")).includes("扫描版 PDF 不支持")
  );

  // The only tolerable console error is the favicon 404.
  const realErrors = errors.filter((e) => !e.includes("404"));
  check(
    "no page errors beyond favicon",
    realErrors.length === 0,
    realErrors.join(" | ")
  );
} finally {
  proc.kill("SIGKILL");
  server.close();
}

if (failures.length > 0) {
  console.error(`[smoke] FAILED: ${failures.length} — ${failures.join("; ")}`);
  process.exit(1);
}
console.log("[smoke] all checks passed");
