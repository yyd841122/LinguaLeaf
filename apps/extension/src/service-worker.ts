// The extension's service worker holds no state (spec: 仅入口事件) — it
// routes entry events to the reader page and nothing else. The reader page
// owns every behavior past the opening.
const READER_PATH = "reader.html";

// One reader tab: focusing the existing one keeps 随手阅读 frictionless —
// a second tab would fork the reader's own state (storage seam tickets).
async function openReader(windowId?: number): Promise<void> {
  const pattern = chrome.runtime.getURL(READER_PATH);
  const tabs = await chrome.tabs.query({ url: pattern });
  const existing = tabs[0];
  if (existing && existing.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({
    url: pattern,
    ...(windowId === undefined ? null : { windowId }),
  });
}

chrome.action.onClicked.addListener((tab) => {
  void openReader(tab.windowId);
});

// The context-menu entry (ticket 05): a right-click anywhere offers the
// same one-step entry. Recreated on install/update; the id is stable so
// re-runs replace, not duplicate.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-reader",
    title: "用 LinguaLeaf 打开",
    contexts: ["page", "selection", "link", "video", "audio"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void openReader(tab?.windowId);
});
