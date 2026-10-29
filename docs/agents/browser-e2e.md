# Browser E2E: real-browser verification and live-DB diagnosis

For flows no supertest seam reaches — progress UI, restart recovery, anything
an acceptance dispute hinges on — drive the real built app in a real browser
instead of arguing from code. The recipe below settled ticket 08's 「页面上
没有任何提示」 report in one run. (HTTP-level checks without a browser are
`docs/agents/local-e2e.md`'s lane.)

## Setup

Playwright's browsers are usually cached at
`~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` (installed by other
projects). The driver package is tiny and downloads nothing:

```bash
mkdir -p /tmp/pw-repro && cd /tmp/pw-repro
npm init -y && npm i playwright-core
```

If no cached chromium exists, `npx playwright install chromium` fetches one.

## Recipe

1. **Free the port first.** An orphaned server from an earlier run silently
   holds the port: the new server dies with EADDRINUSE, the old one answers,
   and the whole run tests nothing. This bit tickets 04 and 08.

   ```bash
   fuser -k 3789/tcp; sleep 1
   ```

2. **Build and start the production app** on a scratch port and a scratch
   database (keep the user's `.data` out of it):

   ```bash
   npm run build
   PORT=3789 DATABASE_PATH=/tmp/pw-e2e/books.sqlite \
     nohup node .output/server/main.js > /tmp/pw-e2e/server.log 2>&1 &
   ```

3. **Drive the page** with `executablePath` pointed at the cached chromium:
   `setInputFiles` for uploads, `getByRole(...).click()` for actions, and
   assert on the _content region_ (`locator(".book-list")`), never on a
   button label that changes the instant it is clicked. Screenshots are the
   evidence to paste into the ticket.

4. **Kill by PID, not by faith**, and re-check the port when a scenario
   restarts the server mid-run.

## Live-DB diagnosis

When a user report and the code disagree, read what the server actually
stored — read-only, safe next to a running server (WAL):

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('.data/lingualeaf.sqlite', { readonly: true });
console.log(db.prepare('SELECT id, title, status, import_error FROM books ORDER BY id DESC LIMIT 6').all());
db.close();
"
```

Ticket 08's report dissolved once the row showed a book parked at
`importing / 0%` with nothing listening on the port: the server was down,
not the feature broken.

## Extension (MV3) smoke

The extension has a committed harness — `npm run smoke
--workspace @lingualeaf/extension` — so no session reinvents it:

- **It builds first.** Every stale-dist bug (source changed, old bundle
  smoked, silent nonsense) dies at this step. Never smoke a dist you did
  not just build.
- **Serve `dist/` over loopback**: module CORS blocks `file://`, and the
  MIME table must carry `.mjs` (pdf.js's worker loads as a module script).
- **Self-spawn the cached Chromium over CDP** (`--headless=new
--remote-debugging-port`, `--no-proxy-server`) when the playwright
  registry mismatches the cached browser. Free the DevTools port before
  spawning — an orphaned Chromium from a killed run holds it, the new one
  binds nothing, and every readiness probe answers the ORPHAN (invariant 1
  above, extension flavor).
- **Assert geometry, not existence** (CODING_STANDARDS, "Smoke assertions
  pin the claimed property"): overlay words must land inside the canvas
  rect, chips below their word's font band, computed `color`/`userSelect`
  exact.
- **Known limits**: the script's chrome.storage stub masks
  manifest-permission gaps — `apps/extension/scripts/
check-manifest-permissions.mjs` (wired into `verify`) is that class's
  gate, and load-unpacked stays the human acceptance. Hover/selection
  pixels likewise.
