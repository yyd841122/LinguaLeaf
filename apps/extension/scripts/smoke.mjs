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
import { execFileSync, execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build as viteBuild } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const DIST = join(root, "dist");
// Bundle the actual store for a narrow native proof, without exposing test
// hooks in the shipped extension. This directory is removed in finally.
const proofDir = mkdtempSync(join(tmpdir(), "lingualeaf-pdf-bytes-proof-"));
await viteBuild({
  configFile: false,
  build: {
    outDir: proofDir,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: join(root, "src/store/idb-bytes-store.ts"),
      formats: ["es"],
      fileName: () => "pdf-bytes-proof.js",
    },
  },
});

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
  execFileSync("npx", ["tsx", join(root, "scripts/make-spike-pdf.ts")], {
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
    // eslint-disable-next-line no-restricted-syntax -- request routing: this pathname IS the URL path (decoded below), not a filesystem path
    decodeURIComponent(new URL(req.url, "http://x").pathname)
  );
  const name = path === "/" || path === "\\" ? "reader.html" : path.slice(1);
  try {
    const body = readFileSync(
      name === "pdf-bytes-proof.js" ? join(proofDir, name) : join(DIST, name)
    );
    res.writeHead(200, {
      "content-type": MIME[extname(name)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
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
const failures = [];
const failureSuffix = () =>
  failures.length > 0 ? " — " + failures.join("; ") : "";
const check = (name, ok, detail = "") => {
  console.log(
    `[smoke] ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`
  );
  if (!ok) failures.push(name);
};

// One try/finally owns the server and the Chromium: whichever way the
// scenarios end, both are torn down (audit 2026-10-30 finding 7).
let proc;
let cdpPort = null;
let profileDir = null;

// Ephemeral DevTools port: --remote-debugging-port=0 lets Chromium pick a
// free one and publish it as the first line of
// <user-data-dir>/DevToolsActivePort. No fixed port to free beforehand, so
// an orphaned Chromium (docs/agents/local-e2e.md invariant 1) or a
// concurrent run can no longer collide with — or be killed by — this one.
const startChromium = async () => {
  profileDir = mkdtempSync(join(tmpdir(), "lingualeaf-smoke-profile-"));
  proc = spawn(
    findChrome(),
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-sandbox",
      "--no-first-run",
      "--no-proxy-server",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  proc.on("error", (err) => {
    failures.push("chrome spawn: " + err.message);
  });
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    if (proc.exitCode !== null)
      throw new Error("chrome exited: " + proc.exitCode + failureSuffix());
    try {
      const portLine = readFileSync(
        join(profileDir, "DevToolsActivePort"),
        "utf8"
      ).split("\n")[0];
      if (portLine) {
        cdpPort = Number(portLine);
        ready = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
          .then((r) => r.ok)
          .catch(() => false);
      }
    } catch {
      // DevToolsActivePort not published yet.
    }
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("CDP never became ready" + failureSuffix());
};

// ---- Step 4: the scenarios. Each asserts its own line through `check`; ----
// ---- the chore they share is importBook, the reader's reopen →        ----
// ---- file-input sequence that resets between books.                   ----
// This proves localhost's native IDB/Blob contract, not extension-origin
// close/restart persistence. README's load-unpacked checkpoints own that proof.
const proveNativePdfBytes = async (page, port) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  const first = await page.evaluate(
    async (source) => {
      const { createPdfBytesStore, createIndexedDbBytesBackend, readPdfBlob } =
        await import("/pdf-bytes-proof.js");
      const digest = async (bytes) =>
        "pdf:sha256-v1:" +
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      const store = createPdfBytesStore(
        createIndexedDbBytesBackend(indexedDB, "pdf-shelf-native-proof")
      );
      const blob = new Blob([new Uint8Array(source)]);
      const docId = await digest(await blob.arrayBuffer());
      await store.save({ docId, title: "Committed PDF", blob });
      const initial = await store.get(docId);
      const before = await store.list();
      // Abort AFTER a put request succeeds: request success is not commit.
      const original = IDBObjectStore.prototype.put;
      let requestSucceeded = false;
      IDBObjectStore.prototype.put = function (...args) {
        const request = original.apply(this, args);
        if (this.name === "bytes") {
          request.addEventListener("success", () => {
            requestSucceeded = true;
            this.transaction.abort();
          });
        }
        return request;
      };
      let replacementRejected = false;
      let insertRejected = false;
      const other = new Blob(["another complete PDF"]);
      const otherId = await digest(await other.arrayBuffer());
      try {
        await store.save({ docId, title: "Must roll back", blob }).catch(() => {
          replacementRejected = true;
        });
        await store
          .save({ docId: otherId, title: "Must not exist", blob: other })
          .catch(() => {
            insertRejected = true;
          });
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      const after = await store.list();
      // Delay pre-transaction preparation and inject a later failure. The
      // queued delete must still execute; failed saves cannot poison the queue.
      let release;
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      const delayed = new Blob(["delayed"]);
      delayed.arrayBuffer = () => {
        started();
        return new Promise((_, reject) => {
          release = reject;
        });
      };
      const saving = store.save({
        docId: otherId,
        title: "Delayed",
        blob: delayed,
      });
      const savingOutcome = saving.then(
        () => false,
        () => true
      );
      const deleting = store.delete(otherId);
      await ready;
      release(new Error("injected late Blob failure"));
      const lateRejected = await savingOutcome;
      await deleting;
      return {
        docId,
        matches: (await digest(await readPdfBlob(initial.blob))) === docId,
        complete:
          initial.blob.size === blob.size && initial.title === "Committed PDF",
        rollback:
          requestSucceeded &&
          replacementRejected &&
          insertRejected &&
          JSON.stringify(before) === JSON.stringify(after),
        lateRejected,
      };
    },
    [...samplePdf]
  );
  check(
    "PDF native proof: import commits complete bytes and matching digest",
    first.complete && first.matches
  );
  check(
    "PDF native proof: late transaction abort rolls back insert and replacement",
    first.rollback
  );
  check(
    "PDF native proof: delayed failure then delete stays deleted",
    first.lateRejected
  );
  await page.reload();
  const reopened = await page.evaluate(async (docId) => {
    const { createPdfBytesStore, createIndexedDbBytesBackend, readPdfBlob } =
      await import("/pdf-bytes-proof.js");
    const store = createPdfBytesStore(
      createIndexedDbBytesBackend(indexedDB, "pdf-shelf-native-proof")
    );
    const record = await store.get(docId);
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await readPdfBlob(record.blob))
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return (
      record.title === "Committed PDF" &&
      docId === `pdf:sha256-v1:${hash}` &&
      (await store.list()).length === 1
    );
  }, first.docId);
  check(
    "PDF native proof: reload reopens original bytes without file picker",
    reopened
  );
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("pdf-shelf-native-proof");
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("proof database still connected"));
      })
  );
};

const runScenarios = async (page, port) => {
  const importBook = async (file) => {
    // The reopen button only exists inside a reading view; scenarios may
    // arrive already on the landing picker (the shelf scenarios do).
    if (await page.locator(".reader-reopen").count()) {
      await page.click(".reader-reopen");
    }
    await page.waitForSelector('input[type="file"]');
    await page.setInputFiles('input[type="file"]', file);
  };

  const typeLabels = ["进度", "感受", "思路", "疑问"];
  const typeKeys = ["progress", "feeling", "idea", "question"];
  const noteText = (label, type, progressText) =>
    type === "进度" ? progressText : `${label} ${type} smoke note`;
  const checkNarrowNotePopup = async (label) => {
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await page.setViewportSize({ width: 240, height: 220 });
    const dialog = page.locator(".note-popup");
    // This is the textarea's supported resize action, forced large enough
    // that the popup itself must scroll rather than just the text field.
    await page.getByRole("textbox", { name: "笔记正文" }).evaluate((node) => {
      node.style.height = "300px";
    });
    const geometry = await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      node.scrollTop = node.scrollHeight;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        overflow: getComputedStyle(node).overflowY,
        scrolls: node.scrollHeight > node.clientHeight && node.scrollTop > 0,
      };
    });
    check(
      `${label} notes: narrow popup stays in viewport and scrolls`,
      geometry.left >= 8 &&
        geometry.right <= geometry.width - 8 &&
        geometry.top >= 8 &&
        geometry.bottom <= geometry.height - 8 &&
        geometry.overflow === "auto" &&
        geometry.scrolls,
      JSON.stringify(geometry)
    );
    await page.getByRole("button", { name: "保存", exact: true }).focus();
    check(
      `${label} notes: focusing actions scrolls them into view`,
      await dialog.evaluate((node) => {
        const action = document.activeElement;
        if (!action || !node.contains(action)) return false;
        const rect = action.getBoundingClientRect();
        const popup = node.getBoundingClientRect();
        return (
          rect.top >= popup.top &&
          rect.bottom <= popup.bottom &&
          rect.left >= popup.left &&
          rect.right <= popup.right
        );
      })
    );
    await page.getByRole("tab", { name: "疑问", exact: true }).focus();
    await page.keyboard.press("Home");
    check(
      `${label} notes: keyboard moves tab focus in narrow popup`,
      await page
        .getByRole("tab", { name: "进度", exact: true })
        .evaluate(
          (node) =>
            node === document.activeElement &&
            node.getAttribute("aria-selected") === "true"
        )
    );
    await page.getByRole("textbox", { name: "笔记正文" }).evaluate((node) => {
      node.style.height = "";
    });
    await page.setViewportSize(viewport);
  };
  const assertSiblingTypes = async (label, button, progressText) => {
    check(
      `${label} notes: sibling types keep the anchor highlighted`,
      await button.evaluate((node) => node.classList.contains("has-note"))
    );
    await button.click();
    for (const type of typeLabels) {
      await page.getByRole("tab", { name: type, exact: true }).click();
      check(
        `${label} notes: ${type} survives sibling deletion`,
        (await page.getByRole("textbox", { name: "笔记正文" }).inputValue()) ===
          (type === "思路" ? "" : noteText(label, type, progressText))
      );
      if (type === "思路")
        check(
          `${label} notes: deleted type has no delete action`,
          (await page
            .getByRole("button", { name: "删除", exact: true })
            .count()) === 0
        );
    }
    await page.keyboard.press("Escape");
  };
  const checkSameAnchorTypes = async (
    label,
    button,
    progressText,
    namespace
  ) => {
    await button.click();
    check(
      `${label} notes: four ordered tabs and one visible field`,
      JSON.stringify(await page.getByRole("tab").allTextContents()) ===
        JSON.stringify(typeLabels) &&
        (await page.getByRole("textbox", { name: "笔记正文" }).count()) === 1
    );
    for (const type of typeLabels) {
      await page.getByRole("tab", { name: type, exact: true }).click();
      await page
        .getByRole("textbox", { name: "笔记正文" })
        .fill(noteText(label, type, progressText));
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "已存" }).waitFor();
    }
    const record = await page.evaluate(
      async (key) => (await window.chrome.storage.local.get(key))[key],
      namespace
    );
    const sameAnchor = record.notes.filter(
      (note) =>
        note.text === progressText ||
        typeLabels
          .slice(1)
          .some((type) => note.text === `${label} ${type} smoke note`)
    );
    check(
      `${label} notes: v2 stores all four types at one anchor`,
      record.version === 2 &&
        sameAnchor.length === 4 &&
        typeKeys.every((type) =>
          sameAnchor.some((note) => note.type === type)
        ) &&
        sameAnchor.every((note) =>
          namespace === "notes"
            ? note.docId === sameAnchor[0].docId &&
              note.chapterIndex === sameAnchor[0].chapterIndex &&
              note.blockIndex === sameAnchor[0].blockIndex
            : note.docId === sameAnchor[0].docId &&
              note.page === sameAnchor[0].page &&
              note.lineIndex === sameAnchor[0].lineIndex
        )
    );
    await checkNarrowNotePopup(label);
    await page.getByRole("tab", { name: "思路", exact: true }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已删除" }).waitFor();
    await page.keyboard.press("Escape");
    await assertSiblingTypes(label, button, progressText);
  };

  const epubScenario = async () => {
    // EPUB line: import, IPA pairing, popup, 查词即状态.
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
    const noteButton = page.locator(".block-note-button").first();
    await noteButton.waitFor();
    await checkSameAnchorTypes("EPUB", noteButton, "EPUB smoke note", "notes");
    await page.reload();
    await page.getByRole("button", { name: "Smoke EPUB", exact: true }).click();
    await page.waitForSelector(".block-note-button.has-note:enabled");
    await assertSiblingTypes("EPUB", noteButton, "EPUB smoke note");
  };

  const measurePdfGeometry = () =>
    page.evaluate(() => {
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
          wb.left >= canvas.left - 2 &&
          wb.right <= canvas.right + 2 &&
          wb.bottom <= canvas.bottom + 2
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

  const waitPdfNotes = () =>
    page.waitForSelector("[data-pdf-note]:enabled", { timeout: 15000 });
  const checkPdfNotesGeometry = async (label) => {
    await waitPdfNotes();
    const result = await page.evaluate(() => {
      const canvas = document.querySelector("canvas").getBoundingClientRect();
      const words = [...document.querySelectorAll("[data-pdf-word]")];
      const buttons = [...document.querySelectorAll("[data-pdf-note]")];
      const indexes = new Set(words.map((w) => w.dataset.pdfLineIndex));
      return {
        lines: indexes.size,
        buttons: buttons.length,
        unique: new Set(buttons.map((b) => b.dataset.pdfNote)).size,
        anchored: buttons.every((button) => {
          const line = words.filter(
            (w) => w.dataset.pdfLineIndex === button.dataset.pdfNote
          );
          if (!line.length) return false;
          const rect = button.getBoundingClientRect();
          const right = Math.max(
            ...line.map((w) => w.getBoundingClientRect().right)
          );
          const top = line[0].getBoundingClientRect().top;
          // Actual painted control against the word geometry, never just existence.
          // Helvetica vs browser word metrics can differ by a few CSS pixels;
          // terminal punctuation also occupies space after the final word.
          return (
            getComputedStyle(button).position === "absolute" &&
            rect.width > 0 &&
            rect.height > 0 &&
            Math.abs(rect.top - top) < 2 &&
            rect.left >= right - 3 &&
            rect.left < right + 30 &&
            rect.left >= canvas.left &&
            rect.right <= canvas.right + 2
          );
        }),
      };
    });
    check(
      `PDF notes: ${label} line-end geometry and no duplicate controls`,
      result.lines > 0 &&
        result.lines === result.buttons &&
        result.buttons === result.unique &&
        result.anchored,
      JSON.stringify(result)
    );
  };

  const pdfScenario = async () => {
    // PDF line: in-place overlay geometry, nav, toggle.
    await importBook({
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
      undefined,
      { timeout: 20000 }
    );
    const geometry = await measurePdfGeometry();
    check(
      "PDF: overlay geometry (positioned/chipped/transparent/noSelect)",
      geometry.positioned === geometry.words &&
        geometry.chipped === geometry.words &&
        geometry.transparent === geometry.words &&
        geometry.noSelect === geometry.words,
      JSON.stringify(geometry)
    );
    await checkPdfNotesGeometry("initial");
    const initialLines = await page.locator("[data-pdf-note]").count();
    await page.locator("[data-pdf-note]").first().focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector('[role="dialog"][aria-label="行笔记"]');
    check(
      "PDF notes: keyboard opens line editor with focused text",
      await page
        .getByRole("textbox", { name: "笔记正文" })
        .evaluate((node) => node === document.activeElement)
    );
    await page
      .getByRole("textbox", { name: "笔记正文" })
      .fill("PDF smoke note");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已存" }).waitFor();
    await page.keyboard.press("Escape");
    check(
      "PDF notes: Escape restores button focus and saved highlight",
      await page
        .locator("[data-pdf-note]")
        .first()
        .evaluate(
          (node) =>
            node === document.activeElement &&
            node.classList.contains("has-note")
        )
    );
    await checkSameAnchorTypes(
      "PDF",
      page.locator("[data-pdf-note]").first(),
      "PDF smoke note",
      "pdf-notes"
    );
    await page.getByRole("button", { name: "150%", exact: true }).click();
    await checkPdfNotesGeometry("150% zoom");
    check(
      "PDF notes: zoom keeps saved highlight",
      (await page.locator("[data-pdf-note].has-note").count()) === 1
    );
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await checkPdfNotesGeometry("100% zoom");
    // Point-word keyboard lookup still belongs to the existing popup seam.
    for (const key of ["Enter", "Space"]) {
      await page.locator("[data-pdf-word]").first().focus();
      await page.keyboard.press(key);
      await page.waitForSelector(".lookup-vocab");
      check(
        `PDF: ${key} word keyboard lookup survives note controls`,
        (await page
          .locator('[role="dialog"][aria-label^="词详情"]')
          .count()) === 1
      );
      await page.keyboard.press("Escape");
    }
    await page.click(".reader-pager button:last-child");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".reader-position")
          ?.textContent?.startsWith("2 /"),
      undefined,
      { timeout: 10000 }
    );
    await checkPdfNotesGeometry("page two");
    check(
      "PDF notes: page switch removes old line controls and highlight",
      (await page.locator("[data-pdf-note].has-note").count()) === 0 &&
        (await page.locator("[data-pdf-note]").count()) !== initialLines
    );
    await page.click(".reader-pager button:first-child");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".reader-position")
          ?.textContent?.startsWith("1 /"),
      undefined,
      { timeout: 10000 }
    );
    await checkPdfNotesGeometry("page one restored");
    check(
      "PDF notes: return restores one saved highlight",
      (await page.locator("[data-pdf-note].has-note").count()) === 1
    );
    check("PDF: page navigation", true);
    await page.click(".reader-toggle");
    await page.waitForFunction(
      () => document.querySelectorAll(".pdf-ipa").length === 0,
      undefined,
      { timeout: 15000 }
    );
    await page.click(".reader-toggle");
    await page.waitForFunction(
      () => document.querySelectorAll(".pdf-ipa").length > 0,
      undefined,
      { timeout: 15000 }
    );
    check("PDF: IPA toggle", true);
    await checkPdfNotesGeometry("IPA rebuilt");
    check(
      "PDF notes: IPA rebuild keeps highlight",
      (await page.locator("[data-pdf-note].has-note").count()) === 1
    );
    await page.locator("[data-pdf-note].has-note").click();
    check(
      "PDF notes: reattached text survives rebuild",
      (await page.getByRole("textbox", { name: "笔记正文" }).inputValue()) ===
        "PDF smoke note"
    );
    await page.keyboard.press("Escape");
    await page.click(".reader-reopen");
    await page.waitForSelector('input[type="file"]');
    check(
      "PDF notes: leaving removes all PDF overlays",
      (await page.locator("[data-pdf-word], [data-pdf-note]").count()) === 0
    );
    await page.waitForSelector('[aria-label="PDF 书架"] li[data-pdf-doc-id]');
    const cached = await page.evaluate(async () => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      const store = createPdfBytesStore();
      const entries = await store.list();
      const record = await store.get(entries[0].docId);
      const digest = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer())
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return {
        entry: entries[0],
        digest: `pdf:sha256-v1:${digest}`,
        count: entries.length,
      };
    });
    check(
      "PDF shelf: real picker bytes survived PDF.js transfer and committed intact",
      cached.count === 1 && cached.digest === cached.entry.docId
    );
    check(
      "PDF shelf: coexists with EPUB recents without a duplicate reselect hint",
      (await page.locator('[aria-label="最近 PDF 会话"]').count()) === 0 &&
        (await page
          .getByRole("button", { name: "Smoke EPUB", exact: true })
          .count()) === 1
    );
    // Seed a legacy recent identity without bytes to prove all three entry
    // forms coexist. It is a convenience record, not another cached PDF.
    const legacyId = "pdf:sha256-v1:" + "0".repeat(64);
    await page.evaluate(async (docId) => {
      const key = "pdf-positions";
      const record = (await window.chrome.storage.local.get(key))[key];
      record.recent = { docId, title: "Legacy PDF", page: 7, scale: 1 };
      await window.chrome.storage.local.set({ [key]: record });
    }, legacyId);
    await page.reload();
    await page.waitForSelector('[aria-label="最近 PDF 会话"]');
    check(
      "PDF shelf: cached row, EPUB recents and nonclickable no-bytes hint coexist after reload",
      (await page
        .locator('[aria-label="PDF 书架"] li[data-pdf-doc-id]')
        .count()) === 1 &&
        (await page
          .getByRole("button", { name: "Smoke EPUB", exact: true })
          .count()) === 1 &&
        (await page
          .locator(
            '[aria-label="最近 PDF 会话"] button, [aria-label="最近 PDF 会话"] a'
          )
          .count()) === 0 &&
        (
          await page.locator('[aria-label="最近 PDF 会话"]').textContent()
        ).includes("Legacy PDF")
    );
    // Reopen WITHOUT any setInputFiles call. Restore a nondefault page and
    // zoom first, then reload again to exercise the complete cached chain.
    await page.locator('[aria-label="PDF 书架"] .reader-recent').click();
    await waitPdfNotes();
    await assertSiblingTypes(
      "PDF",
      page.locator("[data-pdf-note]").first(),
      "PDF smoke note"
    );
    await page.getByRole("button", { name: "150%", exact: true }).click();
    await checkPdfNotesGeometry("cached 150% zoom");
    await page.click(".reader-pager button:last-child");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".reader-position")
          ?.textContent?.startsWith("2 /"),
      undefined,
      { timeout: 10000 }
    );
    await waitPdfNotes();
    await page.click(".reader-reopen");
    await page.waitForSelector('[aria-label="PDF 书架"] li[data-pdf-doc-id]');
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="PDF 书架"] li')
        ?.textContent?.includes("第 2 页")
    );
    check(
      "PDF shelf: row carries the latest page",
      (await page.locator('[aria-label="PDF 书架"] li').textContent()).includes(
        "第 2 页"
      )
    );
    await page.reload();
    await page.locator('[aria-label="PDF 书架"] .reader-recent').click();
    await waitPdfNotes();
    check(
      "PDF shelf: reload and picker-free reopen restore page and scale",
      (await page.locator(".reader-position").textContent()).startsWith(
        "2 /"
      ) &&
        (await page
          .getByRole("button", { name: "150%", exact: true })
          .getAttribute("aria-pressed")) === "true"
    );
    const untouched = await page.evaluate(async () => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      return (await createPdfBytesStore().list())[0];
    });
    check(
      "PDF shelf: cached opens never rewrite Blob metadata",
      JSON.stringify(untouched) === JSON.stringify(cached.entry)
    );
    await page.click(".reader-pager button:first-child");
    await waitPdfNotes();
    await assertSiblingTypes(
      "PDF",
      page.locator("[data-pdf-note]").first(),
      "PDF smoke note"
    );
    await page.click(".reader-reopen");
    await page
      .getByRole("button", {
        name: `从书架删除《${cached.entry.title}》`,
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="PDF 书架"]') &&
        document.querySelectorAll('[aria-label="PDF 书架"] li').length === 0 &&
        !document.querySelector('[aria-label="最近 PDF 会话"]')
    );
    const deleted = await page.evaluate(async (docId) => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      const store = createPdfBytesStore();
      let missing = false;
      try {
        await store.get(docId);
      } catch {
        missing = true;
      }
      const positions = (
        await window.chrome.storage.local.get("pdf-positions")
      )["pdf-positions"];
      const notes = (await window.chrome.storage.local.get("pdf-notes"))[
        "pdf-notes"
      ];
      return (
        missing &&
        (await store.list()).length === 0 &&
        positions.recent === null &&
        positions.positions.some((position) => position.docId === docId) &&
        notes.notes.some((note) => note.docId === docId)
      );
    }, cached.entry.docId);
    check(
      "PDF shelf: delete commits bytes and recent removal but retains notes/position",
      deleted
    );
    await page.setInputFiles('input[type="file"]', {
      name: "renamed.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });
    await waitPdfNotes();
    check(
      "PDF notes: same bytes reattach silently after reselect",
      (await page.locator("[data-pdf-note].has-note").count()) === 1
    );
    await assertSiblingTypes(
      "PDF",
      page.locator("[data-pdf-note]").first(),
      "PDF smoke note"
    );
    await page.click(".reader-reopen");
    await page.waitForSelector('[aria-label="PDF 书架"] li');
    const beforeReplace = await page.evaluate(async () => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      return (await createPdfBytesStore().list())[0].storedAt;
    });
    await page.setInputFiles('input[type="file"]', {
      name: "same-again.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });
    await waitPdfNotes();
    await page.click(".reader-reopen");
    await page.waitForFunction(async (previous) => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      const entries = await createPdfBytesStore().list();
      return entries.length === 1 && entries[0].storedAt > previous;
    }, beforeReplace);
    check(
      "PDF shelf: reselect recreates shelf and repeated picker import refreshes one identity",
      (await page.locator('[aria-label="PDF 书架"] li').count()) === 1
    );
  };

  const scannedScenario = async () => {
    // Scanned rejection: an image-only PDF gets the 书-wording error.
    const { createRequire } = await import("node:module");
    const pdfLib = createRequire(join(repoRoot, "package.json"))("pdf-lib");
    const scanned = await pdfLib.PDFDocument.create();
    scanned
      .addPage([612, 792])
      .drawRectangle({ x: 50, y: 400, width: 500, height: 300 });
    const before = await page.evaluate(async () => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      return await createPdfBytesStore().list();
    });
    await importBook({
      name: "scan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await scanned.save()),
    });
    await page.waitForSelector(".reader-error", { timeout: 15000 });
    check(
      "PDF: scanned gets the 书-wording rejection",
      (await page.textContent(".reader-error")).includes("扫描版 PDF 不支持")
    );
    const after = await page.evaluate(async () => {
      const { createPdfBytesStore } = await import("/pdf-bytes-proof.js");
      return await createPdfBytesStore().list();
    });
    check(
      "PDF shelf: scanned rejection never commits a candidate",
      JSON.stringify(before) === JSON.stringify(after)
    );
  };

  await epubScenario();
  await pdfScenario();
  await scannedScenario();
};

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await startChromium();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  await context.addInitScript(() => {
    // Minimal chrome.storage stub: outside the extension origin chrome.*
    // is absent. KNOWN LIMIT — this masks manifest-permission gaps;
    // scripts/check-manifest-permissions.mjs is that class's gate, and
    // the load-unpacked pass is the human acceptance.
    if (location.protocol !== "http:") return;
    const storageKey = "lingualeaf-smoke-storage";
    const bag = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
    window.chrome = {
      storage: {
        local: {
          get: async (key) =>
            bag[key] !== undefined ? { [key]: structuredClone(bag[key]) } : {},
          set: async (obj) => {
            Object.assign(bag, structuredClone(obj));
            sessionStorage.setItem(storageKey, JSON.stringify(bag));
          },
        },
      },
    };
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({
        text: msg.text(),
        url: msg.location()?.url ?? "",
      });
    }
  });

  await proveNativePdfBytes(page, port);
  await runScenarios(page, port);

  // The only tolerable console error is the favicon 404 — identified by its
  // request URL being a favicon AND the error being the expected missing
  // resource, never by a bare substring (audit 2026-10-30 finding 5). Any
  // other console error fails, as does every uncaught page exception.
  const expectedFavicon404 = (e) =>
    e.url.includes("favicon") && e.text.includes("404");
  const realConsoleErrors = consoleErrors.filter((e) => !expectedFavicon404(e));
  check(
    "no console errors beyond favicon",
    realConsoleErrors.length === 0,
    realConsoleErrors.map((e) => `${e.url}: ${e.text}`).join(" | ")
  );
  check(
    "no uncaught page errors",
    pageErrors.length === 0,
    pageErrors.join(" | ")
  );
} finally {
  rmSync(proofDir, { recursive: true, force: true });
  proc?.kill("SIGKILL");
  server.close();
  // Let the SIGKILL land before deleting the profile, or a still-dying
  // Chromium can recreate files inside it. A spawn failure never exits,
  // hence the bounded wait — cleared the moment exit lands so the success
  // path never lingers (audit 2026-10-30 finding 7 residue).
  if (proc) {
    await new Promise((resolve) => {
      const fallback = setTimeout(resolve, 2000);
      proc.once("exit", () => {
        clearTimeout(fallback);
        resolve();
      });
    });
  }
  if (profileDir) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Leftover /tmp litter is not a smoke failure.
    }
  }
}

if (failures.length > 0) {
  console.error(`[smoke] FAILED: ${failures.length} — ${failures.join("; ")}`);
  process.exit(1);
}
console.log("[smoke] all checks passed");
