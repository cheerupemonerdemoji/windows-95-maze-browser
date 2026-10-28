// Appearance tab checks in a real Chrome or Edge over the DevTools protocol (dev and CI tool): theme switching, the built-in
// Backrooms-inspired assets (lazy and sub-path safe), custom uploads and their rejection, local storage, privacy (no upload
// requests, no file names anywhere), WebGL context loss, resource leaks over 100 switches, keyboard and screen-reader
// semantics, and measured costs. Synthetic images are generated in the page; no user image is ever read or committed.
//   npm run smoke:appearance
// GLMAZE_SERVE_DIR / GLMAZE_BASE_PATH / GLMAZE_BASE_URL test the packaged build under a sub-path or the published site.
// APPEARANCE_REPORT=<file> writes the measurements as JSON.
import { writeFileSync } from "node:fs";
import { startHarness, wait } from "./harness.mjs";

const harness = await startHarness({ browserArgs: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const { page, baseUrl } = harness;
const results = [];
const measurements = {};
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const $ = (id) => `document.getElementById('${id}')`;
const origin = new URL(baseUrl).origin;

// Count live WebGL textures at the API level (created minus deleted) before any page script runs.
const COUNTER = `(() => { const c = { created: 0, deleted: 0 }; window.__tex = c; const p = WebGL2RenderingContext.prototype; const a = p.createTexture, d = p.deleteTexture; p.createTexture = function () { c.created += 1; return a.apply(this, arguments); }; p.deleteTexture = function (t) { if (t) c.deleted += 1; return d.apply(this, arguments); }; })();`;

async function load(query) {
  await page.send("Page.navigate", { url: `${baseUrl}?${query}` });
  await wait(1500);
}
async function status() { return page.evaluate(`${$("appearanceStatus")}.textContent`); }
async function waitStatus(pattern, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const text = await status();
    if (new RegExp(pattern, "i").test(text)) return text;
    await wait(60);
  }
  return `TIMEOUT waiting for /${pattern}/, last status: ${await status()}`;
}

// ---- synthetic images (deterministic, generated in the page) ----
const SYNTH = `
  window.__synth = async (kind, name, color, size) => {
    const w = size?.[0] ?? 256, h = size?.[1] ?? 256;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w / 8, h / 8);
    const type = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[kind];
    const blob = await new Promise((r) => canvas.toBlob(r, type, 1));
    return new File([blob], name, { type });
  };
  window.__give = (id, file) => { const input = document.getElementById(id); const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
  window.__switch = (id) => new Promise((resolve) => {
    const status = document.getElementById('appearanceStatus');
    const t0 = performance.now();
    const before = status.textContent;
    const done = () => { observer.disconnect(); resolve(performance.now() - t0); };
    const observer = new MutationObserver(() => { if (!/Loading|Reading/.test(status.textContent)) done(); });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    document.getElementById(id).click();
    setTimeout(() => { if (status.textContent === before) done(); }, 400);
  });
  window.__exportRun = async () => {
    const original = URL.createObjectURL; let captured = null;
    URL.createObjectURL = (blob) => { captured = blob; return original.call(URL, blob); };
    document.getElementById('exportRun').click();
    await new Promise((r) => setTimeout(r, 50));
    URL.createObjectURL = original;
    return captured ? await captured.text() : null;
  };
`;

// Mean colour of a region of the canvas, read from a real screenshot (the drawing buffer is not readable after presentation).
async function regionColour(fx0, fy0, fx1, fy1) {
  await page.evaluate("window.scrollTo(0, 0)");
  await wait(80);
  const rect = await page.evaluate(`(() => { const b = ${$("webglCanvas")}.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`); // page coordinates: the page may be scrolled
  const clip = { x: rect.x + rect.width * fx0, y: rect.y + rect.height * fy0, width: rect.width * (fx1 - fx0), height: rect.height * (fy1 - fy0), scale: 0.25 };
  const shot = (await page.send("Page.captureScreenshot", { format: "png", clip })).data;
  return page.evaluate(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${shot}'; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0, red = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1; if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) red += 1; } return { r: r / n, g: g / n, b: b / n, redShare: red / n }; })()`);
}
const dominant = (c, k) => c[k] > Math.max(...["r", "g", "b"].filter((x) => x !== k).map((x) => c[x])) + 25;

async function growWalls() {
  await page.evaluate(`(() => { const b = ${$("step")}; for (let i = 0; i < 70; i += 1) b.click(); })()`);
  await wait(300);
}

async function stateFingerprint() {
  const text = await page.evaluate("window.__exportRun()");
  const report = JSON.parse(text);
  return JSON.stringify({ seed: report.seed, maze: report.maze, walker: report.walker, run: report.run, simulation: report.simulation, validation: report.validation });
}

try {
  await page.send("Network.enable");
  await page.send("HeapProfiler.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: COUNTER });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

  // ===== 1-2. Classic is the default and downloads nothing extra =====
  await load("seed=2017&rng=microsoft&reduced=0&quality=standard");
  await page.evaluate(SYNTH);
  const requestsAfterLoad = page.events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => e.params.request.url);
  check("Classic is the default theme", await page.evaluate(`${$("themeClassic")}.checked && !${$("themeBackrooms")}.checked && !${$("themeCustom")}.checked`));
  check("Classic users download no theme image before choosing one", requestsAfterLoad.every((u) => !/assets\/themes/.test(u)), requestsAfterLoad.filter((u) => /assets/.test(u)).join(","));

  // ===== 15. semantics: tabs, labels, status, keyboard =====
  const semantics = await page.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[role=tab]')];
    const list = document.querySelector('[role=tablist]');
    const panelIds = tabs.map((t) => t.getAttribute('aria-controls'));
    const panels = panelIds.map((id) => document.getElementById(id));
    return {
      listLabel: list.getAttribute('aria-label'), tabs: tabs.map((t) => ({ id: t.id, selected: t.getAttribute('aria-selected'), tabindex: t.tabIndex })),
      panelRoles: panels.map((p) => p.getAttribute('role')), panelLabelled: panels.map((p) => p.getAttribute('aria-labelledby')),
      panelHidden: panels.map((p) => p.hidden),
      statusRole: ${$("appearanceStatus")}.getAttribute('role'), statusLive: ${$("appearanceStatus")}.getAttribute('aria-live'),
      fileLabels: ['fileWall', 'fileFloor', 'fileCeiling'].map((id) => document.getElementById(id).labels?.[0]?.textContent ?? null),
      radioGroup: document.querySelector('fieldset.theme-choice legend')?.textContent,
      previews: ['previewWall', 'previewFloor', 'previewCeiling'].map((id) => ({ role: document.getElementById(id).getAttribute('role'), label: document.getElementById(id).getAttribute('aria-label') })),
      announcement: document.getElementById('announcement').getAttribute('aria-live'),
    };
  })()`);
  check("Tabs follow the ARIA pattern: tablist, two tabs, roving tabindex, panels labelled by their tab",
    semantics.listLabel && semantics.tabs.length === 2 && semantics.tabs[0].selected === "true" && semantics.tabs[0].tabindex === 0 && semantics.tabs[1].tabindex === -1
    && semantics.panelRoles.every((r) => r === "tabpanel") && semantics.panelLabelled[0] === "tabControls" && semantics.panelLabelled[1] === "tabAppearance" && semantics.panelHidden[0] === false && semantics.panelHidden[1] === true, JSON.stringify(semantics));
  check("Status uses role=status with polite announcements; every file input has a label; previews have text alternatives",
    semantics.statusRole === "status" && semantics.statusLive === "polite" && semantics.fileLabels.every(Boolean) && semantics.previews.every((p) => p.role === "img" && /preview: Classic/.test(p.label)) && semantics.radioGroup === "Texture theme" && semantics.announcement === "polite", JSON.stringify({ fileLabels: semantics.fileLabels, previews: semantics.previews }));

  await page.evaluate(`${$("tabControls")}.focus()`);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await wait(150);
  const afterArrow = await page.evaluate(`({ active: document.activeElement.id, selected: ${$("tabAppearance")}.getAttribute('aria-selected'), hidden: ${$("panelAppearance")}.hidden, controlsHidden: ${$("panelControls")}.hidden })`);
  check("Right arrow moves focus to the Appearance tab and shows its panel", afterArrow.active === "tabAppearance" && afterArrow.selected === "true" && afterArrow.hidden === false && afterArrow.controlsHidden === true, JSON.stringify(afterArrow));
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  await wait(100);
  check("Home returns to the first tab", await page.evaluate(`document.activeElement.id === 'tabControls' && ${$("panelAppearance")}.hidden`));
  // Every enabled appearance control is reachable by Tab (Clear stored images is disabled while nothing is stored), and Tab moves on (no focus trap).
  await page.evaluate(`${$("tabAppearance")}.click()`);
  const reachable = await page.evaluate(`['themeClassic', 'themeBackrooms', 'themeCustom', 'fileWall', 'fileFloor', 'fileCeiling', 'appearanceReset'].map((id) => { const e = document.getElementById(id); return e.offsetParent !== null && !e.disabled && (e.tabIndex >= 0); })`);
  await page.evaluate(`${$("appearanceReset")}.focus()`);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await wait(100);
  const leftPanel = await page.evaluate(`document.activeElement.id !== 'appearanceReset'`);
  check("Appearance controls are all reachable by Tab and focus is not trapped", reachable.every(Boolean) && leftPanel, JSON.stringify(reachable));
  const visibleFocus = await page.evaluate(`(() => { const s = getComputedStyle; const probe = ${$("fileWall")}; probe.focus(); return { outline: s(probe).outlineStyle, width: s(probe).outlineWidth }; })()`);
  check("Focused appearance controls show a visible outline", visibleFocus.outline !== "none" && parseFloat(visibleFocus.width) >= 2, JSON.stringify(visibleFocus));

  // ===== 4. theme switching never changes simulation state (paused run) =====
  await page.evaluate(`${$("step")}.click()`);
  const baselineState = await stateFingerprint();
  await page.evaluate(`${$("themeBackrooms")}.click()`);
  const backroomsStatus = await waitStatus("Backrooms-inspired theme");
  const afterBackrooms = await stateFingerprint();
  await page.evaluate(`${$("themeClassic")}.click()`);
  await waitStatus("^Classic textures");
  const afterClassic = await stateFingerprint();
  check("Switching themes does not change the seed, maze, walker, update count or camera pose", baselineState === afterBackrooms && baselineState === afterClassic, backroomsStatus);

  // ===== 3. Backrooms assets load from the (sub)path and only when chosen =====
  const themeRequests = page.events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => e.params.request.url).filter((u) => /assets\/themes/.test(u));
  check("The three Backrooms images were requested only after choosing the theme, from this site's path",
    themeRequests.length >= 3 && ["wall", "floor", "ceiling"].every((n) => themeRequests.some((u) => u.endsWith(`/assets/themes/backrooms/${n}.webp`) && u.startsWith(baseUrl))), JSON.stringify(themeRequests.slice(0, 3)));
  const failed = page.events.filter((e) => e.method === "Network.loadingFailed" || (e.method === "Network.responseReceived" && e.params.response.status >= 400 && !/favicon/.test(e.params.response.url)));
  check("No failed or 4xx requests while switching to Backrooms", failed.length === 0, failed.length ? JSON.stringify(failed[0].params).slice(0, 200) : "");

  // ===== 5-7. custom uploads: valid formats, separate slots =====
  await page.evaluate(`${$("themeClassic")}.click()`);
  await waitStatus("^Classic textures");
  await growWalls();
  await page.evaluate(`(async () => { window.__give('fileWall', await window.__synth('png', 'secret-holiday-photo.png', '#c80000')); })()`);
  const wallStatus = await waitStatus("Wall image applied|rejected");
  check("A valid PNG wall image is applied and selects the Custom theme", /Wall image applied/.test(wallStatus) && await page.evaluate(`${$("themeCustom")}.checked`), wallStatus);
  await wait(300);
  const afterWall = await page.evaluate(`({ wall: ${$("previewWall")}.getAttribute('aria-label'), floor: ${$("previewFloor")}.getAttribute('aria-label'), ceiling: ${$("previewCeiling")}.getAttribute('aria-label'), removeWall: !${$("removeWall")}.disabled, removeFloor: !${$("removeFloor")}.disabled })`);
  check("Only the wall changed: floor and ceiling stay Classic", /your image/.test(afterWall.wall) && /Classic/.test(afterWall.floor) && /Classic/.test(afterWall.ceiling) && afterWall.removeWall && !afterWall.removeFloor, JSON.stringify(afterWall));
  let c = await regionColour(0.3, 0.3, 0.7, 0.7);
  check("The wall picture is drawn in the 3D view (red wall image)", c.redShare > 0.05, JSON.stringify(c));
  await page.evaluate(`(async () => { window.__give('fileFloor', await window.__synth('jpeg', 'floor-from-phone.jpg', '#00b400')); })()`);
  const floorStatus = await waitStatus("Floor image applied|rejected");
  await page.evaluate(`(async () => { window.__give('fileCeiling', await window.__synth('webp', 'ceiling.webp', '#0000c8')); })()`);
  const ceilingStatus = await waitStatus("Ceiling image applied|rejected");
  check("A valid JPEG floor image and a valid WebP ceiling image are applied", /Floor image applied/.test(floorStatus) && /Ceiling image applied/.test(ceilingStatus), `${floorStatus} | ${ceilingStatus}`);
  await wait(300);
  const low = await regionColour(0.2, 0.8, 0.8, 1);
  const high = await regionColour(0.2, 0, 0.8, 0.2);
  check("Floor and ceiling pictures replace the classic ones (green below, blue above)", dominant(low, "g") && dominant(high, "b"), JSON.stringify({ low, high }));

  // ===== 6. rejections never break the maze =====
  const fingerprintBefore = await stateFingerprint();
  const rejections = await page.evaluate(`(async () => {
    const out = [];
    const attempt = async (label, file) => { window.__give('fileWall', file); await new Promise((r) => setTimeout(r, 400)); const s = document.getElementById('appearanceStatus'); for (let i = 0; i < 100 && /Reading/.test(s.textContent); i += 1) await new Promise((r) => setTimeout(r, 50)); out.push({ label, status: s.textContent, wallLabel: document.getElementById('previewWall').getAttribute('aria-label') }); };
    await attempt('svg', new File(["<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'><rect width='4' height='4'/></svg>"], 'logo.svg', { type: 'image/svg+xml' }));
    await attempt('text', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await attempt('gif', new File([new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0])], 'a.gif', { type: 'image/gif' }));
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0];
    await attempt('corrupt', new File([new Uint8Array([...png, 1, 2, 3, 4, 5, 6, 7, 8, 9])], 'broken.png', { type: 'image/png' }));
    const huge = [...png]; huge[18] = 0x13; huge[19] = 0x88; huge[22] = 0x13; huge[23] = 0x88; // 5000 x 5000
    await attempt('dimensions', new File([new Uint8Array([...huge, 0, 0, 0, 0])], 'big.png', { type: 'image/png' }));
    await attempt('size', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'heavy.png', { type: 'image/png' }));
    return out;
  })()`);
  const byLabel = Object.fromEntries(rejections.map((r) => [r.label, r]));
  check("SVG is rejected", /rejected/.test(byLabel.svg.status) && /SVG/.test(byLabel.svg.status), byLabel.svg.status);
  check("Non-images and other formats are rejected", /rejected/.test(byLabel.text.status) && /rejected/.test(byLabel.gif.status), `${byLabel.text.status} | ${byLabel.gif.status}`);
  check("A corrupt image is rejected without breaking anything", /rejected/.test(byLabel.corrupt.status), byLabel.corrupt.status);
  check("An image larger than 4096 pixels and a file over 10 MB are rejected", /rejected/.test(byLabel.dimensions.status) && /4096/.test(byLabel.dimensions.status) && /rejected/.test(byLabel.size.status) && /10 MB/.test(byLabel.size.status), `${byLabel.dimensions.status} | ${byLabel.size.status}`);
  check("Rejected files leave the previous wall image and the run untouched, and messages show no file name",
    rejections.every((r) => /your image/.test(r.wallLabel) && !/logo|notes|broken|heavy|big\.png|a\.gif/.test(r.status)) && fingerprintBefore === await stateFingerprint(), "");
  check("The file input does not keep the chosen file name", await page.evaluate(`['fileWall','fileFloor','fileCeiling'].every((id) => document.getElementById(id).value === '')`));

  // ===== 10. IndexedDB persistence across a reload; storage holds only resized copies =====
  const stored = await page.evaluate(`new Promise((resolve) => { const r = indexedDB.open('glmaze-appearance'); r.onerror = () => resolve(null); r.onsuccess = () => { const db = r.result; const t = db.transaction('textures', 'readonly'); const s = t.objectStore('textures'); const keys = s.getAllKeys(); const vals = s.getAll(); t.oncomplete = () => { db.close(); resolve({ keys: keys.result, values: vals.result.map((v) => ({ blob: v instanceof Blob, file: v instanceof File, type: v.type, hasName: 'name' in v, size: v.size })) }); }; }; })`);
  check("IndexedDB holds exactly wall, floor and ceiling as plain PNG blobs (no File, no name)", stored && JSON.stringify(stored.keys.sort()) === JSON.stringify(["ceiling", "floor", "wall"]) && stored.values.every((v) => v.blob && !v.file && !v.hasName && v.type === "image/png"), JSON.stringify(stored));
  check("Nothing about the uploads is in localStorage, the URL or the page text",
    await page.evaluate(`(() => { const ls = JSON.stringify({ ...localStorage }); const hay = ls + location.href + document.body.innerText; return !/secret-holiday|floor-from-phone|ceiling\\.webp|data:image|blob:/i.test(hay); })()`));
  await load("seed=2017&rng=microsoft&reduced=0&quality=standard");
  await page.evaluate(SYNTH);
  const restoredStatus = await waitStatus("Custom theme", 15000);
  const restored = await page.evaluate(`({ custom: ${$("themeCustom")}.checked, wall: ${$("previewWall")}.getAttribute('aria-label'), floor: ${$("previewFloor")}.getAttribute('aria-label') })`);
  check("After a reload the stored Custom theme comes back from IndexedDB", restored.custom && /your image/.test(restored.wall) && /your image/.test(restored.floor), `${restoredStatus} ${JSON.stringify(restored)}`);

  // ===== 12. evidence export =====
  const exportText = await page.evaluate("window.__exportRun()");
  const exported = JSON.parse(exportText);
  check("The evidence export records only the theme, the three sources and a validation state",
    JSON.stringify(Object.keys(exported.appearance).sort()) === JSON.stringify(["ceiling", "floor", "theme", "validation", "wall"]) && exported.appearance.theme === "custom" && ["wall", "floor", "ceiling"].every((k) => exported.appearance[k] === "user"), JSON.stringify(exported.appearance));
  check("The export contains no file name, path, image data or digest", !/secret-holiday|floor-from-phone|ceiling\.webp|data:image|base64|sha256|[A-Za-z]:\\\\|\\.png|\\.jpg|\\.webp/i.test(exportText.replace(/glmaze-[^"]*\.json/g, "")), "");

  // ===== 8-9. reset to Classic keeps the stored images; clear deletes them =====
  await page.evaluate(`${$("appearanceReset")}.click()`);
  await waitStatus("Reset to Classic");
  check("Reset to Classic shows Classic and keeps the stored images", await page.evaluate(`${$("themeClassic")}.checked && /Classic/.test(${$("previewWall")}.getAttribute('aria-label'))`));
  await page.evaluate(`${$("themeCustom")}.click()`);
  await waitStatus("Custom theme");
  check("The stored images are still there after the reset", await page.evaluate(`/your image/.test(${$("previewWall")}.getAttribute('aria-label'))`));
  await page.evaluate(`${$("removeFloor")}.click()`);
  await waitStatus("Floor image removed");
  check("Remove deletes one slot only", await page.evaluate(`/Classic/.test(${$("previewFloor")}.getAttribute('aria-label')) && /your image/.test(${$("previewWall")}.getAttribute('aria-label'))`));
  await page.evaluate(`${$("appearanceClear")}.click()`);
  await waitStatus("Stored custom images cleared");
  const afterClear = await page.evaluate(`new Promise((resolve) => { const r = indexedDB.open('glmaze-appearance'); r.onsuccess = () => { const db = r.result; const t = db.transaction('textures', 'readonly'); const c = t.objectStore('textures').count(); t.oncomplete = () => { db.close(); resolve(c.result); }; }; })`);
  check("Clear stored images empties IndexedDB and falls back to Classic", afterClear === 0 && await page.evaluate(`${$("themeClassic")}.checked && ${$("removeWall")}.disabled`), `stored entries: ${afterClear}`);
  await load("seed=2017&theme=custom&reduced=0&quality=standard");
  const fallbackStatus = await waitStatus("No custom images are stored|Classic", 15000);
  check("theme=custom with nothing stored falls back to Classic and says so", /No custom images are stored/.test(fallbackStatus) && await page.evaluate(`${$("themeClassic")}.checked`), fallbackStatus);

  // ===== URL precedence in the browser =====
  await page.evaluate(`localStorage.setItem('glmaze.settings.v1', JSON.stringify({ theme: 'backrooms' }))`);
  await load("seed=2017&reduced=0&quality=standard");
  const storedPick = await waitStatus("Backrooms-inspired theme", 15000);
  check("A stored built-in theme is restored on load", /Backrooms/.test(storedPick) && await page.evaluate(`${$("themeBackrooms")}.checked`), storedPick);
  await load("seed=2017&theme=classic&reduced=0&quality=standard");
  check("The URL theme overrides the stored one", await page.evaluate(`${$("themeClassic")}.checked && !${$("themeBackrooms")}.checked`));
  await page.evaluate("localStorage.clear()");

  // ===== 13. context loss and restoration keep the theme =====
  await load("seed=2017&theme=backrooms&reduced=0&quality=standard");
  await page.evaluate(SYNTH);
  await waitStatus("Backrooms-inspired theme", 15000);
  await growWalls();
  const beforeLoss = await regionColour(0.2, 0.8, 0.8, 1);
  await page.evaluate(`window.__ext = ${$("webglCanvas")}.getContext('webgl2').getExtension('WEBGL_lose_context'); window.__ext.loseContext();`);
  await wait(500);
  const lost = await page.evaluate(`({ map: !${$("mazeCanvas")}.hidden })`);
  await page.evaluate("window.__ext.restoreContext()");
  await wait(1500);
  const restoredView = await page.evaluate(`({ first: !${$("webglCanvas")}.hidden })`);
  const afterLoss = await regionColour(0.2, 0.8, 0.8, 1);
  const closeColours = Math.abs(beforeLoss.r - afterLoss.r) + Math.abs(beforeLoss.g - afterLoss.g) + Math.abs(beforeLoss.b - afterLoss.b) < 30;
  check("After WebGL context loss and restoration the Backrooms theme is drawn again", lost.map && restoredView.first && closeColours, JSON.stringify({ beforeLoss, afterLoss }));

  // ===== 11. no upload network requests, ever =====
  const allRequests = page.events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => e.params.request);
  const bad = allRequests.filter((r) => r.method !== "GET" || r.postData || (!r.url.startsWith(origin) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.startsWith("about:")) || /secret-holiday|floor-from-phone|\\.jpg|\\.png/i.test(r.url));
  check("No request carried image data: every request is a same-origin GET with no body and no file name", bad.length === 0, bad.slice(0, 2).map((r) => `${r.method} ${r.url}`).join("; "));

  // ===== 14 + performance: 100 switches, textures, heap, timing =====
  await load("seed=2017&reduced=0&quality=standard");
  await page.evaluate(SYNTH);
  await page.evaluate(`(async () => { window.__give('fileWall', await window.__synth('png', 'w.png', '#a05020')); window.__give('fileFloor', await window.__synth('png', 'f.png', '#206020')); window.__give('fileCeiling', await window.__synth('png', 'c.png', '#303080')); })()`);
  await waitStatus("Custom theme|applied");
  await wait(800);
  await page.evaluate(`${$("themeClassic")}.click()`);
  await waitStatus("^Classic textures");
  await wait(300);
  await page.send("HeapProfiler.collectGarbage");
  const heap0 = (await page.send("Runtime.getHeapUsage")).usedSize;
  const tex0 = await page.evaluate("({ ...window.__tex })");
  const live0 = tex0.created - tex0.deleted;
  const durations = { backrooms: [], custom: [], classic: [] };
  const names = ["themeBackrooms", "themeCustom", "themeClassic"];
  for (let i = 0; i < 102; i += 1) {
    const id = names[i % 3];
    const ms = await page.evaluate(`window.__switch('${id}')`);
    durations[id.replace("theme", "").toLowerCase()].push(ms);
  }
  await wait(500);
  await page.send("HeapProfiler.collectGarbage");
  const heap1 = (await page.send("Runtime.getHeapUsage")).usedSize;
  const tex1 = await page.evaluate("({ ...window.__tex })");
  const live1 = tex1.created - tex1.deleted;
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  Object.assign(measurements, {
    switches: 102, liveTexturesBefore: live0, liveTexturesAfter: live1, heapBeforeBytes: heap0, heapAfterBytes: heap1, heapGrowthBytes: heap1 - heap0,
    switchMedianMs: { backrooms: +median(durations.backrooms).toFixed(1), custom: +median(durations.custom).toFixed(1), classic: +median(durations.classic).toFixed(1) },
    switchMaxMs: +Math.max(...Object.values(durations).flat()).toFixed(1),
  });
  check("100+ theme switches leave the live WebGL texture count unchanged", live1 === live0, `before ${live0}, after ${live1} (created ${tex1.created}, deleted ${tex1.deleted})`);
  check("100+ theme switches do not grow the JavaScript heap by more than 8 MB after collection", heap1 - heap0 < 8 * 1024 * 1024, `${((heap1 - heap0) / 1024).toFixed(0)} KB`);

  // Decode cost of the built-in images and frame timing before and after selecting the theme (the run is playing).
  await page.evaluate(`${$("tabControls")}.click()`);
  await page.evaluate(`${$("play")}.click()`);
  const frames = (label) => page.evaluate(`new Promise((resolve) => { const t = []; let last = performance.now(); let n = 0; const tick = (now) => { t.push(now - last); last = now; if (++n < 240) requestAnimationFrame(tick); else { t.shift(); t.sort((a, b) => a - b); resolve({ median: +t[Math.floor(t.length / 2)].toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2), max: +t[t.length - 1].toFixed(2) }); } }; requestAnimationFrame(tick); })`);
  await page.evaluate(`${$("themeClassic")}.click()`).catch(() => {});
  measurements.frameIntervalClassic = await frames("classic");
  await page.evaluate(`${$("tabAppearance")}.click()`);
  await page.evaluate(`${$("themeBackrooms")}.click()`);
  await waitStatus("Backrooms-inspired theme");
  await page.evaluate(`${$("tabControls")}.click()`);
  measurements.frameIntervalBackrooms = await frames("backrooms");
  measurements.decode = await page.evaluate(`(async () => {
    const themes = await import(new URL('./src/themes.js', document.baseURI).href);
    const cold = performance.now(); await themes.loadBackrooms(); const coldMs = performance.now() - cold;
    const times = [];
    for (let i = 0; i < 10; i += 1) { const t0 = performance.now(); await themes.loadBackrooms(); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    return { firstMs: +coldMs.toFixed(1), warmMedianMs: +times[5].toFixed(1) };
  })()`);
  await page.evaluate(`${$("play")}.click()`);
  measurements.themeTextureBytesOnGpu = 3 * 512 * 512 * 4; // three RGBA8 textures, no mipmaps
  const themeBytes = page.events.filter((e) => e.method === "Network.loadingFinished");
  void themeBytes;
  // Timing is only meaningful when the machine renders fast: on a software rasteriser (a hosted CI runner) frames take 30 ms or more and
  // the numbers are recorded but not asserted.
  const fastEnough = measurements.frameIntervalClassic.median <= 12;
  measurements.timingAsserted = fastEnough;
  check("Selecting the Backrooms theme keeps the animation-frame median within 25% of Classic" + (fastEnough ? "" : " (recorded only: software rendering)"), !fastEnough || measurements.frameIntervalBackrooms.median <= measurements.frameIntervalClassic.median * 1.25 + 0.5, JSON.stringify({ classic: measurements.frameIntervalClassic, backrooms: measurements.frameIntervalBackrooms }));

  // Simulation keeps its 40 updates per second while themes switch.
  await page.evaluate(`${$("themeClassic")}.click()`);
  await waitStatus("^Classic textures");
  await page.evaluate(`${$("tabControls")}.click()`);
  await page.evaluate(`${$("play")}.click()`);
  const u0 = Number(await page.evaluate(`${$("updates")}.textContent`)); const t0 = Date.now();
  await page.evaluate(`(async () => { for (let i = 0; i < 6; i += 1) { await window.__switch(['themeBackrooms', 'themeClassic'][i % 2]); } })()`);
  await wait(1500);
  const u1 = Number(await page.evaluate(`${$("updates")}.textContent`)); const elapsed = (Date.now() - t0) / 1000;
  await page.evaluate(`${$("play")}.click()`);
  measurements.updatesPerSecondWhileSwitching = +((u1 - u0) / elapsed).toFixed(1);
  check("Switching themes does not interrupt the 40-updates-per-second simulation" + (fastEnough ? "" : " (recorded only: software rendering)"), !fastEnough || (measurements.updatesPerSecondWhileSwitching > 36 && measurements.updatesPerSecondWhileSwitching < 44), `${measurements.updatesPerSecondWhileSwitching} updates per second`);

  // ===== 19-20. deterministic visual baselines are produced by visual.mjs; here a determinism check of the synthetic custom texture =====
  const hashes = [];
  for (let i = 0; i < 2; i += 1) {
    await load("seed=1&objects=0&reduced=0&quality=standard");
    await page.evaluate(SYNTH);
    await page.evaluate(`(async () => { window.__give('fileWall', await window.__synth('png', 'w.png', '#a05020', [512, 512])); })()`);
    await waitStatus("Wall image applied");
    const digest = await page.evaluate(`(async () => { const s = await window.__synth('png', 'w.png', '#a05020', [512, 512]); const b = new Uint8Array(await s.arrayBuffer()); const h = await crypto.subtle.digest('SHA-256', b); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join(''); })()`);
    hashes.push(digest);
  }
  check("The synthetic custom texture is byte-identical on every run", hashes[0] === hashes[1], hashes[0].slice(0, 16));

  const errors = page.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => JSON.stringify(e.params).slice(0, 240));
  check("No uncaught page exceptions", errors.length === 0, errors[0] ?? "");
} catch (error) {
  check("appearance run completed", false, String(error.message ?? error).slice(0, 500));
} finally {
  harness.close();
}

console.log("MEASUREMENTS " + JSON.stringify(measurements));
if (process.env.APPEARANCE_REPORT) writeFileSync(process.env.APPEARANCE_REPORT, JSON.stringify(measurements, null, 2) + "\n");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} appearance checks passed.`);
process.exit(failed.length ? 1 : 0);
