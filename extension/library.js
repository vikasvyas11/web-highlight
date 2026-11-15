const { colors, element, key } = Underlight;
const $ = id => document.getElementById(id);
const labels = { all: "All annotations", highlight: "Highlights", underline: "Underlines", note: "Notes" };
let records = [], kind = "all", editing, sequence = 0;
for (const name of Object.keys(colors)) $("color").add(new Option(name[0].toUpperCase() + name.slice(1), name));
for (const [value, label] of Object.entries(labels)) {
  const tab = element("button", label);
  tab.onclick = () => { kind = value; render(); };
  tab.dataset.kind = value;
  $("kinds").append(tab);
}

function edit(item) {
  editing = item;
  $("body").value = item.note;
  $("edit-error").textContent = "";
  $("edit").showModal();
  $("body").focus();
}
$("cancel").onclick = () => $("edit").close();
$("edit").querySelector("form").onsubmit = async event => {
  event.preventDefault();
  const note = $("body").value.trim();
  if (!note) { $("edit-error").textContent = "Write a note before saving."; return; }
  try {
    const id = key(editing);
    const current = (await chrome.storage.local.get(id))[id];
    if (!current) { $("edit").close(); return; }
    await chrome.storage.local.set({ [id]: { ...current, note } });
    $("edit").close();
  } catch (e) { $("edit-error").textContent = e.message; }
};

function card(item) {
  const row = element("article");
  row.style.setProperty("--color", colors[item.color]);
  const meta = element("div", undefined, "meta");
  const date = new Date(item.created);
  const time = element("time", date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
  time.dateTime = date.toISOString();
  meta.append(element("i", undefined, "dot"), element("span", item.color + " " + item.kind), time);
  row.append(meta, element("blockquote", item.anchor.exact));
  const actions = element("div", undefined, "actions");
  if (item.kind === "note") {
    row.append(element("p", item.note, "note"));
    const button = element("button", "Edit note");
    button.onclick = () => edit(item);
    actions.append(button);
  }
  const remove = element("button", "Delete");
  remove.onclick = async () => {
    if (!window.confirm("Delete this annotation from Underlight?")) return;
    try { await chrome.storage.local.remove(key(item)); }
    catch (e) { $("error").textContent = e.message; }
  };
  actions.append(remove);
  row.append(actions);
  return row;
}

function render() {
  for (const tab of $("kinds").children) tab.setAttribute("aria-pressed", String(tab.dataset.kind === kind));
  const query = $("search").value.trim().toLowerCase(), color = $("color").value;
  const matches = records.filter(item =>
    (kind === "all" || item.kind === kind) && (!color || item.color === color) &&
    [item.title, item.url, item.anchor.exact, item.note].some(s => s?.toLowerCase().includes(query))
  );
  const groups = Map.groupBy(matches, item => item.url);
  const filtered = kind !== "all" || color || query;
  const count = matches.length, pages = groups.size;
  $("summary").textContent = count + (filtered ? " matching annotation" : " saved annotation") + (count === 1 ? "" : "s") +
    " across " + pages + (pages === 1 ? " page" : " pages");
  const result = document.createDocumentFragment();
  if (!count) {
    const empty = element("div", undefined, "empty");
    const icon = element("img"); icon.src = "icons/48.png"; icon.alt = "";
    empty.append(icon, element("h2", filtered ? "No matching annotations" : "Save your first passage"),
      element("p", filtered ? "Try another search or filter." : "Select text on a webpage, then choose Highlight, Underline, or Note."));
    result.append(empty);
  }
  for (const [url, items] of groups) {
    const group = element("section", undefined, "page");
    const heading = element("h2");
    const link = element("a", items[0].title);
    if (/^https?:\/\//i.test(url)) { link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
    heading.append(link);
    group.append(heading, element("p", url, "address"));
    for (const item of items) group.append(card(item));
    result.append(group);
  }
  $("results").replaceChildren(result);
}
async function refresh() {
  const version = ++sequence;
  try {
    const data = await chrome.storage.local.get(null);
    if (version !== sequence) return;
    records = Object.entries(data).filter(([id]) => id.startsWith("annotation:")).map(([,v]) => v).sort((a,b) => b.created - a.created);
    render();
  } catch (e) { $("error").textContent = "Could not load the library. " + e.message; }
}
$("search").oninput = render;
$("color").onchange = render;
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local") refresh(); });
refresh();
