// Firefox behaviour checks over WebDriver BiDi (dev tool, not part of `npm test`/CI). Starts a throw-away local
// server and a headless Firefox with a fresh profile (never your own profile or session).
//   npm run smoke:firefox            (set FIREFOX_PATH to override the browser location)
// Headless Firefox cannot capture WebGL content in --screenshot images (they come out black), so first-person
// rendering is verified by reading the drawing buffer back, not by screenshot comparison.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const firefoxPath = [process.env.FIREFOX_PATH, "C:/Program Files/Mozilla Firefox/firefox.exe", "/usr/bin/firefox", "/Applications/Firefox.app/Contents/MacOS/firefox"].filter(Boolean).find((p) => existsSync(p));
if (!firefoxPath) { console.error("No Firefox found. Set FIREFOX_PATH."); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

const httpPort = await freePort();
const rawBase = process.env.GLMAZE_BASE_PATH ?? "/";
const basePath = `/${rawBase.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
const baseUrl = `http://127.0.0.1:${httpPort}${basePath}`;
const debugPort = await freePort();
const server = spawn(process.execPath, ["web/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(httpPort) }, stdio: "ignore" });
const firefox = spawn(firefoxPath, ["--headless", "--no-remote", "--profile", mkdtempSync(join(tmpdir(), "glmaze-ff-")), `--remote-debugging-port=${debugPort}`, "about:blank"], { stdio: "ignore" });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

let ws;
for (let i = 0; i < 80 && !ws; i += 1) {
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${debugPort}/session`);
    await new Promise((res, rej) => { socket.addEventListener("open", res); socket.addEventListener("error", rej); });
    ws = socket;
  } catch { await wait(500); }
}
if (!ws) { console.error("Could not connect to Firefox."); firefox.kill(); server.kill(); process.exit(2); }
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "log.entryAdded") logs.push(`${d.params.level}: ${d.params.text}`);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (d) => (d.type === "error" ? reject(new Error(`${d.error} ${d.message}`)) : resolve(d.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

const plain = (v) => {
  if (!v) return v;
  if (v.type === "object") return Object.fromEntries((v.value ?? []).map(([k, x]) => [typeof k === "string" ? k : k.value, plain(x)]));
  if (v.type === "array") return (v.value ?? []).map(plain);
  return v.value ?? v.type;
};

try {
  await send("session.new", { capabilities: {} });
  await send("session.subscribe", { events: ["log.entryAdded"] });
  const context = (await send("browsingContext.getTree", {})).contexts[0].context;
  const evaluate = async (expression) => {
    const r = await send("script.evaluate", { expression, target: { context }, awaitPromise: true, resultOwnership: "none", serializationOptions: { maxObjectDepth: 6 } });
    if (r.type === "exception") throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return plain(r.result);
  };
  const load = async (query, { width = 1200, height = 800, dpr = 1 } = {}) => {
    await send("browsingContext.setViewport", { context, viewport: { width, height }, devicePixelRatio: dpr });
    await send("browsingContext.navigate", { context, url: `${baseUrl}?${query}`, wait: "complete" });
    await wait(1200);
  };
  const $ = (name) => `document.getElementById('${name}')`;
  // Hash of the drawing buffer read back right after a synchronous render.
  const bufferHash = `(() => { const c = ${$("webglCanvas")}; const gl = c.getContext('webgl2'); const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px); let h = 2166136261; for (let i = 0; i < px.length; i += 4) { h = Math.imul(h ^ px[i], 16777619); h = Math.imul(h ^ px[i + 1], 16777619); } return h >>> 0; })()`;

  await load("seed=1&rng=microsoft&reduced=1&objects=1");
  const info = await evaluate(`(() => { const g = document.createElement('canvas').getContext('webgl2'); return { webgl2: !!g, firstShown: !${$("webglCanvas")}.hidden }; })()`);
  check("WebGL 2 is available and first person is shown", info.webgl2 && info.firstShown);
  const lit = await evaluate(`(() => { for (let i = 0; i < 45; i += 1) ${$("step")}.click(); const c = ${$("webglCanvas")}; const gl = c.getContext('webgl2'); const px = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px); let lit = 0, red = 0; for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] > 60) lit += 1; if (px[i] > px[i + 2] * 1.5 && px[i] > 80) red += 1; } return { lit: lit / (c.width * c.height), red: red / (c.width * c.height) }; })()`);
  check("First person renders lit brick pixels (buffer readback)", lit.lit > 0.9 && lit.red > 0.2, JSON.stringify(lit));

  // Keyboard: Tab through the page with real key events.
  const key = async (value) => send("input.performActions", { context, actions: [{ type: "key", id: "kbd", actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }] });
  const reached = new Map();
  for (let i = 0; i < 40; i += 1) {
    await key("\uE004");
    const e = await evaluate(`(() => { const a = document.activeElement; const c = getComputedStyle(a); return { id: a.id, outline: c.outlineStyle + ' ' + c.outlineWidth }; })()`);
    if (e.id) reached.set(e.id, e.outline);
  }
  const wanted = ["seed", "regenerate", "rngMode", "quality", "reducedMotion", "objectsFlag", "markersFlag", "picturesFlag", "logosFlag", "ratsFlag", "play", "step", "exportRun", "viewFirst", "viewMap", "fullscreen"];
  const missing = wanted.filter((n) => !reached.has(n));
  check("Tab reaches every control", missing.length === 0, missing.join(",") || `${reached.size} controls`);
  // Headless Firefox never gives the page system focus (document.hasFocus() is false), so :focus-visible cannot
  // match there and a computed-style check would be meaningless. Verify instead that the stylesheet defines the rule.
  const rule = await evaluate(`(() => { for (const sheet of document.styleSheets) for (const r of sheet.cssRules) if (r.selectorText && r.selectorText.includes(':focus-visible') && /outline:[^;]*3px/.test(r.cssText) && r.cssText.includes('solid')) return r.selectorText; return null; })()`);
  check("The stylesheet defines a 3px solid :focus-visible outline", Boolean(rule) && rule !== "null", String(rule).slice(0, 60));

  // Reduced motion: the drawing buffer holds still inside a transition; normal motion moves it.
  // Read the buffer in the same synchronous turn as the render: after the compositor presents, the buffer is cleared.
  const holds = async (reduced) => {
    await load(`seed=1&rng=microsoft&objects=0&reduced=${reduced}`);
    return evaluate(`(() => { const hash = () => ${bufferHash}; for (let i = 0; i < 43; i += 1) ${$("step")}.click(); const a = hash(); for (let i = 0; i < 3; i += 1) ${$("step")}.click(); return a === hash(); })()`);
  };
  check("Reduced motion: view holds still during a transition", (await holds(1)) === true);
  check("Normal motion: view moves during a transition", (await holds(0)) === false);

  // Appearance tab: tab semantics, the lazily loaded Backrooms theme and a synthetic PNG upload change the drawing buffer.
  await load("seed=1&rng=microsoft&reduced=1&objects=0");
  const redraw = `(() => { ${$("viewMap")}.click(); ${$("viewFirst")}.click(); return ${bufferHash}; })()`;
  await evaluate(`(() => { for (let i = 0; i < 60; i += 1) ${$("step")}.click(); return true; })()`);
  const classicHash = await evaluate(redraw);
  const tabs = await evaluate(`(() => { ${$("tabAppearance")}.click(); return { selected: ${$("tabAppearance")}.getAttribute('aria-selected'), shown: !${$("panelAppearance")}.hidden, panelRole: ${$("panelAppearance")}.getAttribute('role'), status: ${$("appearanceStatus")}.getAttribute('role') }; })()`);
  check("Appearance tab: selected state, visible panel, tabpanel and status roles", tabs.selected === "true" && tabs.shown === true && tabs.panelRole === "tabpanel" && tabs.status === "status", JSON.stringify(tabs));
  await evaluate(`${$("themeBackrooms")}.click()`);
  await evaluate(`(async () => { const el = ${$("appearanceStatus")}; for (let i = 0; i < 200 && !/Backrooms-inspired theme/.test(el.textContent); i += 1) await new Promise((r) => setTimeout(r, 50)); return el.textContent; })()`);
  const backroomsHash = await evaluate(redraw);
  check("Choosing the Backrooms-inspired theme changes the picture", backroomsHash !== classicHash);
  await evaluate(`${$("themeClassic")}.click()`);
  await evaluate(`new Promise((r) => setTimeout(r, 300))`);
  check("Choosing Classic again restores the original picture", (await evaluate(redraw)) === classicHash);
  const uploaded = await evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#c80000'; x.fillRect(0, 0, 128, 128);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const file = new File([blob], 'private-name.png', { type: 'image/png' });
    const input = ${$("fileWall")}; const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    const el = ${$("appearanceStatus")}; for (let i = 0; i < 200 && !/Wall image applied|rejected/.test(el.textContent); i += 1) await new Promise((r) => setTimeout(r, 50));
    return { status: el.textContent, value: input.value };
  })()`);
  check("A PNG wall image is accepted, applied and its name is not kept", /Wall image applied/.test(uploaded.status) && uploaded.value === "" && !/private-name/.test(uploaded.status), uploaded.status);
  check("The custom wall image changes the picture", (await evaluate(redraw)) !== classicHash);
  await evaluate(`${$("appearanceClear")}.click()`);
  await evaluate(`new Promise((r) => setTimeout(r, 400))`);
  check("Clearing the stored images returns to Classic", (await evaluate(redraw)) === classicHash);
  await evaluate("localStorage.clear()");

  // Resize and DPR.
  await load("seed=1&rng=microsoft&reduced=1", { width: 420, height: 800, dpr: 2 });
  const narrow = await evaluate(`(() => { const c = ${$("webglCanvas")}; return { css: [c.clientWidth, c.clientHeight], backing: [c.width, c.height], overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
  check("Narrow DPR 2: backing store is CSS size x 2, no horizontal overflow", narrow.backing[0] === narrow.css[0] * 2 && narrow.backing[1] === narrow.css[1] * 2 && !narrow.overflow, JSON.stringify(narrow));
  await send("browsingContext.setViewport", { context, viewport: { width: 1300, height: 800 }, devicePixelRatio: 1 });
  await wait(600);
  const wide = await evaluate(`(() => { const c = ${$("webglCanvas")}; return { css: [c.clientWidth, c.clientHeight], backing: [c.width, c.height] }; })()`);
  check("Resize to wide DPR 1 re-matches the backing store", wide.backing[0] === wide.css[0] && wide.backing[1] === wide.css[1], JSON.stringify(wide));

  // Context loss and restore.
  const ctx = await evaluate(`(async () => { const gl = ${$("webglCanvas")}.getContext('webgl2'); const ext = gl.getExtension('WEBGL_lose_context'); if (!ext) return { supported: false }; ext.loseContext(); await new Promise((r) => setTimeout(r, 300)); const during = { glHidden: ${$("webglCanvas")}.hidden, mapShown: !${$("mazeCanvas")}.hidden }; ext.restoreContext(); await new Promise((r) => setTimeout(r, 600)); return { supported: true, during, restored: !${$("webglCanvas")}.hidden }; })()`);
  check("Context loss falls back to the map and restore returns", ctx.supported && ctx.during.glHidden && ctx.during.mapShown && ctx.restored);

  const pageLogs = logs.filter((l) => /^(error|warn)/.test(l));
  check("No console errors or warnings from the page", pageLogs.length === 0, pageLogs.slice(0, 2).join(" | "));

  // WebGL 2 unavailable: preload script hides the context before the page runs.
  await send("script.addPreloadScript", { functionDeclaration: "() => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return t === 'webgl2' ? null : o.call(this, t, ...a); }; }" });
  await load("seed=1");
  const fallback = await evaluate(`({ mapShown: !${$("mazeCanvas")}.hidden, buttonDisabled: ${$("viewFirst")}.disabled })`);
  check("Without WebGL 2 the debug map is shown and first person is disabled", fallback.mapShown && fallback.buttonDisabled, JSON.stringify(fallback));

} catch (error) {
  check("Firefox run completed", false, String(error.message ?? error).slice(0, 300));
} finally {
  try { await send("browser.close", {}); } catch { /* already closed */ }
  firefox.kill();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Firefox checks passed.`);
process.exit(failed.length ? 1 : 0);
