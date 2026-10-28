// The extension's service worker holds no state (spec: 仅入口事件) — it
// routes entry events to the reader page and nothing else. The reader page
// owns every behavior past the opening.
const READER_PATH = "reader.html";

// One reader tab: focusing the existing one keeps 随手阅读 frictionless —
// a second tab would fork the reader's own state (tickets 04/05).
async function openReader(): Promise<void> {
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
  await chrome.tabs.create({ url: pattern });
}

chrome.action.onClicked.addListener(() => {
  void openReader();
});
