const Underlight = (() => {
  const colors = {
    yellow: "#f6dc66", orange: "#ffa760", pink: "#f59bc9", red: "#f67d79",
    green: "#91d399", blue: "#8abaf7", black: "#262626"
  };

  function pageUrl(address) {
    const url = new URL(address);
    url.username = "";
    url.password = "";
    if (!/^#!?\//.test(url.hash)) url.hash = "";
    return url.href;
  }

  const prefix = url => "annotation:" + encodeURIComponent(url) + ":";
  const key = item => prefix(item.url) + item.id;

  async function loadPage(url) {
    const keys = (await chrome.storage.local.getKeys()).filter(k => k.startsWith(prefix(url)));
    return Object.values(await chrome.storage.local.get(keys));
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  return { colors, pageUrl, prefix, key, loadPage, element };
})();
