import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { chromium, expect } from "@playwright/test";

const profile = await mkdtemp(path.join(os.tmpdir(), "underlight-test-"));
const extension = path.resolve("extension");
const address = "http://underlight.test/article";
const colors = ["yellow", "orange", "pink", "red", "green", "blue", "black"];
const kinds = ["highlight", "underline", "note"];
let context;

async function launch() {
  const systemChrome = process.platform === "win32" && path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe");
  const executablePath = process.argv[2] || process.env.UNDERLIGHT_BROWSER || (systemChrome && existsSync(systemChrome) ? systemChrome : undefined);
  const brandedChrome = /google[\\/].*chrome\.exe$/i.test(executablePath || "");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", executablePath, headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging", ...(brandedChrome ? [] : ["--disable-extensions-except=" + extension, "--load-extension=" + extension])]
  });
  const page = context.pages()[0];
  const session = await context.newCDPSession(page);
  if (brandedChrome) {
    await page.goto("chrome://extensions/");
    const toggle = page.locator("#devMode");
    if (await toggle.getAttribute("aria-pressed") !== "true" && !await toggle.evaluate(n => n.checked)) await toggle.click();
  }
  // Branded Chrome disables --load-extension. Its testing protocol can load a local build.
  if (!context.serviceWorkers().length) {
    try {
      const browserSession = await context.browser().newBrowserCDPSession();
      const { id } = await browserSession.send("Extensions.loadUnpacked", { path: extension });
      await browserSession.detach();
      if (id) return { page, session, id };
    }
    catch (error) {
      if (!/already|duplicate/i.test(error.message) && !context.serviceWorkers().length)
        console.log("Checking extension startup:", error.message);
    }
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 12000 });
  const id = new URL(worker.url()).host;
  return { page, session, id };
}

async function fixture(page) {
  const rows = kinds.flatMap(kind => colors.map(color => '<p id="' + kind + '-' + color + '">' +
    kind + ' a <em>' + color + '</em> passage.</p>')).join("");
  await page.route("http://underlight.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Practice page</title><style>body{padding:35px;font:18px/1.5 Arial}p{width:max-content}</style><h1>Practice page</h1>" + rows
  }));
  await page.goto(address);
}

async function select(page, id) {
  const target = page.locator("#" + id);
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.press("Shift");
  await expect(page.locator("underlight-panel")).toBeAttached();
}

// Read control geometry via the debugging protocol. The production shadow root stays closed to the site.
async function control(page, session, name) {
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: "underlight-panel" });
  const { node } = await session.send("DOM.describeNode", { nodeId, depth: 1, pierce: true });
  const { object } = await session.send("DOM.resolveNode", { backendNodeId: node.shadowRoots[0].backendNodeId });
  const { result } = await session.send("Runtime.callFunctionOn", {
    objectId: object.objectId, arguments: [{ value: name }], returnByValue: true,
    functionDeclaration: `function(name) { const b = [...this.querySelectorAll("button,textarea")].find(b => (b.getAttribute("aria-label") || b.textContent) === name);
      if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width/2,r.y + r.height/2]; }`
  });
  assert.ok(result.value, "Missing control " + name);
  await page.mouse.click(...result.value);
}

try {
  let { page, session, id } = await launch();
  await fixture(page);
  const lib = await context.newPage();
  await lib.goto("chrome-extension://" + id + "/library.html");
  await expect(lib.getByText("Save your first passage")).toBeVisible();
  for (const kind of kinds) {
    for (const color of colors) {
      if (kind === "highlight" && color === "yellow") {
        const box = await page.locator("#highlight-yellow").boundingBox();
        await page.mouse.move(box.x, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
        await expect(page.locator("underlight-panel")).toBeAttached();
      } else {
        await select(page, kind + "-" + color);
      }
      await control(page, session, color);
      await control(page, session, kind[0].toUpperCase() + kind.slice(1));
      if (kind === "note") {
        await page.keyboard.insertText("Remember " + color);
        await control(page, session, "Save");
      }
      await expect(page.locator("underlight-panel")).toHaveCount(0);
    }
  }
  await expect(lib.locator("article")).toHaveCount(21);
  await lib.getByRole("button", { name: "Notes", exact: true }).click();
  await lib.getByLabel("Filter by color").selectOption("black");
  await expect(lib.locator("article")).toHaveCount(1);
  await lib.getByRole("button", { name: "Edit note" }).click();
  await lib.getByLabel("Note text").fill("Edited locally");
  await lib.getByRole("button", { name: "Save", exact: true }).click();
  await lib.getByLabel("Search annotations").fill("edited locally");
  await expect(lib.locator("article")).toHaveCount(1);
  await lib.getByLabel("Search annotations").fill("unrelated");
  await expect(lib.getByText("No matching annotations")).toBeVisible();

  await context.close();
  ({ page, session, id } = await launch());
  await fixture(page);
  const second = await context.newPage();
  await second.goto("chrome-extension://" + id + "/library.html");
  await expect(second.locator("article")).toHaveCount(21);
  // Change node identities and shift all offsets, as a rerendered article might.
  await page.evaluate(() => {
    document.body.innerHTML = "<p>New introduction.</p>" + document.body.innerHTML;
  });
  await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBe(21);
  const passage = page.locator("#note-black em");
  await expect(async () => {
    await passage.click();
    await expect(page.locator("underlight-panel")).toBeAttached({ timeout: 500 });
  }).toPass({ timeout: 4000 });
  await control(page, session, "Note text");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("Reattached on the page");
  await control(page, session, "Save");
  await expect(second.getByText("Reattached on the page")).toBeVisible();
  await page.evaluate(() => history.pushState({}, "", "/other"));
  await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBe(0);
  await page.evaluate(() => history.back());
  await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBe(21);
  await page.locator("#note-black").evaluate(n => n.remove());
  await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBe(20);
  await expect(second.locator("article")).toHaveCount(21);
  second.once("dialog", dialog => dialog.accept());
  await second.locator("article").filter({ hasText:"Reattached on the page" }).getByText("Delete").click();
  await expect(second.locator("article")).toHaveCount(20);
  console.log("PASS: all 21 type/color combinations, library search, edit/delete, browser restart, DOM changes, missing quotes and URL navigation.");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
}
