// The worked example: reading-bookmarks 04's browser acceptance, replayed
// as a regression pin. Nine assertions, straight from the 04 ticket's
// acceptance record — the sticky bar, the deep in-place mark, the three
// landing channels under scroll-padding, and the popup-over-bar layering:
//
//   1  deep-scroll stimulus: block 32's top edge lands on the viewport top
//   2  the bar is pinned at the viewport top (position: sticky)
//   3  the 打书签 button rides in the stuck bar — reachable at any depth
//   4  the in-place click is viewport-clean: scrollY unchanged across it
//   5  the panel entry reads the deep block's own prefix (032, not the
//      chapter start)
//   6  bookmark jump: the target lands just below the bar with clearance
//   7  reload auto-restore lands at the same spot
//   8  回到第一章 lands below the bar the same way
//   9  the lookup popup layers over the stuck bar (z 20 vs 5)
//
// Run: npm run browser-e2e (manual, per acceptance — deliberately outside
// the commit/verify gates; ticket browser-e2e-harness).
import {
  clickWithoutScroll,
  runBrowserE2E,
  scrollBlockIntoView,
  scrollBlockToViewportTop,
  waitForScrollSettle,
} from "./harness.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";

const DEEP_BLOCK = 32;
const DEEP_PREFIX_ENTRY = "Chapter One · Sentence 032 of chap…";

// Poll from the driver side (page.evaluate takes the position as its arg —
// waitForFunction's second argument is the page function's argument, the
// exact shape the repo's lint rule exists for, so this loop avoids it).
async function blockTop(page, position) {
  return page.evaluate(
    (position) =>
      document
        .querySelector(`.blocks [data-position="${position}"]`)
        ?.getBoundingClientRect().top ?? null,
    position
  );
}

async function waitForBlockTopNear(
  page,
  position,
  expected,
  tolerance,
  timeoutMs = 10_000
) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await blockTop(page, position);
    if (last !== null && Math.abs(last - expected) <= tolerance) return last;
    await sleep(100);
  }
  throw new Error(
    `block ${position} never landed near ${expected}px (last: ${last}px)`
  );
}

const barRect = (page) =>
  page.evaluate(() => {
    const rect = document.querySelector(".reading-top").getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });

const landingOk = (top, barBottom) => ({
  ok: top - barBottom >= 4 && top <= barBottom + 12,
  margin: top - barBottom,
});

await runBrowserE2E({
  name: "reading-bookmarks-04",
  async scenario({ page, baseUrl, runDir, fixturePath, check }) {
    // ---- Import the fixture book through the shelf UI. --------------------
    await page.goto(`${baseUrl}/`);
    await page.waitForSelector('input[type="file"]');
    await page.setInputFiles('input[type="file"]', fixturePath);
    await clickWithoutScroll(
      page.getByRole("button", { name: "导入", exact: true }),
      {
        label: "导入",
      }
    );
    // Only a ready book carries a /book/ link; an importing row has none.
    const bookLink = page.locator('a[href^="/book/"]').first();
    await bookLink.waitFor({ state: "visible", timeout: 30_000 });
    const href = await bookLink.getAttribute("href");
    const bookId = Number(/^\/book\/(\d+)\//.exec(href)[1]);
    await page.goto(`${baseUrl}${href}`);
    await page.waitForSelector(`.blocks [data-position="1"]`);
    check(
      "fixture book imports and opens (two chapters, ready)",
      true,
      `book ${bookId} → ${href}`
    );

    // ---- 1: the deep-scroll stimulus itself is viewport-exact. -----------
    const blockTopLanded = await scrollBlockToViewportTop(page, DEEP_BLOCK);
    check(
      "1 deep scroll: block 32 top edge at the viewport top",
      Math.abs(blockTopLanded) <= 0.75,
      `landed ${blockTopLanded}px`
    );

    // ---- 2: the bar is pinned. --------------------------------------------
    const stuck = await barRect(page);
    check(
      "2 sticky bar pinned at viewport top",
      Math.abs(stuck.top) <= 0.75,
      `bar top ${stuck.top}px, bottom ${stuck.bottom}px`
    );

    // ---- 3: the mark button rides in the stuck bar. -----------------------
    const buttonTop = await page
      .getByRole("button", { name: "打书签" })
      .evaluate((el) => el.getBoundingClientRect().top);
    check(
      "3 打书签 reachable in the stuck bar",
      buttonTop >= 0 && buttonTop <= 10,
      `button top ${buttonTop}px`
    );

    // ---- 4: the in-place click is viewport-clean (the 04 core). ----------
    const clickScroll = await clickWithoutScroll(
      page.getByRole("button", { name: "打书签" }),
      { label: "打书签" }
    );
    check(
      "4 in-place click: scrollY unchanged across the click",
      true,
      `scrollY=${clickScroll.before} held`
    );

    // ---- 5: the panel entry reads the deep block, not the chapter start. -
    await clickWithoutScroll(page.getByRole("button", { name: "目录" }), {
      label: "目录",
    });
    const entry = page.locator(".bookmark-entry").first();
    await entry.waitFor({ state: "visible", timeout: 10_000 });
    const entryText = (await entry.textContent()).trim();
    check(
      "5 panel prefix shows the deep mark (Sentence 032, not the chapter start)",
      entryText === DEEP_PREFIX_ENTRY,
      `entry "${entryText}"`
    );
    await page.screenshot({ path: join(runDir, "04-deep-mark.png") });

    // ---- 6: bookmark jump lands just below the bar. ----------------------
    // The reader's 起跳点: block 45 in view (near the chapter end it cannot
    // reach the viewport top — the scroll clamps; in-view is the stimulus).
    await scrollBlockIntoView(page, 45);
    const jumpScroll = await clickWithoutScroll(entry, {
      label: "bookmark entry (jump)",
      handlerMayScroll: true,
    });
    const scrollPadding = await page.evaluate(() =>
      parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop || "0"
      )
    );
    const jumpLanding = await waitForBlockTopNear(
      page,
      DEEP_BLOCK,
      scrollPadding,
      6
    );
    const jumpBar = await barRect(page);
    const jumpClearance = landingOk(jumpLanding, jumpBar.bottom);
    check(
      "6 bookmark jump: block 32 lands below the bar with clearance",
      jumpClearance.ok,
      `jump scrollY ${jumpScroll.before} → ${jumpScroll.after}, top ${jumpLanding}px, bar bottom ${jumpBar.bottom}px, margin ${jumpClearance.margin}px`
    );
    await page.screenshot({ path: join(runDir, "04-jump-landing.png") });

    // ---- 7: reload auto-restore lands at the same spot. ------------------
    // Wait until the jump's own save (debounced 500ms) is the stored
    // progress, so the reload restores the landing, not the stimulus.
    const progressDeadline = Date.now() + 10_000;
    let progress = null;
    while (Date.now() < progressDeadline) {
      progress = await fetch(`${baseUrl}/api/books/${bookId}/progress`)
        .then((response) => response.json())
        .catch(() => null);
      if (progress && progress.chapter === 1 && progress.block === DEEP_BLOCK)
        break;
      await sleep(200);
    }
    check(
      "7a jump landing saved as progress (1·32)",
      Boolean(
        progress && progress.chapter === 1 && progress.block === DEEP_BLOCK
      ),
      JSON.stringify(progress)
    );
    await page.reload();
    await page.waitForSelector(`.blocks [data-position="${DEEP_BLOCK}"]`);
    const restoreLanding = await waitForBlockTopNear(
      page,
      DEEP_BLOCK,
      jumpLanding,
      2
    );
    check(
      "7 reload auto-restore lands at the same spot",
      Math.abs(restoreLanding - jumpLanding) <= 2,
      `restored ${restoreLanding}px vs jumped ${jumpLanding}px`
    );

    // ---- 8: 回到第一章 lands below the bar the same way. ------------------
    await clickWithoutScroll(page.getByRole("button", { name: "目录" }), {
      label: "目录",
    });
    await clickWithoutScroll(page.locator(".bookmark-first"), {
      label: "回到第一章",
      handlerMayScroll: true,
    });
    const firstLanding = await waitForBlockTopNear(page, 1, scrollPadding, 6);
    const restartBar = await barRect(page);
    const restartClearance = landingOk(firstLanding, restartBar.bottom);
    check(
      "8 回到第一章: block 1 lands below the bar with clearance",
      restartClearance.ok,
      `top ${firstLanding}px, bar bottom ${restartBar.bottom}px, margin ${restartClearance.margin}px`
    );
    // The jump's scroll events deliver on the next animation frame; let
    // them settle before the popup stimulus, or the popup's scroll-dismiss
    // catches the jump's own late event and the popup mounts and unmounts
    // between polls.
    await waitForScrollSettle(page);

    // ---- 9: the lookup popup layers over the stuck bar. ------------------
    await clickWithoutScroll(page.locator('[data-word="chapter"]').first(), {
      label: "word 「chapter」",
      point: { x: 300, y: 300 },
    });
    await page.waitForSelector(".lookup-popup", { state: "visible" });
    const zIndex = await page.evaluate(() => ({
      popup: getComputedStyle(document.querySelector(".lookup-popup")).zIndex,
      bar: getComputedStyle(document.querySelector(".reading-top")).zIndex,
    }));
    check(
      "9 lookup popup layers over the stuck bar (z 20 vs 5)",
      zIndex.popup === "20" &&
        zIndex.bar === "5" &&
        Number(zIndex.popup) > Number(zIndex.bar),
      `popup z=${zIndex.popup}, bar z=${zIndex.bar}`
    );
    await page.screenshot({ path: join(runDir, "04-popup-over-bar.png") });
    await page.keyboard.press("Escape");
  },
});
