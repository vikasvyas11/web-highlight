chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled.addListener(() => {
  for (const [id, title] of Object.entries({
    highlight: "Highlight selection", underline: "Underline selection", note: "Add a note"
  })) {
    chrome.contextMenus.create({ id, title, contexts: ["selection"], documentUrlPatterns: ["http://*/*", "https://*/*"] });
  }
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.frameId && tab?.id) chrome.tabs.sendMessage(tab.id, { action: info.menuItemId }, { frameId: 0 }).catch(() => {});
});
