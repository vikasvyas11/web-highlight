(() => {
  const { colors, pageUrl, key, loadPage, element } = Underlight;
  const anchors = UnderlightAnchors;
  if (!document.body || document.contentType !== "text/html" && document.contentType !== "application/xhtml+xml") return;
  let url = pageUrl(location.href), color = "yellow", items = [], ranges = new Map();
  let generation = 0, repaintTimer, host, root, panel, draft, newDraft, mode, activeRect, busy = false;

  function close() {
    host?.remove();
    host = panel = root = draft = activeRect = mode = null;
  }

  function paint() {
    clearTimeout(repaintTimer);
    repaintTimer = null;
    const groups = new Map();
    ranges = new Map();
    if (items.length && document.body) {
      const idx = anchors.index();
      for (const item of items) {
        const range = anchors.resolve(item.anchor, idx);
        if (!range) continue;
        ranges.set(item.id, range);
        const name = "underlight-" + item.kind + "-" + item.color;
        if (!groups.has(name)) groups.set(name, new Highlight());
        groups.get(name).add(range);
      }
    }
    for (const kind of ["highlight", "underline", "note"]) {
      for (const name of Object.keys(colors)) {
        const id = "underlight-" + kind + "-" + name;
        if (groups.has(id)) CSS.highlights.set(id, groups.get(id));
        else CSS.highlights.delete(id);
      }
    }
  }

  async function refresh() {
    const version = ++generation;
    try {
      const result = await loadPage(url);
      if (version !== generation) return;
      items = result;
      paint();
    } catch (error) {
      console.warn("Underlight could not load this page's annotations.", error.message);
    }
  }
  function navigate() {
    const next = pageUrl(location.href);
    if (url === next) return;
    url = next;
    close();
    items = [];
    paint();
    refresh();
  }
  window.navigation?.addEventListener("currententrychange", navigate);
  window.addEventListener("pageshow", () => { navigate(); refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (draft && !newDraft && changes[key(draft)] && !busy) close();
    if (Object.keys(changes).some(k => k.startsWith(Underlight.prefix(url)))) refresh();
  });
  new MutationObserver(changes => {
    if (!items.length || repaintTimer) return;
    if (changes.every(c => c.type === "childList" && [...c.addedNodes, ...c.removedNodes].every(n => n.localName === "underlight-panel"))) return;
    repaintTimer = setTimeout(() => { repaintTimer = null; paint(); }, 180);
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  refresh();

  const styles = `
    :host { color-scheme: light; }
    * { box-sizing: border-box; }
    .panel { background: #fffef8; color: #25251f; border: 1px solid #b9b8ad; border-radius: 12px;
      box-shadow: 0 6px 28px #28251c30; padding: 10px; width: max-content; max-width: min(330px, calc(100vw - 16px));
      max-height: calc(100vh - 16px); overflow: auto; font: 14px/1.4 system-ui,sans-serif; text-align: left; }
    .row,.palette { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
    .palette { border-bottom:1px solid #e7e6db; padding: 2px 2px 9px; margin-bottom:7px; gap:6px; }
    button { font: 600 12px/1.3 system-ui,sans-serif; cursor:pointer; background:transparent; color:#25251f;
      padding:7px 8px; border:0; border-radius:5px; }
    button:hover { background:#edeee4; } button:focus-visible,textarea:focus-visible {outline:2px solid #6050bd;outline-offset:1px;}
    .palette button { width:22px;height:22px;background:var(--swatch);border:1px solid #0002;border-radius:50%;padding:0;}
    .palette [aria-pressed=true] { outline:2px solid #302f29;outline-offset:2px; }
    header { display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-weight:700; }
    textarea { width:min(272px,100%); min-width:210px; height:76px; display:block; font:14px/1.45 system-ui,sans-serif;
      padding:8px;resize:vertical;background:white;color:#24241e;border:1px solid #bbb9ac;border-radius:6px;margin:7px 0; }
    .primary { background:#303329;color:#fff; } .primary:hover { background:#494e3d; }
    .error {max-width:260px;color:#93352c;} .error:empty {display:none;}
  `;

  function place() {
    if (!host || !activeRect) return;
    const { width, height } = panel.getBoundingClientRect();
    const x = Math.max(8, Math.min(activeRect.left, innerWidth - width - 8));
    const y = activeRect.bottom + height + 16 <= innerHeight ? activeRect.bottom + 8 : Math.max(8, activeRect.top - height - 8);
    host.style.setProperty("left", x + "px", "important");
    host.style.setProperty("top", y + "px", "important");
  }

  function show(rect) {
    host?.remove();
    activeRect = rect;
    host = document.createElement("underlight-panel");
    host.style.cssText = "all:initial!important;position:fixed!important;display:block!important;z-index:2147483647!important;direction:ltr!important;";
    root = host.attachShadow({ mode: "closed" });
    panel = element("section", undefined, "panel");
    panel.setAttribute("aria-label", "Underlight annotation");
    const style = element("style", styles);
    root.append(style, panel);
    document.documentElement.append(host);
  }

  function button(label, onClick, parent, className) {
    const b = element("button", label, className);
    b.type = "button";
    b.addEventListener("click", onClick);
    parent.append(b);
    return b;
  }

  function palette() {
    const row = element("div", undefined, "palette");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Annotation color");
    panel.append(row);
    for (const [name, hex] of Object.entries(colors)) {
      const swatch = button("", () => {
        color = name;
        for (const other of row.children) other.setAttribute("aria-pressed", String(other === swatch));
      }, row);
      swatch.title = name;
      swatch.setAttribute("aria-label", name);
      swatch.setAttribute("aria-pressed", String(color === name));
      swatch.style.setProperty("--swatch", hex);
    }
  }

  function selectionRange() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || document.activeElement?.matches("input,textarea,[contenteditable=true]")) return null;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    if ((container.parentElement?.closest(anchors.excluded)) || container.getRootNode() !== document) return null;
    return range;
  }

  function selectionMenu(range) {
    if (!range || !range.toString().trim()) return close();
    const anchor = anchors.capture(range, anchors.index());
    if (!anchor) return close();
    const rect = range.getBoundingClientRect();
    show(rect);
    draft = { id: crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint32Array(4))].join("-"),
      url, title: document.title || location.hostname, anchor, created: Date.now() };
    mode = "select";
    newDraft = true;
    palette();
    const row = element("div", undefined, "row");
    panel.append(row);
    button("Highlight", () => commit("highlight"), row);
    button("Underline", () => commit("underline"), row);
    button("Note", () => editor("note"), row);
    panel.append(element("div", "", "error"));
    place();
  }

  function editor(kind) {
    mode = "edit";
    panel.replaceChildren();
    const header = element("header", kind === "note" ? "Page note" : kind === "highlight" ? "Highlight" : "Underline");
    panel.append(header);
    button("Close", close, header);
    palette();
    let field;
    if (kind === "note") {
      field = element("textarea");
      field.setAttribute("aria-label", "Note text");
      field.placeholder = "Write a note…";
      field.value = draft.note || "";
      panel.append(field);
    }
    const row = element("div", undefined, "row");
    panel.append(row);
    button("Save", () => commit(kind, field?.value.trim()), row, "primary");
    if (!newDraft) button("Delete", () => commit("delete"), row);
    panel.append(element("div", "", "error"));
    place();
    field?.focus({ preventScroll: true });
  }

  async function commit(kind, note = "") {
    if (busy || !draft || draft.url !== pageUrl(location.href)) return;
    const message = panel.querySelector(".error");
    message.setAttribute("role", "alert");
    if (kind === "note" && !note) { message.textContent = "Write a note before saving."; return; }
    const current = draft;
    busy = true;
    try {
      if (kind === "delete") await chrome.storage.local.remove(key(current));
      else await chrome.storage.local.set({ [key(current)]: { ...current, kind, color, note } });
      if (draft === current) { close(); window.getSelection()?.removeAllRanges(); }
    } catch (error) {
      message.textContent = "Could not save this change. " + error.message;
    } finally { busy = false; }
  }

  document.addEventListener("pointerdown", event => {
    if (event.target !== host && !busy && host) close();
  }, true);
  document.addEventListener("pointerup", event => {
    if (!event.isTrusted || event.target === host || event.button !== 0) return;
    const range = selectionRange();
    if (range) selectionMenu(range);
  });
  document.addEventListener("keyup", event => {
    if (!event.isTrusted || event.target === host) return;
    if (event.key === "Shift" || (event.ctrlKey && event.key === "a")) {
      selectionMenu(selectionRange());
      if (host) panel.querySelector(".row button")?.focus({ preventScroll: true });
    }
  });
  window.addEventListener("keydown", event => { if (event.key === "Escape" && !busy) close(); }, true);
  window.addEventListener("scroll", () => { if (mode === "select") close(); }, true);
  window.addEventListener("resize", place);
  document.addEventListener("click", event => {
    if (!event.isTrusted || event.target === host || event.ctrlKey || event.metaKey || selectionRange()) return;
    for (const item of [...items].sort((a,b) => Number(b.kind === "note") - Number(a.kind === "note") || b.created - a.created)) {
      const range = ranges.get(item.id);
      if (!range) continue;
      const rect = [...range.getClientRects()].find(r => r.left <= event.clientX && event.clientX < r.right && r.top <= event.clientY && event.clientY < r.bottom);
      if (!rect) continue;
      event.preventDefault();
      show(rect);
      draft = item;
      newDraft = false;
      color = item.color;
      editor(item.kind);
      break;
    }
  }, true);
  chrome.runtime.onMessage.addListener(({ action }) => {
    if (!["highlight", "underline", "note"].includes(action)) return;
    selectionMenu(selectionRange());
    if (mode !== "select") return;
    if (action === "note") editor("note"); else commit(action);
  });
})();
